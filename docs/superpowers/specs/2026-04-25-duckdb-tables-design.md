# DuckDB Tables — Design Spec

**Date:** 2026-04-25
**Status:** Approved

## Overview

Add DuckDB as a first-class file type in the embedded editor, alongside `.excalidraw`, `.md`, and `.tldraw`. Each `.duckdb` file is a real DuckDB database living in the workspace. Claude can create and populate tables via MCP tools; users can query and edit them in a dedicated tab view; tables can be embedded inline in markdown notes.

The goal is to enable personal "apps on demand" — job trackers, finance managers, habit logs — built locally with Claude as both author and analyst.

---

## 1. File Type & Storage

- **Format:** Real DuckDB database files (not JSON metadata). Extension: `.duckdb`.
- **Location:** Under `EXCALIDRAW_ROOT`, validated by `validateName` like all other file types.
- **Naming:** `{name}.duckdb` — consistent with `{name}.excalidraw`, `{name}.md`.
- **Connection pool:** `viewer-server.js` maintains a `Map<name, { db, lastUsed }>`. Connections open on first access and close after 60s idle (same LRU pattern as `svgCache`/`pngCache`).
- **Subfolder visibility:** Queries resolve paths relative to the `.duckdb` file's own directory. A `finances.duckdb` in `/workspace/finances/` can run `read_csv('./transactions/**/*.csv')` naturally. The MCP server sets the working directory to the file's parent when executing queries.
- **Wikilinks:** `rewriteLinks` and `findBacklinks` in `workspace.js` are extended to handle `[[name.duckdb]]` references in `.md` files.
- **Recent list:** `.duckdb` files are included in `.excalidraw-recent.json`.
- **New dependency:** `duckdb-node` added to `package.json` (runtime only, no build changes).

---

## 2. MCP Tools

Six new tools in `server.js`, following the existing diagram/note tool pattern:

| Tool | Description |
|------|-------------|
| `list_tables` | List all `.duckdb` files in the workspace |
| `create_table` | Create a new `.duckdb` file with a defined schema |
| `read_table` | Read rows with optional SQL `WHERE`/`ORDER`/`LIMIT`; returns markdown table + row count |
| `write_rows` | Insert or upsert rows by primary key |
| `delete_rows` | Delete rows matching a condition |
| `query_table` | Run arbitrary SQL against a `.duckdb` file — supports `read_csv`, `read_json`, frontmatter scanning |

All mutating tools broadcast `table:changed` SSE events. `query_table` resolves relative paths so subfolder glob patterns work.

**Claude's two modes:**
- `/table` flow → `create_table` then `write_rows`
- `/query` flow → `create_table` (as a view container) then `query_table`

---

## 3. HTTP API

