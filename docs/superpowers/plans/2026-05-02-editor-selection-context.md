# Editor Selection Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user selects text in a markdown note, shapes in an Excalidraw/tldraw diagram, or rows in a DuckDB table, that selection is automatically injected as structured context into the next Claude Code message (one-shot: cleared after injection).

**Architecture:** The SPA tracks selection in each editor type and debounces PUTs to `PUT /api/selection` on the viewer server. The server holds one volatile in-memory slot. A `UserPromptSubmit` hook in `.claude/settings.json` calls `GET /api/selection?text=1` on every message submit — the server returns pre-formatted `<editor-selection>` text and atomically clears the state. If nothing is selected the hook outputs nothing.

**Tech Stack:** Node.js HTTP server (viewer-server.js), React + CodeMirror 6 (entry.jsx), tldraw editor API, DuckDB (DuckDBView.jsx), shell hooks (settings.json), ES modules throughout.

---

## File Structure

| File | Role |
|------|------|
| `src/selection-formatter.js` | **New.** Pure function `formatSelectionAsText(sel)` — converts selection payload to `<editor-selection>` text block. No I/O. |
| `src/viewer-server.js` | **Modify.** Add `selectionState` variable + `PUT/GET/DELETE /api/selection` routes. Import formatter. |
| `src/viewer/entry.jsx` | **Modify.** Add `useSendSelection` custom hook. Add selection tracking to `NoteView` (CodeMirror updateListener), `DiagramEditor` (Excalidraw onChange), `TldrawEditor` (store.listen). |
| `src/viewer/DuckDBView.jsx` | **Modify.** Add row selection state to `TableView`. Click/shift/ctrl handlers. Row highlight. Selection PUT on change. |
| `src/init.js` | **Modify.** Add `buildUserPromptSubmitHook()` and `mergeUserPromptSubmitHook()`. Call from `writeSettings()`. |
| `scripts/smoke-selection.mjs` | **New.** Smoke tests for the `/api/selection` HTTP API. |

---

## Task 1: Selection Formatter + Server Endpoints

**Files:**
- Create: `src/selection-formatter.js`
- Modify: `src/viewer-server.js`
- Create: `scripts/smoke-selection.mjs`

### Step 1.1: Write the smoke test (will fail — server has no /api/selection yet)

Create `scripts/smoke-selection.mjs`:

