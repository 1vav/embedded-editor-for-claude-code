# Per-Session Editor State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope editor tab/active-file state to each Claude Code chat session, fix the "goes blank on session switch" bug, rename `.excalidraw-recent.json`, and use `cwd` directly as the workspace root.

**Architecture:** Session ID is extracted from `PATH` in the `editor-start` skill and injected into the SPA via `preview_eval` → `localStorage`. The SPA scopes `ee-tabs` / `ee-active` to `ee-tabs-<sessionId>` / `ee-active-<sessionId>`. Two new server endpoints (`GET`/`PUT /api/session/:id`) store the same state in-memory so the MCP server can later query it. `scrollPosition` and `panelSizes` are in the state shape but stubbed (no corresponding UI elements exist yet).

**Tech Stack:** Node.js ESM, React (JSX, no build step needed for server; `npm run build:viewer` for SPA), `localStorage`, in-memory `Map` on the HTTP server.

---

### Task 1: Create feature branch

**Files:**
- (none — git only)

- [ ] **Step 1: Create branch from main**

```bash
git checkout main && git pull && git checkout -b feat/per-session-editor-state
```

Expected: `Switched to a new branch 'feat/per-session-editor-state'`

---

### Task 2: Fix workspace root — use `cwd` directly

**Files:**
- Modify: `src/paths.js`

The current `resolveRoot()` calls `findProjectRoot(cwd)` which walks up the directory tree looking for `.git`/`.claude`/`CLAUDE.md`. This causes files to land in the repo root rather than wherever Claude Code is actually running. Fix: use `process.cwd()` directly.

- [ ] **Step 1: Remove `findProjectRoot` and simplify `resolveRoot`**

Open `src/paths.js`. Delete the entire `findProjectRoot` function (lines ~18–32). Replace the two `findProjectRoot(process.cwd())` call-sites in `resolveRoot()` with `process.cwd()`:

```js
export function resolveRoot() {
  const raw = process.env.EXCALIDRAW_ROOT;
  const log = (msg) => { try { process.stderr.write(`[embedded-editor] ${msg}\n`); } catch {} };

  if (!raw) {
    const detected = process.cwd();
    log(`EXCALIDRAW_ROOT unset; using cwd=${detected}`);
    return detected;
  }

  const expanded = expandPath(raw);

  if (expanded === ".") {
    const detected = process.cwd();
    log(`EXCALIDRAW_ROOT="." (legacy); using cwd=${detected}`);
    return detected;
  }

  if (/\$\{[^}]+\}|(?<![\\a-zA-Z0-9])\$[A-Za-z_]\w*/.test(expanded)) {
    const detected = process.cwd();
    log(`EXCALIDRAW_ROOT=${JSON.stringify(raw)} contains unresolved templates; using cwd=${detected}`);
    return detected;
  }

  const resolved = path.resolve(expanded);
  log(`EXCALIDRAW_ROOT=${JSON.stringify(raw)} → ${resolved}`);
  return resolved;
}
```

Also remove the unused `existsSync` import since `findProjectRoot` was the only user of it:

```js
// Before
import { existsSync } from "fs";

// After — remove this line entirely
```

- [ ] **Step 2: Verify smoke test still passes**

```bash
node scripts/smoke-stdio.mjs
```