New routes in `viewer-server.js`:

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/tables` | List all `.duckdb` files |
| POST | `/api/table/:name` | Create table |
| GET | `/api/table/:name` | Read rows (`?sql=`, `?limit=`, `?offset=`) |
| PUT | `/api/table/:name/rows` | Insert/upsert rows |
| DELETE | `/api/table/:name` | Delete file |
| POST | `/api/table/:name/query` | Run SQL; returns `{ columns, rows, rowCount }` |

All mutating routes require the `Origin` header (existing CSRF protection). SSE broadcasts `op: "table:changed"` and `op: "table:deleted"` — the SPA's existing event handler routes these to `refresh()`.

---

## 4. SPA — Tab View

New `TableView` component (~400 lines).

**Toolbar:**
- `⌘ Query` — toggles query pane open/closed (highlighted when open)
- `≡ Table` / `⊞ Cards` — switches data view mode
- `↓ Export` — downloads as CSV
- Lock/Live toggle — only active for `/query`-created tables (see §6)

**Query pane:** slides in from the left at 300px, CSS transition to 0 when closed. Contains a CM6 SQL editor (reuses the existing CM6 setup in the codebase, SQL language mode) and a ▶ Run button (`⌘↵`). Persists across Table/Cards view switches — toggling the view mode does not close the pane.

**Table view:** rows rendered in a `<table>`, cells are `contenteditable`. Blur triggers a `PUT /api/table/:name/rows` upsert. `+ Add row` appends a blank row.

**Card view:** rows rendered as cards in a CSS grid. Fields are inline-editable on click. Same upsert on blur. `+ Add row` card in the grid.

**Color token:** `T.duck: "#facc15"` (dark) / `T.duck: "#b45309"` (light) added to `DARK` and `LIGHT` theme objects.

**Tab strip:** duck SVG icon at 9px, colored `T.duck`. File type symbol in the dropdown list also uses the duck SVG.

**Brand mark:** duck SVG added to `BrandMark` with a `·` separator, spacing reduced to fit. Appears between the tldraw icon and the code icon.

**Query vs table distinction:** `create_table` and `/table` slash command write a `_ee_meta` table inside the `.duckdb` file with `{ created_by: 'table' }`. `/query` slash command writes `{ created_by: 'query' }`. The SPA reads this on open to determine whether to show the lock/live toggle as active.

---

## 5. SPA — Note Embed

`parseNoteSegments` extended to match `![[name.duckdb]]` markers.

Renders a `TableEmbed` component:

**Embed header:** duck icon + `name.duckdb · N rows · updated date` + `Open ↗` button.

**View toggle (A/B):**
- **A — Table preview:** compact read-only `<table>` showing all columns, up to 10 rows.
- **B — Chip strip:** one chip per row showing the first two fields, color-coded by a status field if present.

Toggle state persisted in `localStorage("ee-embed-view-{name}")`. Clicking "Open ↗" opens the file as a full tab.

---

## 6. Slash Commands

Two new entries in `makeSlashSource` in `entry.jsx`:

**`/table <description>`**
- Creates `table-{id}.duckdb`
- Inserts `![[table-{id}.duckdb]]` at cursor
- Fires `slash-prompt`: *"[description]. Table file: [[table-{id}.duckdb]] (already created). Use create_table to define the schema, then write_rows to populate it."*

**`/query <description>`**
- Creates `query-{id}.duckdb`
- Inserts `![[query-{id}.duckdb]]` at cursor
- Fires `slash-prompt`: *"[description]. Query file: [[query-{id}.duckdb]] (already created). Use query_table to scan files relative to this table's directory (supports read_csv, read_json, and frontmatter parsing) and save results as rows."*

Both follow the exact `apply()` pattern of `/diagram` and `/note`.

---

## 7. Frontmatter Sync

`query_table` supports a `read_frontmatter('./glob')` helper:
- Uses `workspace.js` to glob `.md` files matching the pattern
- Parses YAML frontmatter by splitting on `---` (no new dependency)
- Returns rows to DuckDB via `INSERT OR REPLACE`

**Lock/Live toggle:**
- **Live:** viewer re-calls `POST /api/table/:name/query` on every `note:changed` SSE event for files in the table's directory
- **Lock:** query only re-runs on explicit ▶ Run
- Toggle state persisted in `localStorage("ee-table-sync-{name}")`

---

## 8. Security

- Path validation: all table names go through `validateName` — no traversal, no special characters.
- Relative paths in SQL (`read_csv('./...')`) are resolved against the `.duckdb` file's parent directory and validated to stay within `EXCALIDRAW_ROOT`.
- All mutating HTTP routes require `Origin` header (existing CSRF check).
- SQL is executed within the per-file DuckDB connection — no cross-file data access unless explicitly queried.
- Body size limit: existing 5 MB cap applies to row payloads.

---

## 9. Out of Scope

- Multi-table joins across different `.duckdb` files (possible via DuckDB's `ATTACH`, but deferred)
- DuckDB-WASM in the browser (Node server-side only for now)
- Schema migrations (user manages schema via `query_table` or MCP tools directly)
- Import UI for CSV/JSON (Claude handles this via `query_table` with `read_csv`)