```js
#!/usr/bin/env node
// Smoke tests for /api/selection endpoints.
// Usage: node scripts/smoke-selection.mjs [port]
// Requires the viewer server to be running on the given port (default 3000).

import assert from "node:assert/strict";

const PORT = parseInt(process.argv[2] || "3000");
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function req(method, path, body, headers = {}) {
  const opts = { method, headers: { Origin: ORIGIN, ...headers } };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  return fn().then(() => { console.log(`  ✓  ${name}`); passed++; })
             .catch(e => { console.error(`  ✗  ${name}: ${e.message}`); failed++; });
}

await test("GET /api/selection returns null when empty", async () => {
  const r = await req("GET", "/api/selection");
  assert.equal(r.status, 200);
  assert.equal(r.json, null);
});

await test("PUT /api/selection stores markdown payload", async () => {
  const payload = {
    type: "markdown", file: "test.md", selectedText: "hello world",
    startLine: 1, endLine: 1, startCol: 0, endCol: 11,
    headingPath: ["Introduction"], contextBefore: "before", contextAfter: "after",
    frontmatter: { tags: "test" }, totalLines: 10, positionPct: 10,
  };
  const r = await req("PUT", "/api/selection", payload);
  assert.equal(r.status, 200);
  assert.equal(r.json?.ok, true);
});

await test("GET /api/selection returns stored payload", async () => {
  const r = await req("GET", "/api/selection");
  assert.equal(r.status, 200);
  assert.equal(r.json?.type, "markdown");
  assert.equal(r.json?.file, "test.md");
  // raw GET does NOT clear
  const r2 = await req("GET", "/api/selection");
  assert.equal(r2.json?.type, "markdown");
});

await test("GET /api/selection?text=1 returns formatted text and clears", async () => {
  const r = await req("GET", "/api/selection?text=1");
  assert.equal(r.status, 200);
  assert.ok(r.text.includes("<editor-selection"), "missing opening tag");
  assert.ok(r.text.includes("type=\"markdown\""), "missing type");
  assert.ok(r.text.includes("file=\"test.md\""), "missing file");
  assert.ok(r.text.includes("hello world"), "missing selected text");
  assert.ok(r.text.includes("Introduction"), "missing heading");
  assert.ok(r.text.includes("</editor-selection>"), "missing closing tag");
  // one-shot: should now be cleared
  const r2 = await req("GET", "/api/selection?text=1");
  assert.equal(r2.text.trim(), "", "should be empty after one-shot read");
});

await test("PUT /api/selection stores excalidraw payload", async () => {
  const payload = {
    type: "excalidraw", file: "system.excalidraw",
    selectedElements: [{
      type: "rectangle", text: "User Service", x: 100, y: 200, width: 150, height: 80,
      boundElements: [{ direction: "out", arrowLabel: "HTTP", connectedElementText: "Database" }],
      frameName: "Backend", groupIds: [], link: null,
    }],
    totalElements: 42,
  };
  const r = await req("PUT", "/api/selection", payload);
  assert.equal(r.status, 200);
  const rf = await req("GET", "/api/selection?text=1");
  assert.ok(rf.text.includes("type=\"excalidraw\""));
  assert.ok(rf.text.includes("User Service"));
  assert.ok(rf.text.includes("→ arrow"));
  assert.ok(rf.text.includes("Database"));
  assert.ok(rf.text.includes("Backend"));
  assert.ok(rf.text.includes("42 elements total"));
});

await test("PUT /api/selection stores tldraw payload", async () => {
  const payload = {
    type: "tldraw", file: "wireframe.tldraw",
    selectedShapes: [{
      type: "geo", geo: "rectangle", text: "Login Form",
      x: 200, y: 150, width: 300, height: 400,
      connectedArrows: [{ direction: "out", arrowLabel: "submit", otherEndText: "Dashboard" }],
      parentFrameName: "Onboarding",
    }],
    totalShapes: 28,
  };
  const r = await req("PUT", "/api/selection", payload);
  assert.equal(r.status, 200);
  const rf = await req("GET", "/api/selection?text=1");
  assert.ok(rf.text.includes("type=\"tldraw\""));
  assert.ok(rf.text.includes("Login Form"));
  assert.ok(rf.text.includes("Onboarding"));
  assert.ok(rf.text.includes("28 shapes total"));
});

await test("PUT /api/selection stores duckdb payload", async () => {
  const payload = {
    type: "duckdb", file: "jobs.duckdb", tableName: "jobs",
    schema: [{ column: "company", type: "TEXT" }, { column: "status", type: "TEXT" }],
    selectedRows: [
      { rowIndex: 2, data: { company: "Anthropic", status: "interview" } },
    ],
    totalRows: 45, currentQuery: "SELECT * FROM jobs",
  };
  const r = await req("PUT", "/api/selection", payload);
  assert.equal(r.status, 200);
  const rf = await req("GET", "/api/selection?text=1");
  assert.ok(rf.text.includes("type=\"duckdb\""));
  assert.ok(rf.text.includes("Anthropic"));
  assert.ok(rf.text.includes("Schema:"));
  assert.ok(rf.text.includes("SELECT * FROM jobs"));
});

await test("DELETE /api/selection clears state", async () => {
  await req("PUT", "/api/selection", { type: "markdown", file: "x.md", selectedText: "x",
    startLine: 1, endLine: 1, startCol: 0, endCol: 1, headingPath: [],
    contextBefore: "", contextAfter: "", frontmatter: {}, totalLines: 1, positionPct: 50 });
  const r = await req("DELETE", "/api/selection");
  assert.equal(r.status, 200);
  const r2 = await req("GET", "/api/selection");
  assert.equal(r2.json, null);
});

await test("PUT without Origin header returns 403", async () => {
  const res = await fetch(`${BASE}/api/selection`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "markdown" }),
  });
  assert.equal(res.status, 403);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 1.2: Confirm smoke test fails (server has no /api/selection)**

Start the viewer server: `node bin/cli.js view 3000`

Run: `node scripts/smoke-selection.mjs 3000`

Expected: most tests fail with "404" or "connection refused". Confirm, then stop the server.

- [ ] **Step 1.3: Create `src/selection-formatter.js`**

```js
// src/selection-formatter.js

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : "");

