# Editor Selection Context — Design Spec

**Date:** 2026-05-02  
**Branch:** feat/editor-selection-context  
**Status:** Approved

## Overview

When the user selects text in a markdown note, shapes in an Excalidraw or tldraw diagram, or rows in a DuckDB table, that selection is automatically injected as structured context into the next Claude Code message. After injection the selection is cleared (one-shot). Claude can infer continuity from conversation flow for follow-up messages.

## Architecture

Three layers:

```
Browser SPA                    Viewer Server              Claude Code
──────────────                 ─────────────              ───────────
Selection trackers    PUT →    /api/selection         UserPromptSubmit
(all 4 editor types)   ←GET   (in-memory, one-shot)  hook reads + clears
debounced 300ms        ?text=1 → formatted text       → injected before msg
```

- **SPA** tracks selection across all four editor types and debounces pushes (300ms) to `PUT /api/selection`
- **Server** holds one volatile in-memory slot (`let selectionState = null`) — no file persistence
- **Hook** calls `GET /api/selection?text=1` on every message submit; receives formatted text and the state is atomically cleared. If nothing is selected the hook outputs nothing and exits cleanly

## Selection Tracking Per Editor

### Markdown (CodeMirror)

Add an `updateListener` extension. Fires when `update.selectionSet` is true and selection has non-zero length (anchor ≠ head). Payload:

- `file` — note filename (always first)
- `selectedText` — the selected string
- `startLine`, `endLine`, `startCol`, `endCol` — 1-based line numbers, 0-based columns
- `headingPath` — array of enclosing heading strings from h1 → deepest heading, computed by walking backward through the doc
- `contextBefore` — up to 2 lines immediately before the selection
- `contextAfter` — up to 2 lines immediately after
- `frontmatter` — key/value object parsed from leading `---` block if present
- `totalLines`, `positionPct` — document stats

Clear condition: selection collapses to zero-length (cursor only).

### Excalidraw

`onChange(elements, appState, files)` already fires on every change. Check `appState.selectedElementIds` (object `{id: true, ...}`). When non-empty, compute payload:

- `file` — diagram filename (always first)
- `selectedElements` — array, one entry per selected element:
  - `type` — rectangle, ellipse, diamond, text, arrow, line, image, frame, freedraw
  - `text` — text/label content
  - `x`, `y`, `width`, `height`
  - `boundElements` — arrows in/out: `{ direction: "in"|"out", arrowLabel, connectedElementText }`
  - `frameId`, `frameName` — if inside a frame
  - `groupIds` — group membership
  - `link` — custom link if set
- `totalElements` — scene element count

No `excalidrawRef` needed — all data is available in the `onChange` args.

Clear condition: `selectedElementIds` becomes empty.

### tldraw

Use `<Tldraw onMount={editor => setEditor(editor)}>` to capture the editor instance. In a `useEffect`, register `editor.store.listen(() => { ... })`. Read selection via `editor.getSelectedShapes()`. Payload:

- `file` — canvas filename (always first)
- `selectedShapes` — array, one entry per selected shape:
  - `type` — geo, arrow, text, draw, embed, etc.
  - `geo` — rectangle, ellipse, etc. (for geo shapes)
  - `text` — label content
  - `x`, `y`, `width`, `height` — from `editor.getShapePageBounds(shape.id)`
  - `connectedArrows` — arrows that start or end at this shape: `{ arrowLabel, otherEndText, direction: "in"|"out" }`
  - `parentFrameName` — if inside a frame shape
- `totalShapes` — count on current page

Clear condition: selected shape IDs become empty.

### DuckDB

Add row selection state to `TableView`. Interaction:

- Click row → select (toggle if already selected)
- Shift+click → range select
- Cmd/Ctrl+click → additive multi-select
- Visual: subtle background tint on selected rows (consistent with existing theme tokens)

Payload:

- `file` — table filename (always first)
- `tableName` — active table name
- `schema` — array of `{ column, type }` from DuckDB column metadata
- `selectedRows` — array of `{ rowIndex, data }` where `data` is the full row object
- `totalRows` — count in current query result
- `currentQuery` — active SQL string if running a custom view/query

Clear condition: selected rows set becomes empty, or user navigates away from table.

## Server Endpoints

All new endpoints follow existing CSRF pattern (PUT/DELETE require `Origin` header matching localhost).

```
PUT    /api/selection          Store selection payload (JSON body, 5 MB limit)
GET    /api/selection          Return raw selection JSON (for debugging)
GET    /api/selection?text=1   Return formatted text context + atomically clear state
DELETE /api/selection          Explicit clear
```

