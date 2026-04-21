# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-21

### Added

**MCP tools — Excalidraw diagrams**
- `list_diagrams` — list all `.excalidraw` files in the workspace
- `create_diagram` — create a blank diagram; returns PNG preview inline
- `read_diagram` — return current JSON + PNG
- `write_diagram` — replace elements; returns PNG
- `append_elements` — add elements to an existing diagram; returns PNG
- `delete_diagram` — delete a diagram file

**MCP tools — Markdown notes**
- `list_notes` — list all `.md` files
- `read_note` — read note content
- `write_note` — write (replace) note content
- `create_note` — create a blank note
- `delete_note` — delete a note

**MCP tools — workspace operations**
- `rename_file` — rename a diagram or note and rewrite all `[[wikilinks]]`
- `get_backlinks` — find all files that link to a given file
- `list_history` — list saved snapshots for a diagram
- `restore_snapshot` — restore a diagram to a saved version
- `list_tldraw` — list tldraw canvas files
- `read_tldraw` — read tldraw canvas JSON

**Browser viewer**
- Excalidraw, tldraw, and Markdown editors in a tabbed interface
- `[[wikilink]]` navigation and `![[embed]]` syntax in Markdown
- File browser dropdown with recent files and type filters
- Version history panel with one-click restore
- Backlinks panel per note
- Live-sync via SSE — changes appear instantly across all open tabs
- Light/dark mode following OS preference
- Prompt bar — write an instruction and copy it to clipboard for Claude

**Infrastructure**
- `init` command writes MCP server config and slash commands into Claude Code
- `--global` flag for workspace-wide setup
- PNG rendering via Excalidraw's own `exportToSvg` → `@resvg/resvg-js` pipeline
- CSRF protection (Origin header required on all write requests)
- Security headers on all HTTP responses
- In-memory recent-file list with debounced disk flush
- Auto-snapshot on every diagram save (30-version rolling history)

[Unreleased]: https://github.com/1vav/embedded-editor-for-claude-code/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/1vav/embedded-editor-for-claude-code/releases/tag/v0.1.0