export function formatSelectionAsText(sel) {
  if (!sel) return "";
  const lines = [];

  lines.push(`<editor-selection type="${sel.type}" file="${sel.file}">`);

  if (sel.type === "markdown") {
    lines.push(`Selected text (lines ${sel.startLine}–${sel.endLine}, cols ${sel.startCol}–${sel.endCol}):`);
    lines.push("");
    const text = sel.selectedText.length > 2000
      ? sel.selectedText.slice(0, 2000) + "…"
      : sel.selectedText;
    for (const l of text.split("\n")) lines.push(`  "${l}"`);
    lines.push("");
    if (sel.headingPath?.length) lines.push(`Location: ${sel.headingPath.join(" > ")}`);
    if (sel.contextBefore) lines.push(`Before: "${sel.contextBefore}"`);
    if (sel.contextAfter) lines.push(`After: "${sel.contextAfter}"`);
    lines.push(`Document: ${sel.totalLines} lines (position ~${sel.positionPct}%)`);
    if (sel.frontmatter && Object.keys(sel.frontmatter).length > 0) {
      const fm = Object.entries(sel.frontmatter)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(", ")}]` : v}`)
        .join(", ");
      lines.push(`Frontmatter: ${fm}`);
    }

  } else if (sel.type === "excalidraw") {
    const els = (sel.selectedElements || []).slice(0, 20);
    lines.push(`${els.length} shape${els.length !== 1 ? "s" : ""} selected:`);
    lines.push("");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const label = el.text ? ` "${el.text}"` : "";
      lines.push(`${i + 1}. ${cap(el.type)}${label} at (${Math.round(el.x)},${Math.round(el.y)}) ${Math.round(el.width)}×${Math.round(el.height)}px`);
      for (const b of (el.boundElements || [])) {
        const arrowLabel = b.arrowLabel ? ` "${b.arrowLabel}"` : "";
        const target = b.connectedElementText ? ` "${b.connectedElementText}"` : "";
        const arrow = b.direction === "out" ? "→" : "←";
        lines.push(`   ${arrow} arrow${arrowLabel} ${arrow}${target}`);
      }
      if (el.frameName) lines.push(`   Inside frame: "${el.frameName}"`);
    }
    if ((sel.selectedElements || []).length > 20)
      lines.push(`   … and ${sel.selectedElements.length - 20} more`);
    lines.push("");
    lines.push(`Scene: ${sel.totalElements} elements total`);

  } else if (sel.type === "tldraw") {
    const shapes = (sel.selectedShapes || []).slice(0, 20);
    lines.push(`${shapes.length} shape${shapes.length !== 1 ? "s" : ""} selected:`);
    lines.push("");
    for (let i = 0; i < shapes.length; i++) {
      const sh = shapes[i];
      const subtype = sh.geo ? ` (${sh.geo})` : "";
      const label = sh.text ? ` "${sh.text}"` : "";
      lines.push(`${i + 1}. ${cap(sh.type)}${subtype}${label} at (${Math.round(sh.x)},${Math.round(sh.y)}) ${Math.round(sh.width)}×${Math.round(sh.height)}px`);
      for (const a of (sh.connectedArrows || [])) {
        const arrowLabel = a.arrowLabel ? ` "${a.arrowLabel}"` : "";
        const other = a.otherEndText ? ` "${a.otherEndText}"` : "";
        const arrow = a.direction === "out" ? "→" : "←";
        lines.push(`   ${arrow} arrow${arrowLabel} ${arrow}${other}`);
      }
      if (sh.parentFrameName) lines.push(`   Parent frame: "${sh.parentFrameName}"`);
    }
    if ((sel.selectedShapes || []).length > 20)
      lines.push(`   … and ${sel.selectedShapes.length - 20} more`);
    lines.push("");
    lines.push(`Canvas: ${sel.totalShapes} shapes total`);

  } else if (sel.type === "duckdb") {
    const rows = (sel.selectedRows || []).slice(0, 50);
    const rowNums = rows.map(r => r.rowIndex + 1).join(",");
    lines.push(`${rows.length} row${rows.length !== 1 ? "s" : ""} selected from table "${sel.tableName}" (rows ${rowNums} of ${sel.totalRows}):`);
    lines.push("");
    const schema = (sel.schema || []).map(s => `${s.column} ${s.type}`).join(", ");
    lines.push(`Schema: ${schema}`);
    lines.push("");
    for (const row of rows) {
      const vals = Object.entries(row.data)
        .map(([k, v]) => `${k}=${v === null || v === undefined ? "NULL" : String(v)}`)
        .join("  ");
      lines.push(`Row ${row.rowIndex + 1}: ${vals}`);
    }
    if ((sel.selectedRows || []).length > 50)
      lines.push(`… and ${sel.selectedRows.length - 50} more rows`);
    if (sel.currentQuery) {
      lines.push("");
      lines.push(`Query: ${sel.currentQuery}`);
    }
  }

  lines.push("</editor-selection>");
  return lines.join("\n");
}
```

- [ ] **Step 1.4: Add `/api/selection` routes to `src/viewer-server.js`**

At the top of the file, add the import after the existing imports:

```js
import { formatSelectionAsText } from "./selection-formatter.js";
```

Directly after the `let sessionStates` declaration (near the top of the file, with the other module-level state), add:

```js
// volatile, in-memory — cleared on GET ?text=1
let selectionState = null;
```

In the request handler, add the following block **before the final 404 fallback** (the global CSRF guard at the top of the handler already protects PUT/DELETE, so no per-route check is needed):

```js
      // ── Selection context ─────────────────────────────────────────────────
      if (pathname === "/api/selection") {
        secHeaders(res);
        if (method === "GET") {
          if (url.searchParams.get("text") === "1") {
            const text = formatSelectionAsText(selectionState);
            selectionState = null;
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end(text);
          }
          return json(res, selectionState);
        }
        if (method === "PUT") {
          const body = await readBody(req);
          selectionState = (body && typeof body === "object") ? body : null;
          return json(res, { ok: true });
        }
        if (method === "DELETE") {
          selectionState = null;
          return json(res, { ok: true });
        }
      }
```

- [ ] **Step 1.5: Run smoke tests — all should pass**

Start the viewer server: `node bin/cli.js view 3000`

In another terminal: `node scripts/smoke-selection.mjs 3000`

Expected output:
```
  ✓  GET /api/selection returns null when empty
  ✓  PUT /api/selection stores markdown payload
  ✓  GET /api/selection returns stored payload
  ✓  GET /api/selection?text=1 returns formatted text and clears
  ✓  PUT /api/selection stores excalidraw payload
  ✓  PUT /api/selection stores tldraw payload
  ✓  PUT /api/selection stores duckdb payload
  ✓  DELETE /api/selection clears state
  ✓  PUT without Origin header returns 403

  9 passed, 0 failed