Expected: all assertions print `✓`, process exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/paths.js
git commit -m "fix: use cwd directly as workspace root, remove directory walk-up"
```

---

### Task 3: Rename `.excalidraw-recent.json` → `.editor-recent.json`

**Files:**
- Modify: `src/viewer-server.js`

- [ ] **Step 1: Update `RECENT_F` constant and add migration**

In `src/viewer-server.js`, find the `RECENT_F` constant (around line 43):

```js
// Before
const RECENT_F   = path.join(CWD, ".excalidraw-recent.json");
```

Replace with:

```js
const RECENT_F     = path.join(CWD, ".editor-recent.json");
const RECENT_F_OLD = path.join(CWD, ".excalidraw-recent.json");
```

Then find the `startViewerServer` function (or the top-level startup code). Add the migration right after server setup but before the `listen` call — look for where the server starts listening and add this before it:

```js
// One-time migration: rename legacy recent file
try {
  const { existsSync, renameSync } = await import("fs");
  if (existsSync(RECENT_F_OLD) && !existsSync(RECENT_F)) {
    renameSync(RECENT_F_OLD, RECENT_F);
  }
} catch {}
```

Note: `fs/promises` is already imported as `fs`; the synchronous `existsSync`/`renameSync` are imported from the built-in `"fs"` module. Check the existing imports — `writeFileSync` and `readFileSync` are already imported from `"fs"` (not `"fs/promises"`). Add `existsSync` and `renameSync` to that same import:

```js
// Find the existing line:
import { writeFileSync, readFileSync } from "fs";
// Change to:
import { writeFileSync, readFileSync, existsSync, renameSync } from "fs";
```

Then add the migration call at the top of `startViewerServer` (or inline after the imports at module level — whichever keeps it synchronous before any request is served):

```js
// At module level, after RECENT_F / RECENT_F_OLD are declared:
if (existsSync(RECENT_F_OLD) && !existsSync(RECENT_F)) {
  try { renameSync(RECENT_F_OLD, RECENT_F); } catch {}
}
```

- [ ] **Step 2: Verify smoke test**

```bash
node scripts/smoke-stdio.mjs
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/viewer-server.js
git commit -m "fix: rename .excalidraw-recent.json to .editor-recent.json with auto-migration"
```

---

### Task 4: Add `/api/session/:id` endpoints to viewer-server

**Files:**
- Modify: `src/viewer-server.js`

- [ ] **Step 1: Add in-memory session store**

Near the top of `src/viewer-server.js`, after the existing cache declarations (`svgCache`, `pngCache`, `renderLocks`), add:

```js
// Per-session UI state — keyed by session ID, in-memory only (ephemeral by design)
const sessionStates = new Map(); // sessionId → SessionState
```

- [ ] **Step 2: Add GET and PUT handlers**

Find the large `if/else if` chain that routes requests (search for `pathname === "/api/recent"`). Add two new cases in the same block, alongside the other `/api/…` routes:

```js
// GET /api/session/:id  — return session state or {}
if (method === "GET" && pathname.startsWith("/api/session/")) {
  const sid = decodeURIComponent(pathname.slice("/api/session/".length));
  return json(res, sessionStates.get(sid) ?? {});
}

// PUT /api/session/:id  — save session state
// (origin check already applied globally above for all PUT/POST/DELETE)
if (method === "PUT" && pathname.startsWith("/api/session/")) {
  const sid = decodeURIComponent(pathname.slice("/api/session/".length));
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const state = JSON.parse(body);
    sessionStates.set(sid, state);
    return json(res, { ok: true });
  } catch {
    res.writeHead(400); res.end("bad json");
  }
  return;
}
```

`json` is defined at line 282 of `viewer-server.js`. Origin checking is already handled globally (before this handler runs) for all `PUT` requests.

- [ ] **Step 3: Verify the new endpoints with curl**

Start the viewer server:

```bash
lsof -ti:3858 | xargs kill -9 2>/dev/null; sleep 0.3
node bin/cli.js view 3858 &
sleep 1
```

Test GET (empty):

```bash
curl -s http://127.0.0.1:3858/api/session/test-123
```

Expected: `{}`

Test PUT:

```bash
curl -s -X PUT http://127.0.0.1:3858/api/session/test-123 \
  -H "Origin: http://127.0.0.1:3858" \
  -H "Content-Type: application/json" \
  -d '{"activeFile":{"name":"foo","type":"excalidraw"},"openTabs":[{"name":"foo","type":"excalidraw"}]}'