In-memory state in `viewer-server.js`:
```js
let selectionState = null;
```

The `?text=1` GET path formats the payload into the `<editor-selection>` block (see Format section below) then sets `selectionState = null` before returning.

## Context Format

Injected as a tagged block before the user's message. The `<editor-selection>` tag scopes it clearly so Claude does not conflate it with user content.

### Markdown
```
<editor-selection type="markdown" file="notes/architecture.md">
Selected text (lines 12–15, cols 0–84):

  "The authentication flow uses JWT tokens that expire after 24 hours.
  Refresh tokens have a 30-day window and rotate on use."

Location: Architecture > Security > Authentication
Before: "Each service authenticates via the central auth gateway."
After: "Token rotation happens automatically within the last hour of validity."
Document: 120 lines (position ~12%)
Frontmatter: tags=[security, auth], status=draft
</editor-selection>
```

### Excalidraw
```
<editor-selection type="excalidraw" file="system.excalidraw">
2 shapes selected:

1. Rectangle "User Service" at (100,200) 150×80px
   → arrow "HTTP" → "Database"
   → arrow "calls" → "Auth Service"
   Inside frame: "Backend Layer"

2. Rectangle "Database" at (300,200) 120×80px
   ← arrow "HTTP" ← "User Service"
   ← arrow "reads" ← "Cache"
   Inside frame: "Backend Layer"

Scene: 42 elements total
</editor-selection>
```

### tldraw
```
<editor-selection type="tldraw" file="wireframe.tldraw">
1 shape selected:

1. Geo (rectangle) "Login Form" at (200,150) 300×400px
   → arrow "submit" → "Dashboard"
   Parent frame: "Onboarding Flow"

Canvas: 28 shapes total
</editor-selection>
```

### DuckDB
```
<editor-selection type="duckdb" file="jobs.duckdb">
2 rows selected from table "jobs" (rows 3,7 of 45):

Schema: company TEXT, role TEXT, status TEXT, applied DATE, notes TEXT

Row 3: company=Anthropic  role=Engineer    status=interview  applied=2026-04-15  notes="Technical round 2"
Row 7: company=OpenAI     role=Researcher  status=applied    applied=2026-04-20  notes=""

Query: SELECT * FROM jobs WHERE status IN ('applied','interview') ORDER BY applied DESC
</editor-selection>
```

## UserPromptSubmit Hook

Single command string installed into `"UserPromptSubmit"` in the user's `.claude/settings.json` by the `init` command (stored as one string with `;` separator, matching the existing SessionStart hook pattern):

```sh
PORT=$(node -p "try{JSON.parse(require('fs').readFileSync('.claude/launch.json','utf8')).configurations.find(c=>c.name==='Embedded Editor')?.port||3000}catch(e){3000}" 2>/dev/null || echo 3000); curl -sf --max-time 1 "http://127.0.0.1:${PORT}/api/selection?text=1" 2>/dev/null || true
```

- Port is read from `.claude/launch.json` (written by `editor-start` / `init`) with a fallback of 3000
- If the server is down, not running, or nothing is selected, the hook outputs nothing and exits cleanly — no effect on the message
- The `|| true` prevents non-zero exit from blocking message submission

The `init` command in `bin/cli.js` adds this hook to the `UserPromptSubmit` array in `.claude/settings.json`:
- Read existing `settings.json` (or start from `{}`)
- Ensure `hooks.UserPromptSubmit` is an array
- Check if an entry with this exact command string already exists — if so, skip (idempotent re-runs)
- Otherwise push `{ "type": "command", "command": "<the string above>", "timeout": 5 }`
- Write back without touching any other hooks or settings keys

## Files Changed

| File | Change |
|------|--------|
| `src/viewer-server.js` | Add `selectionState`, `PUT/GET/DELETE /api/selection` endpoints, text formatter |
| `src/viewer/entry.jsx` | Markdown: updateListener; Excalidraw: selection detection in onChange; tldraw: onMount + store.listen |
| `src/viewer/DuckDBView.jsx` | Row selection state, click/shift/cmd handlers, highlight styles |
| `bin/cli.js` | `init` command: add `UserPromptSubmit` hook to generated `.claude/settings.json` |

## Non-Goals

- Persistent selection history across sessions
- Multi-window/tab selection merging
- Selection from embedded `![[...]]` previews inside notes (full-page editors only for v1)
- tldraw arrow connection metadata beyond label + endpoint text (tldraw's arrow binding API is more complex; basic coverage is sufficient for v1)