```

Stop the server.

- [ ] **Step 1.6: Commit**

```bash
git add src/selection-formatter.js src/viewer-server.js scripts/smoke-selection.mjs
git commit -m "feat: add /api/selection endpoints + selection text formatter"
```

---

## Task 2: SPA — `useSendSelection` Hook + Markdown Selection

**Files:**
- Modify: `src/viewer/entry.jsx`

- [ ] **Step 2.1: Add `useSendSelection` custom hook**

In `src/viewer/entry.jsx`, find the section of custom hooks (near the top, after the theme/utility functions — search for `function useT()`). Add the following hook after `useT`:

```jsx
// Debounces selection pushes to the viewer server.
// Call with a payload object to set, or null/undefined to clear.
function useSendSelection() {
  const timerRef = useRef(null);
  return useCallback((payload) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (payload) {
        fetch("/api/selection", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Origin: location.origin },
          body: JSON.stringify(payload),
        }).catch(() => {});
      } else {
        fetch("/api/selection", {
          method: "DELETE",
          headers: { Origin: location.origin },
        }).catch(() => {});
      }
    }, 300);
  }, []);
}
```

- [ ] **Step 2.2: Add helper functions for markdown payload**

In `src/viewer/entry.jsx`, just before the `NoteView` component definition (search for `function NoteView`), add:

```js
function parseFrontmatterFields(docText) {
  if (!docText.startsWith("---")) return {};
  const end = docText.indexOf("\n---", 3);
  if (end === -1) return {};
  const result = {};
  for (const line of docText.slice(3, end).split("\n")) {
    const m = line.match(/^([\w-]+):\s*(.+)/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

function buildMarkdownSelectionPayload(view, fileName) {
  const state = view.state;
  const sel = state.selection.main;
  if (sel.from === sel.to) return null; // cursor only

  const from = Math.min(sel.anchor, sel.head);
  const to   = Math.max(sel.anchor, sel.head);
  const selectedText = state.sliceDoc(from, to);
  if (!selectedText.trim()) return null;

  const fromLine = state.doc.lineAt(from);
  const toLine   = state.doc.lineAt(to);

  // Walk backward to collect enclosing headings (h1 → deepest)
  const headingPath = [];
  let lastLevel = 7;
  for (let ln = fromLine.number; ln >= 1; ln--) {
    const lineText = state.doc.line(ln).text;
    const m = lineText.match(/^(#{1,6})\s+(.+)/);
    if (m) {
      const level = m[1].length;
      if (level < lastLevel) {
        headingPath.unshift(m[2].trim());
        lastLevel = level;
        if (level === 1) break;
      }
    }
  }

  // Up to 2 non-empty lines before selection
  const beforeLines = [];
  for (let ln = fromLine.number - 1; ln >= 1 && beforeLines.length < 2; ln--) {
    const t = state.doc.line(ln).text.trim();
    if (t) beforeLines.unshift(t);
  }

  // Up to 2 non-empty lines after selection
  const afterLines = [];
  for (let ln = toLine.number + 1; ln <= state.doc.lines && afterLines.length < 2; ln++) {
    const t = state.doc.line(ln).text.trim();
    if (t) afterLines.push(t);
  }

  return {
    type: "markdown",
    file: fileName,
    selectedText,
    startLine: fromLine.number,
    endLine: toLine.number,
    startCol: from - fromLine.from,
    endCol: to - toLine.from,
    headingPath,
    contextBefore: beforeLines.join(" "),
    contextAfter: afterLines.join(" "),
    frontmatter: parseFrontmatterFields(state.doc.toString()),
    totalLines: state.doc.lines,
    positionPct: Math.round((fromLine.number / state.doc.lines) * 100),
  };
}
```

- [ ] **Step 2.3: Add selection updateListener to NoteView**

In `NoteView`, the CodeMirror `EditorView` is created inside a `useEffect([loading, name])`. Add `useSendSelection()` at the top of the `NoteView` component:

```jsx
const sendSelection = useSendSelection();
```

In the same `useEffect`, add a new `EditorView.updateListener.of(...)` to the `extensions` array (insert it just before the `makeDragReorderPlugin()` call at the end of extensions):

```js
          EditorView.updateListener.of(update => {
            if (!update.selectionSet && !update.docChanged) return;
            const payload = buildMarkdownSelectionPayload(update.view, name);
            sendSelection(payload || null);
          }),
```

The `sendSelection` reference needs to be stable across the `useEffect`. Since `sendSelection` comes from `useSendSelection()` (which uses `useCallback(fn, [])`) it is stable. However, because the `useEffect` dep array is `[loading, name]`, capture `sendSelection` in the closure at effect creation time — this is fine since it never changes.

- [ ] **Step 2.4: Build and manually verify markdown selection**

```bash
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=p.version.replace(/-dev$/,'')+'-dev';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version)"
npm run build:viewer
```

Kill and restart: `lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 0.5; node bin/cli.js view 3000 &`

Open http://127.0.0.1:3000 in a browser. Open any `.md` file. Select some text across multiple lines (spanning at least one heading).

Then check: `curl -s http://127.0.0.1:3000/api/selection | node -e "process.stdin.resume();process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)?.type,JSON.parse(d)?.selectedText?.slice(0,40)))"`

Expected: `markdown <first 40 chars of selected text>`

Then check the formatted output: `curl -s "http://127.0.0.1:3000/api/selection?text=1"`

Expected: `<editor-selection type="markdown" ...>` block with selected text, heading path, etc.

- [ ] **Step 2.5: Commit**

```bash
git add src/viewer/entry.jsx
git commit -m "feat: track markdown text selection and push to /api/selection"
```

---

## Task 3: SPA — Excalidraw Selection

**Files:**
- Modify: `src/viewer/entry.jsx`

- [ ] **Step 3.1: Add payload builder helper before DiagramEditor**

In `src/viewer/entry.jsx`, just before the `DiagramEditor` component definition (search for `function DiagramEditor`), add:

```js
function buildExcalidrawSelectionPayload(elements, appState, fileName) {
  const selectedIds = Object.keys(appState.selectedElementIds || {})
    .filter(id => appState.selectedElementIds[id]);
  if (!selectedIds.length) return null;

  const elemMap = Object.fromEntries(elements.map(el => [el.id, el]));

  const selectedElements = selectedIds.map(id => {
    const el = elemMap[id];
    if (!el) return null;

    // Resolve bound arrows: each entry in el.boundElements has type "arrow" + id
    const boundElements = [];
    for (const bound of (el.boundElements || [])) {
      if (bound.type !== "arrow") continue;
      const arrow = elemMap[bound.id];
      if (!arrow) continue;
      const isOut = arrow.startBinding?.elementId === el.id;
      const otherEndId = isOut
        ? arrow.endBinding?.elementId
        : arrow.startBinding?.elementId;
      const otherEl = otherEndId ? elemMap[otherEndId] : null;
      boundElements.push({
        direction: isOut ? "out" : "in",
        arrowLabel: arrow.text || "",
        connectedElementText: otherEl?.text || "",
      });
    }

    const frame = el.frameId ? elemMap[el.frameId] : null;

    return {
      type: el.type,
      text: el.text || "",
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      boundElements,
      frameName: frame?.name || frame?.title || null,
      groupIds: el.groupIds || [],
      link: el.link || null,
    };
  }).filter(Boolean);

  if (!selectedElements.length) return null;

  return {
    type: "excalidraw",
    file: fileName,
    selectedElements,
    totalElements: elements.length,
  };
}
```

- [ ] **Step 3.2: Wire selection tracking into DiagramEditor's handleChange**

In `DiagramEditor`, add `useSendSelection()` at the top of the component (alongside other hook calls):

```jsx
const sendSelection = useSendSelection();
```

The existing `handleChange` is:

```js
const handleChange = useCallback((elements, appState, files) => {
  if (dataRef.current) dataRef.current = { ...dataRef.current, elements, appState, files };
  debouncedSave(elements, appState, files);
}, [debouncedSave]);
```

Replace it with:

```js
const handleChange = useCallback((elements, appState, files) => {
  if (dataRef.current) dataRef.current = { ...dataRef.current, elements, appState, files };
  debouncedSave(elements, appState, files);
  sendSelection(buildExcalidrawSelectionPayload(elements, appState, name));
}, [debouncedSave, sendSelection, name]);
```

- [ ] **Step 3.3: Build and manually verify Excalidraw selection**

```bash
npm run build:viewer
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 0.5; node bin/cli.js view 3000 &
```

Open http://127.0.0.1:3000 and open any `.excalidraw` file. Click a shape to select it.

```bash
curl -s "http://127.0.0.1:3000/api/selection?text=1"
```

Expected: `<editor-selection type="excalidraw" file="...">` with the shape type, text, coordinates, and any connected arrows.

Select a shape connected to other shapes via arrows and verify the arrow metadata appears (direction, arrow label, connected element text).

- [ ] **Step 3.4: Commit**

```bash
git add src/viewer/entry.jsx
git commit -m "feat: track Excalidraw shape selection with arrow/frame metadata"
```

---

## Task 4: SPA — tldraw Selection

**Files:**
- Modify: `src/viewer/entry.jsx`

- [ ] **Step 4.1: Add tldraw connected-arrows helper before TldrawEditor**

In `src/viewer/entry.jsx`, just before the `TldrawEditor` component definition (search for `function TldrawEditor`), add:

```js
function getTldrawConnectedArrows(editor, shapeId) {
  const allShapes = editor.getCurrentPageShapes();
  const result = [];

  for (const shape of allShapes) {
    if (shape.type !== "arrow") continue;

    // tldraw v2: arrow bindings via props (pre-2.1) or via getBindingsFromShape (2.1+)
    let startId = null;
    let endId   = null;

    // Pre-2.1 style
    if (shape.props?.start?.type === "binding") startId = shape.props.start.boundShapeId;
    if (shape.props?.end?.type   === "binding") endId   = shape.props.end.boundShapeId;

    // 2.1+ style: check editor.getBindingsFromShape if available
    if (!startId && !endId && typeof editor.getBindingsFromShape === "function") {
      const bindings = editor.getBindingsFromShape(shape.id, "arrow") || [];
      for (const b of bindings) {
        if (b.props?.terminal === "start") startId = b.toId;
        if (b.props?.terminal === "end")   endId   = b.toId;
      }
    }

    const isOut = startId === shapeId;
    const isIn  = endId   === shapeId;
    if (!isOut && !isIn) continue;

    const otherEndId = isOut ? endId : startId;
    const otherShape = otherEndId ? editor.getShape(otherEndId) : null;

    result.push({
      direction: isOut ? "out" : "in",
      arrowLabel: shape.props?.text || "",
      otherEndText: otherShape?.props?.text || otherShape?.props?.label || "",
    });
  }
  return result;
}

function buildTldrawSelectionPayload(editor, fileName) {
  const ids = editor.getSelectedShapeIds();
  if (!ids.length) return null;

  const shapes = editor.getSelectedShapes();
  const currentPageId = editor.getCurrentPageId?.() ?? editor.currentPageId;
  const framePageId = `page:${currentPageId}`;
  const allShapes = editor.getCurrentPageShapes();

  const selectedShapes = shapes.map(shape => {
    const bounds = editor.getShapePageBounds?.(shape.id) ?? editor.getPageBounds?.(shape.id);
    const connectedArrows = getTldrawConnectedArrows(editor, shape.id);

    let parentFrameName = null;
    if (shape.parentId && shape.parentId !== framePageId) {
      const parent = editor.getShape(shape.parentId);
      if (parent?.type === "frame") parentFrameName = parent.props?.name || null;
    }

    return {
      type: shape.type,
      geo: shape.props?.geo ?? null,
      text: shape.props?.text || shape.props?.label || "",
      x: bounds?.x ?? shape.x ?? 0,
      y: bounds?.y ?? shape.y ?? 0,
      width: bounds?.w ?? shape.props?.w ?? 0,
      height: bounds?.h ?? shape.props?.h ?? 0,
      connectedArrows,
      parentFrameName,
    };
  });

  return {
    type: "tldraw",
    file: fileName,
    selectedShapes,
    totalShapes: allShapes.length,
  };
}
```

- [ ] **Step 4.2: Wire selection tracking into TldrawEditor**

In `TldrawEditor`, find the component body. Add these at the top of the component (with the other `useState`/`useRef` calls):

```jsx
const sendSelection  = useSendSelection();
const tldrawEditorRef = useRef(null);
```

After the existing `useEffect` hooks (or right after `setSavedSnap` is called in the initial load effect), add:

```jsx
  // Track tldraw selection changes via store listener
  useEffect(() => {
    const tled = tldrawEditorRef.current;
    if (!tled) return;
    const unsubscribe = tled.store.listen(() => {
      sendSelection(buildTldrawSelectionPayload(tled, name));
    });
    return () => unsubscribe();
  }, [name, sendSelection]); // re-registers if name changes
```

Find the `<Tldraw ...>` JSX element and add the `onMount` prop:

```jsx
        <Tldraw
          ...existing props...
          onMount={editor => { tldrawEditorRef.current = editor; }}
        />
```

- [ ] **Step 4.3: Build and manually verify tldraw selection**

```bash
npm run build:viewer
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 0.5; node bin/cli.js view 3000 &
```

Open http://127.0.0.1:3000 and open any `.tldraw` file. Draw a rectangle, click to select it.

```bash
curl -s "http://127.0.0.1:3000/api/selection?text=1"
```

Expected: `<editor-selection type="tldraw" ...>` with shape type, geo subtype, and coordinates.

Draw two shapes connected by an arrow. Select one shape and verify the connected arrow appears in the output.

- [ ] **Step 4.4: Commit**

```bash
git add src/viewer/entry.jsx
git commit -m "feat: track tldraw shape selection with arrow/frame metadata"
```

---

## Task 5: DuckDB Row Selection

**Files:**
- Modify: `src/viewer/DuckDBView.jsx`

- [ ] **Step 5.1: Add row selection state and handlers to `TableView`**

In `DuckDBView.jsx`, find the `TableView` function. Its signature currently looks like:
```js
function TableView({ name, T, onOpen, ... })
```

At the top of `TableView`, add these state and ref declarations alongside the existing ones:

```js
  const [selectedOrigIndices, setSelectedOrigIndices] = useState(() => new Set());
  const lastClickedIndexRef = useRef(null);
```

Add a `useEffect` to send selection to the server whenever `selectedOrigIndices` changes (add this after the existing effects, before the return):

```js
  useEffect(() => {
    if (!selectedOrigIndices.size) {
      fetch("/api/selection", {
        method: "DELETE",
        headers: { Origin: location.origin },
      }).catch(() => {});
      return;
    }

    const schema = (result?.columns || []).map(col => ({
      column: col,
      type: result?.columnTypes?.[col] || "TEXT",
    }));

    const sortedIndices = [...selectedOrigIndices].sort((a, b) => a - b);
    const selectedRows = sortedIndices.map(origIndex => ({
      rowIndex: origIndex,
      data: rows[origIndex] ?? {},
    }));

    fetch("/api/selection", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: location.origin },
      body: JSON.stringify({
        type: "duckdb",
        file: name.endsWith(".duckdb") ? name : `${name}.duckdb`,
        tableName: activeTable || name,
        schema,
        selectedRows,
        totalRows: rows.length,
        currentQuery: customSql || null,
      }),
    }).catch(() => {});
  }, [selectedOrigIndices, rows, result, activeTable, name, customSql]);
```

**Before wiring this up:** grep DuckDBView.jsx for `useState` and `const rows` to confirm the exact variable names. The variables referred to above (`rows`, `result`, `activeTable`, `customSql`) are the expected names — verify them. For the schema, check what fields `result` contains when a query completes by adding a temporary `console.log(result)` call. If `result.columnTypes` doesn't exist, fall back to `"TEXT"` for all columns: `(result?.columns || []).map(col => ({ column: col, type: "TEXT" }))`.

Add the click handler (add alongside other `useCallback` handlers):

```js
  const handleRowClick = useCallback((origIndex, e) => {
    setSelectedOrigIndices(prev => {
      const next = new Set(prev);
      if (e.metaKey || e.ctrlKey) {
        if (next.has(origIndex)) next.delete(origIndex);
        else next.add(origIndex);
      } else if (e.shiftKey && lastClickedIndexRef.current !== null) {
        const lo = Math.min(lastClickedIndexRef.current, origIndex);
        const hi = Math.max(lastClickedIndexRef.current, origIndex);
        for (let i = lo; i <= hi; i++) next.add(i);
      } else {
        if (next.size === 1 && next.has(origIndex)) next.clear();
        else { next.clear(); next.add(origIndex); }
      }
      return next;
    });
    lastClickedIndexRef.current = origIndex;
  }, []);
```

- [ ] **Step 5.2: Add click handler and highlight to table rows**

Find the `<tr>` element inside the `indexedRows.map(...)` render (around the line that renders `<td>` cells). It currently looks roughly like:

```jsx
<tr key={origIndex} style={{ ... }}>
```

Add `onClick` and a conditional background to that `<tr>`:

```jsx
<tr
  key={origIndex}
  onClick={e => handleRowClick(origIndex, e)}
  style={{
    ...existing style...,
    cursor: "pointer",
    background: selectedOrigIndices.has(origIndex)
      ? T.accent + "22"
      : undefined,
    userSelect: "none",
  }}
>
```

- [ ] **Step 5.3: Clear selection when navigating away**

Find the `useEffect` that fires when `name` or `activeTable` changes and resets state (there will be one that calls `setRows([])` or similar). Add `setSelectedOrigIndices(new Set())` to that effect so stale selection doesn't persist when the user switches tables.

If no such effect exists, add one:

```js
  useEffect(() => {
    setSelectedOrigIndices(new Set());
    lastClickedIndexRef.current = null;
  }, [name, activeTable]);
```

- [ ] **Step 5.4: Build and manually verify DuckDB row selection**

```bash
npm run build:viewer
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 0.5; node bin/cli.js view 3000 &
```

Open http://127.0.0.1:3000 and open a `.duckdb` file. Click a row — it should highlight (subtle blue tint). Shift-click another row to extend the selection. Cmd/Ctrl-click to add individual rows.

```bash
curl -s "http://127.0.0.1:3000/api/selection?text=1"
```

Expected: `<editor-selection type="duckdb" ...>` with selected row data, schema, and row count.

Click the same row again to deselect — verify the selection clears:
```bash
curl -s "http://127.0.0.1:3000/api/selection"
```
Expected: `null`

- [ ] **Step 5.5: Commit**

```bash
git add src/viewer/DuckDBView.jsx
git commit -m "feat: DuckDB row selection with click/shift/cmd and server push"
```

---

## Task 6: `init.js` — Install `UserPromptSubmit` Hook

**Files:**
- Modify: `src/init.js`

- [ ] **Step 6.1: Add `buildUserPromptSubmitHook` and `mergeUserPromptSubmitHook` to `src/init.js`**

In `src/init.js`, find `buildSessionStartHook()`. Add the following two functions directly after it:

```js
function buildUserPromptSubmitHook() {
  // resolveBin("node") is defined in this file — reuse it.
  const nodeBin  = resolveBin("node");
  const nodeExec = nodeBin ? `"${nodeBin}"` : "node";

  // Reads port from .claude/launch.json at hook fire time (not baked in — port
  // is project-specific and may change if the user re-runs init).
  const portScript = `try{JSON.parse(require('fs').readFileSync('.claude/launch.json','utf8')).configurations.find(c=>c.name==='Embedded Editor')?.port||3000}catch(e){3000}`;

  return {
    type: "command",
    // Single string: compute port, then curl the selection endpoint.
    // Falls back silently if server is not running (|| true).
    command: `PORT=$(${nodeExec} -p "${portScript}" 2>/dev/null || echo 3000); curl -sf --max-time 1 "http://127.0.0.1:$PORT/api/selection?text=1" 2>/dev/null || true`,
    timeout: 5,
  };
}

function mergeUserPromptSubmitHook(existingHooks) {
  const hooks = existingHooks ? JSON.parse(JSON.stringify(existingHooks)) : {};
  const hook = buildUserPromptSubmitHook();
  const existing = hooks.UserPromptSubmit || [];
  // Idempotent: skip if this exact command string is already present.
  if (existing.some(h => h.command === hook.command)) return hooks;
  hooks.UserPromptSubmit = [...existing, hook];
  return hooks;
}
```

- [ ] **Step 6.2: Call `mergeUserPromptSubmitHook` from `writeSettings`**

Find the `writeSettings` function. It currently calls `mergeSessionStartHook(existing)` to build the hooks object. Change it to also call `mergeUserPromptSubmitHook`:

Current code:
```js
  const merged = {
    ...existing,
    hooks: mergeSessionStartHook(existing),
    mcpServers: { ... },
  };
```

Replace with:
```js
  const merged = {
    ...existing,
    hooks: mergeUserPromptSubmitHook(mergeSessionStartHook(existing)),
    mcpServers: { ... },
  };
```

- [ ] **Step 6.3: Manually verify `init` adds the hook**

```bash
# Create a temp directory and run init there
mkdir -p /tmp/test-init-selection && cd /tmp/test-init-selection
node /Users/vaibha/Downloads/git/embedded_editor_for_claude_code/bin/cli.js init
cat .claude/settings.json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(JSON.stringify(d.hooks?.UserPromptSubmit, null, 2))"
```

Expected output: an array containing one entry with `"type": "command"` and a `command` string that includes `api/selection?text=1`.

Run `init` a second time to verify idempotency:
```bash
node /Users/vaibha/Downloads/git/embedded_editor_for_claude_code/bin/cli.js init
cat .claude/settings.json | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('hooks count:', d.hooks?.UserPromptSubmit?.length)"
```

Expected: `hooks count: 1` (not 2 — the deduplication check works).

Clean up: `cd - && rm -rf /tmp/test-init-selection`

- [ ] **Step 6.4: Commit**

```bash
git add src/init.js
git commit -m "feat: install UserPromptSubmit hook for selection context via init"
```

---

## Task 7: Final Build + End-to-End Verification

**Files:**
- Modify: `package.json` (revert `-dev` version suffix)

- [ ] **Step 7.1: Revert the `-dev` version suffix**

```bash
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=p.version.replace(/-dev$/,'');fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version)"
```

Expected: prints the clean version e.g. `1.3.0`.

- [ ] **Step 7.2: Final production build**

```bash
npm run build:viewer
```

Expected: `Bundle done in X.Xs → vendor/viewer.js + vendor/viewer.css`

- [ ] **Step 7.3: Run smoke tests**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 0.5; node bin/cli.js view 3000 &
sleep 1
node scripts/smoke-selection.mjs 3000
```

Expected: `9 passed, 0 failed`

- [ ] **Step 7.4: Run the existing smoke tests to catch regressions**

```bash
node scripts/smoke-stdio.mjs
```

Expected: all existing tests pass.

- [ ] **Step 7.5: End-to-end hook test**

With the viewer server still running, simulate what the `UserPromptSubmit` hook does:

```bash
# Select something in the browser first, then:
PORT=3000
curl -sf --max-time 1 "http://127.0.0.1:${PORT}/api/selection?text=1" || echo "(nothing selected)"
```

If something is selected in the browser, the formatted `<editor-selection>` block should print. Running the command a second time should return nothing (one-shot confirmed).

- [ ] **Step 7.6: Kill dev server**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null
```

- [ ] **Step 7.7: Commit**

```bash
git add package.json vendor/viewer.js vendor/viewer.css
git commit -m "build: production bundle for editor selection context feature"
```

---

## Summary of Commits

| Commit | What it adds |
|--------|-------------|
| `feat: add /api/selection endpoints + selection text formatter` | Server endpoint + formatter + smoke tests |
| `feat: track markdown text selection and push to /api/selection` | NoteView selection tracking |
| `feat: track Excalidraw shape selection with arrow/frame metadata` | DiagramEditor selection tracking |
| `feat: track tldraw shape selection with arrow/frame metadata` | TldrawEditor selection tracking |
| `feat: DuckDB row selection with click/shift/cmd and server push` | TableView row selection UI |
| `feat: install UserPromptSubmit hook for selection context via init` | init.js hook installation |
| `build: production bundle for editor selection context feature` | Final build |