```

Expected: `{"ok":true}`

Test GET (hydrated):

```bash
curl -s http://127.0.0.1:3858/api/session/test-123
```

Expected: `{"activeFile":{"name":"foo","type":"excalidraw"},"openTabs":[{"name":"foo","type":"excalidraw"}]}`

Kill the background server:

```bash
lsof -ti:3858 | xargs kill -9 2>/dev/null
```

- [ ] **Step 4: Commit**

```bash
git add src/viewer-server.js
git commit -m "feat: add GET/PUT /api/session/:id endpoints for per-session UI state"
```

---

### Task 5: Update SPA — session-scoped localStorage + server sync

**Files:**
- Modify: `src/viewer/entry.jsx`

The SPA currently stores `ee-tabs` and `ee-active` as shared localStorage keys. This task scopes them to the session ID and adds server sync.

- [ ] **Step 1: Add session ID helper near the top of the App component**

Find the `function App()` declaration (around line 2760). Add this just inside the function body, before the state declarations:

```js
// Read session ID injected by editor-start via localStorage; fall back to 'default'
const sessionId = localStorage.getItem('editorSession') ?? 'default';
const tabsKey   = `ee-tabs-${sessionId}`;
const activeKey = `ee-active-${sessionId}`;
```

- [ ] **Step 2: Scope the tabs and active localStorage keys**

Find these two `useState` initialisers (around lines 2771–2772):

```js
const [tabs,   setTabs]   = useState(() => { try { return JSON.parse(localStorage.getItem("ee-tabs")   ?? "[]");   } catch { return []; }   });
const [active, setActive] = useState(() => { try { return JSON.parse(localStorage.getItem("ee-active") ?? "null"); } catch { return null; } });
```

Replace with:

```js
const [tabs,   setTabs]   = useState(() => { try { return JSON.parse(localStorage.getItem(tabsKey)   ?? "[]");   } catch { return []; }   });
const [active, setActive] = useState(() => { try { return JSON.parse(localStorage.getItem(activeKey) ?? "null"); } catch { return null; } });
```

Find the two `useEffect` persistence lines (around lines 2774–2775):

```js
useEffect(() => { try { localStorage.setItem("ee-tabs",   JSON.stringify(tabs));   } catch {} }, [tabs]);
useEffect(() => { try { localStorage.setItem("ee-active", JSON.stringify(active)); } catch {} }, [active]);
```

Replace with:

```js
useEffect(() => { try { localStorage.setItem(tabsKey,   JSON.stringify(tabs));   } catch {} }, [tabs, tabsKey]);
useEffect(() => { try { localStorage.setItem(activeKey, JSON.stringify(active)); } catch {} }, [active, activeKey]);
```

- [ ] **Step 3: Add server sync — save state to `/api/session/:id` on change**

Add a debounced save effect after the two localStorage effects above:

```js
const sessionSaveTimer = useRef(null);
useEffect(() => {
  clearTimeout(sessionSaveTimer.current);
  sessionSaveTimer.current = setTimeout(() => {
    fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({
        activeFile: active,
        openTabs: tabs,
        scrollPosition: { x: 0, y: 0 },
        panelSizes: { sidebar: 240 },
      }),
    }).catch(() => {});
  }, 500);
}, [tabs, active, sessionId]);
```

- [ ] **Step 4: Restore session state from server on mount**

Add a one-time restore effect after the save effect. It fetches the server-side state and prefers it if it has content (server wins over localStorage on session reconnect):

```js
const sessionRestored = useRef(false);
useEffect(() => {
  if (sessionRestored.current) return;
  sessionRestored.current = true;
  fetch(`/api/session/${encodeURIComponent(sessionId)}`)
    .then(r => r.json())
    .then(state => {
      if (!state.openTabs?.length) return; // nothing saved yet
      setTabs(state.openTabs);
      if (state.activeFile) setActive(state.activeFile);
    })
    .catch(() => {});
}, [sessionId]);
```

- [ ] **Step 5: Build the viewer bundle**

```bash
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=p.version.replace(/-dev$/,'')+'-dev';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version)"
npm run build:viewer
```

Expected: `Bundle done in …s  →  vendor/viewer.js + vendor/viewer.css`

- [ ] **Step 6: Start server and verify in browser**

```bash
lsof -ti:3858 | xargs kill -9 2>/dev/null; sleep 0.3
```

Then call `preview_start` with name `"Embedded Editor"`. Open a file, switch to a new session (open a second tab in Claude Code), verify it starts fresh. Switch back — the original file should still be in tabs.

- [ ] **Step 7: Commit**

```bash
git add src/viewer/entry.jsx package.json vendor/viewer.js vendor/viewer.css
git commit -m "feat: scope tab/active-file state to session ID, sync to server"
```

---

### Task 6: Update `editor-start` skill — inject session ID via preview_eval

**Files:**
- Modify: `/Users/vaibha/.claude/commands/editor-start.md`

- [ ] **Step 1: Add `mcp__Claude_Preview__preview_eval` to allowed-tools**

Change the frontmatter:

```markdown
---
description: Start the Embedded Editor viewer (diagrams · canvases · notes · code)
allowed-tools: Bash, mcp__Claude_Preview__preview_start, mcp__Claude_Preview__preview_eval
---
```

- [ ] **Step 2: Add Step 4 — extract session ID**

Append after the existing Step 3 (`preview_start` call):

````markdown
**Step 4.** Extract the Claude Code session ID from PATH and inject it into the preview pane so the SPA can scope its state per chat:

```bash
SESSION_ID=$(echo "$PATH" | grep -oE 'local-agent-mode-sessions/[^/]+/[0-9a-f-]{36}' | head -1 | grep -oE '[0-9a-f-]{36}$')
if [ -z "$SESSION_ID" ]; then
  SESSION_ID=$(node -e "const {randomUUID}=require('crypto');process.stdout.write(randomUUID())")
