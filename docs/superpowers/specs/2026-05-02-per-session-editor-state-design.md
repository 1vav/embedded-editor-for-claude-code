# Per-Session Editor State

**Date:** 2026-05-02
**Status:** Approved, pending implementation

## Problem

When multiple Claude Code sessions share the same project folder, the editor preview pane goes blank on session switch and must be manually restarted. All sessions share a single editor state (open tabs, active file, sidebar, scroll), so switching sessions loses the editing context for each chat.

## Goals

1. Preview pane automatically reconnects when a session becomes active again
2. Each chat session independently tracks: open tabs, active file, sidebar state, scroll position, panel sizes
3. Rename `.excalidraw-recent.json` → `.editor-recent.json` (historical naming artifact)
4. Files created in `cwd` rather than the project root found by walking up the directory tree

## Non-Goals

- Persisting session state across HTTP server restarts (in-memory is sufficient)
- Sharing state between sessions

---

## Section 1 — Session ID Extraction

The Claude Code desktop app embeds a session UUID in the `PATH` environment variable as part of the local agent mode sessions path:

```
…/local-agent-mode-sessions/<plugin-id>/<session-id>/bin
```

The `editor-start` skill extracts this with:

```js
const m = process.env.PATH?.match(/local-agent-mode-sessions\/[^/]+\/([0-9a-f-]{36})/);
const sessionId = m?.[1] ?? crypto.randomUUID();
```

`crypto.randomUUID()` is the fallback for non-desktop Claude Code environments where the pattern is absent.

**Injection into the SPA:**

After `preview_start` succeeds, the skill calls `preview_eval` to inject the session ID and reload if it changed:

```js
const prev = localStorage.getItem('editorSession');
if (prev !== '<sessionId>') {
  localStorage.setItem('editorSession', '<sessionId>');
  window.location.reload();
}
```

This reload is the fix for the "goes blank" problem: each session switch triggers a message, `editor-start` runs, detects the session change, and reloads the preview into the correct session's state.

---

## Section 2 — Server-Side Session State

Two new endpoints in `src/viewer-server.js`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/session/:id` | Returns session state JSON, or `{}` if unknown |
| `PUT` | `/api/session/:id` | Saves session state; subject to same CSRF origin check as other mutating endpoints |

Backed by an in-memory `Map<sessionId, SessionState>`. No disk I/O — state is intentionally ephemeral.

**State shape:**

```ts
interface SessionState {
  activeFile: { name: string; type: "excalidraw" | "md" | "tldraw" | "table" } | null;
  openTabs: Array<{ name: string; type: "excalidraw" | "md" | "tldraw" | "table" }>;
  sidebarOpen: boolean;
  scrollPosition: { x: number; y: number }; // main content area scroll only, not per-file
  panelSizes: { sidebar: number };
}
```

`openTabs` preserves the ordered list of open tabs. `activeFile` is the focused tab and must be a member of `openTabs`.

---

## Section 3 — SPA Changes (`src/viewer/entry.jsx`)

**On mount:**

1. Read `sessionId = localStorage.getItem('editorSession') ?? 'default'`
2. `GET /api/session/<sessionId>`
3. Restore state:
   - Open each file in `openTabs` in order
   - Focus `activeFile`
   - Apply `sidebarOpen`, `panelSizes`, `scrollPosition`
   - If a file in `openTabs` no longer exists on disk, skip it silently

**Saving state:**

A debounced (500 ms) `PUT /api/session/<sessionId>` fires on any of:
- Tab opened or closed
- Active file changed
- Sidebar toggled
- Panel resized
- Scroll position changed

---

## Section 4 — Rename Recent File + Workspace Root Fix

**Rename `.excalidraw-recent.json` → `.editor-recent.json`:**

- Update `RECENT_F` constant in `src/viewer-server.js`
- On startup: if `.excalidraw-recent.json` exists and `.editor-recent.json` does not, rename it automatically (one-time migration)

**Workspace root fix:**

`src/paths.js` currently calls `findProjectRoot(cwd)` which walks up the directory tree looking for `.git`, `.claude`, or `CLAUDE.md`. This causes files to be created at the repo root rather than the directory where Claude Code is actually running.

Fix: when `EXCALIDRAW_ROOT` is not set, use `process.cwd()` directly — remove the walk-up entirely.

```js
// Before
const detected = findProjectRoot(process.cwd());

// After
const detected = process.cwd();
```

`findProjectRoot` can be removed. `EXCALIDRAW_ROOT` remains the explicit override for users who need a non-cwd root.

---

## Implementation Order

1. `src/paths.js` — remove `findProjectRoot`, use `cwd` directly
2. `src/viewer-server.js` — rename `RECENT_F`, add migration, add `/api/session/:id` endpoints
3. `src/viewer/entry.jsx` — session restore on mount, debounced save on state changes
4. `editor-start` skill — session ID extraction + `preview_eval` injection