fi
echo "EDITOR_SESSION=$SESSION_ID"
```

Then call `preview_eval` with this exact JS (substitute the real `$SESSION_ID` value into the string):

```js
(function(){
  var next = "REPLACE_WITH_SESSION_ID";
  var prev = localStorage.getItem('editorSession');
  if (prev !== next) {
    localStorage.setItem('editorSession', next);
    window.location.reload();
  }
})()
```

If `preview_start` returned `reused: true`, the page is already loaded and `preview_eval` will run immediately. If `reused: false`, wait ~1 second for the page to load before calling `preview_eval`.
````

- [ ] **Step 3: Verify the skill works end-to-end**

Invoke `/editor-start` in Claude Code. Confirm:
1. `preview_start` opens the editor
2. `preview_eval` runs and sets `localStorage.editorSession` to the extracted UUID
3. Switching sessions and sending a message re-runs the skill and reloads the preview

---

### Task 7: Revert version `-dev` suffix before shipping

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Restore clean version**

```bash
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=p.version.replace(/-dev$/,'');fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version)"
```

Expected output: `1.2.1` (no `-dev` suffix)

- [ ] **Step 2: Rebuild with production version**

```bash
npm run build:viewer
```

- [ ] **Step 3: Run full smoke test**

```bash
node scripts/smoke-stdio.mjs
```

Expected: all `✓`, exits 0.

- [ ] **Step 4: Commit**

```bash
git add package.json vendor/viewer.js vendor/viewer.css
git commit -m "chore: revert -dev version suffix, rebuild production bundle"
```

---

### Task 8: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/per-session-editor-state
```

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --title "feat: per-session editor state, cwd workspace root, rename recent file" \
  --body "$(cat <<'EOF'
## Summary
- Each Claude Code chat session now independently tracks open tabs and active file — switching sessions no longer clobbers editor state
- Preview pane auto-reconnects on session switch via `editor-start` → `preview_eval` reload
- Workspace root is now `cwd` directly (removed walk-up that sent files to repo root)
- `.excalidraw-recent.json` renamed to `.editor-recent.json` with auto-migration on startup
- New `GET`/`PUT /api/session/:id` endpoints store session state in-memory on the HTTP server

## Test plan
- [ ] Open two Claude Code sessions in the same folder
- [ ] Open different files in each session
- [ ] Switch between sessions — each should show its own tabs
- [ ] Start the server in a subdirectory — files should appear there, not the repo root
- [ ] Confirm `.editor-recent.json` is created (not `.excalidraw-recent.json`) on first file open
- [ ] `node scripts/smoke-stdio.mjs` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes

- `scrollPosition` and `panelSizes` are included in the server-side state shape but not tracked in the SPA — the main content area uses `overflow: hidden` and there is no resizable sidebar panel yet. Both default to `{x:0,y:0}` and `{sidebar:240}` respectively in the PUT body.
- The `editor-start` skill lives at `/Users/vaibha/.claude/commands/editor-start.md` (user-level, not project-level).
- The `preview_eval` call must happen after the page has loaded. If `preview_start` returns `reused: false`, add a 1-second wait before calling `preview_eval`.
