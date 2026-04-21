# Open-Source Preparation Plan

## Overview

Three-track preparation for publishing `embedded-editor-for-claude-code` publicly.
Items are ordered by priority within each track. Execute one at a time; owner commits after each step.

---

## Track 1 — Sanitise: Remove Private / Sensitive Content

### S-1 · Remove `todos/` from git history (BLOCKING)

**Why critical:** The `todos/` directory is committed to git and contains 15 internal
code-review files that document security vulnerabilities in detail — including
`001-complete-p1-csrf-bypass-origin-absent.md` and `002-complete-p1-stored-xss-markdown-rendering.md`.
These are now fixed, but publishing a write-up of the attack vectors, affected lines, and
exploit steps alongside the code is a liability.

**Action:**
```bash
# Remove from tracking (keep files locally if desired)
git rm -r --cached todos/
echo "todos/" >> .gitignore
# Commit (you do this)
```

Then decide whether to also scrub from full git history with `git filter-repo --path todos/ --invert-paths`
(only needed if the repo history is also being published; if the public repo starts fresh, not required).

**Decision needed from you:** Start fresh public repo (clean slate, no history) or publish full history?

---

### S-2 · Verify `.gitignore` covers all local-only files

**Status:** `.claude/settings.local.json` is already gitignored and clean — no action needed.

**Verify the following are in `.gitignore`:**
- `todos/` ← add this (see S-1)
- `.env` / `.env.*` ← already present
- `node_modules/` ← already present
- `.claude/settings.local.json` ← already present

**Action:** Confirm `todos/` is added to `.gitignore` as part of S-1. No other changes needed.

---

### S-3 · Audit `package.json` for private author / registry data

**Current state:** `author` field is absent; no private registry URLs; `files[]` is clean.
The `todos/` directory is listed in git but not in `files[]`, so it would NOT be published
to npm — but it IS visible in the GitHub repo.

**Action:** No sensitive data to remove here. Fields to *add* are covered in Track 2 (D-4).

---

## Track 2 — Documentation: Make It Developer-Friendly

### D-1 · Add `LICENSE` file (BLOCKING for open-source)

**Why:** Without a `LICENSE` file the code is legally "all rights reserved" regardless of
what the README says. This is the single hardest blocker for anyone wanting to use the code.

**Action:** Create `/LICENSE` with the MIT license text dated to the current year.

```
MIT License

Copyright (c) 2025 [Author Name]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Decision needed:** What name / entity goes in the copyright line?

---

### D-2 · Add missing `package.json` metadata

**Current gaps:** `license`, `author`, `repository`, `bugs`, `homepage`, `keywords` are all absent.
These power the npm package page, enable `npm bugs`, and allow the MCP registry listing.

**Action:** Add these fields to `package.json`:
```json
"license": "MIT",
"author": {
  "name": "TBD",
  "url": "https://github.com/TBD"
},
"repository": {
  "type": "git",
  "url": "git+https://github.com/TBD/embedded-editor-for-claude-code.git"
},
"homepage": "https://github.com/TBD/embedded-editor-for-claude-code#readme",
"bugs": {
  "url": "https://github.com/TBD/embedded-editor-for-claude-code/issues"
},
"keywords": [
  "claude-code", "claude", "mcp", "model-context-protocol",
  "excalidraw", "tldraw", "markdown", "diagram", "visual-editor", "ai-tools"
]
```

**Decision needed:** GitHub username / org and repo URL (depends on whether this is a new repo or the current one).

---

### D-3 · Improve `README.md` — Installation + Architecture + Contributing

**Current state:** README exists and covers the value proposition and MCP tools table well.
It is missing: installation steps, architecture overview, and a "Contributing" link.

**Three additions to README.md:**

**A) Installation section** (after Quick Start):
```markdown
## Requirements

- Node.js 18 or later
- Claude Code (or any MCP-compatible host)

> **Note:** The `@resvg/resvg-js` dependency includes a native binary.
> It is pre-built for macOS (arm64/x64), Linux (x64/arm64), and Windows (x64).
> If your platform is not listed, `npm install` will attempt to compile from source
> (requires Rust/Cargo).
```

**B) Architecture section** (for contributors):
```markdown
## Architecture

The package runs as three components:

| Component | Entry point | Transport |
|-----------|-------------|-----------|
| MCP server | `src/server.js` | stdio JSON-RPC |
| HTTP viewer server | `src/viewer-server.js` | HTTP + SSE on port 3000 |
| Browser SPA | `src/viewer/entry.jsx` → `vendor/viewer.js` | loaded by the HTTP server |

**PNG rendering pipeline:** Claude calls `write_diagram` → `src/render.js` calls
`@excalidraw/excalidraw` (pre-bundled in `vendor/excalidraw.mjs`) to export SVG →
`@resvg/resvg-js` rasterises to PNG → returned as base64 inline content.

**`vendor/` directory:** Contains pre-built bundles committed to git so `npm install`
works without requiring esbuild or a browser at install time. Run `npm run build` to
regenerate after changing source files.
```

**C) Contributing section** (at the bottom, before License):
```markdown
## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, build instructions,
and the PR process.
```

---

### D-4 · Create `CONTRIBUTING.md`

New file covering: setup, build pipeline, testing, PR process.

**Key sections:**

```markdown
# Contributing

## Development Setup
git clone ...
npm install
npm run build  # generates vendor/excalidraw.mjs and vendor/viewer.js

## Build System

| Command | What it does | When to run |
|---------|-------------|-------------|
| npm run build | Runs both steps below | Before submitting a PR |
| npm run build:excalidraw | Bundles @excalidraw/excalidraw for Node | After bumping Excalidraw version |
| npm run build:viewer | Bundles React SPA (entry.jsx) | After editing src/viewer/entry.jsx |

## Testing (Smoke Test)
node scripts/smoke-stdio.mjs
# Verifies: MCP handshake, all tools registered, PNG rendering, file I/O

## Running Locally
node bin/cli.js view          # browser-only viewer at http://127.0.0.1:3000
node bin/cli.js serve         # TTY: viewer; piped: MCP stdio server

## Pull Requests
- Target branch: main
- Commit messages: Conventional Commits (feat:, fix:, docs:, chore:)
- Include: passing smoke test, updated vendor/ if entry.jsx changed
- Do not: bump version (maintainer does this on release)

## Security
Please do not open public issues for security vulnerabilities.
Email: [TBD] or use GitHub's private security advisory.
```

**Decision needed:** Security contact email / GitHub security advisory preference.

---

### D-5 · Create `SECURITY.md`

Short file documenting the server's threat model and how to report vulnerabilities.

```markdown
# Security Policy

## Threat Model

The HTTP viewer server binds to `127.0.0.1` only and is intended to be accessed
from the local machine. It should never be exposed on a non-loopback interface.

The MCP server communicates over stdio and is launched by Claude Code; it does
not open any network ports.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Use [GitHub's private security advisory](https://github.com/TBD/embedded-editor-for-claude-code/security/advisories/new)
or email [TBD].

We will respond within 7 days and aim to publish a fix within 30 days.
```

---

### D-6 · Create `CHANGELOG.md`

Documents the initial release. Establishes the versioning policy going forward.

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2025-04-21

### Added
- MCP server with Excalidraw tools: `list_diagrams`, `read_diagram`, `create_diagram`,
  `write_diagram`, `append_elements`, `delete_diagram`
- MCP tools for Markdown notes: `list_notes`, `read_note`, `write_note`,
  `create_note`, `delete_note`
- `rename_file` MCP tool with automatic [[wikilink]] rewriting
- `get_backlinks`, `list_history`, `restore_snapshot`, `list_tldraw`, `read_tldraw` tools
- Browser viewer with Excalidraw, tldraw, and Markdown editors
- Wikilink navigation between files (`[[name]]` and `![[embed]]`)
- Live-sync via SSE — Claude's edits appear in the viewer instantly
- Version history (auto-snapshot on diagram save, restorable)
- `init` command to register the MCP server and slash commands in Claude Code
```

---

### D-7 · Create `CODE_OF_CONDUCT.md`

Standard Contributor Covenant 2.1 (copy-paste from contributor-covenant.org).
No customisation needed for an initial release — the standard text is universally understood.

---

### D-8 · Review and clean up `CLAUDE.md` (developer-facing version)

The current repo has no `CLAUDE.md`. The `init` command generates one for *user projects*,
but there is no `CLAUDE.md` for contributors to this repo itself.

**Decision needed:** Do you want a developer-oriented `CLAUDE.md` for contributors?
It would cover: architecture, build pipeline, coding conventions, file naming, security notes.
This is optional but useful since Claude Code users/contributors will likely use Claude to
help them contribute.

If yes → create at repo root covering the architecture from D-3 plus coding conventions.
If no → skip.

---

### D-9 · Add `.github/` community health files

Create three files:

**`.github/ISSUE_TEMPLATE/bug_report.yml`**
```yaml
name: Bug Report
description: Something isn't working
labels: ["bug"]
body:
  - type: textarea
    id: repro
    attributes:
      label: Steps to reproduce
      placeholder: "1. Run `npx embedded-editor serve`\n2. …"
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
  - type: input
    id: node
    attributes:
      label: Node.js version
      placeholder: "node --version"
  - type: input
    id: os
    attributes:
      label: OS
      placeholder: "macOS 14 / Ubuntu 22.04 / Windows 11"
```

**`.github/ISSUE_TEMPLATE/feature_request.yml`**
```yaml
name: Feature Request
description: Suggest an idea
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem does this solve?
  - type: textarea
    id: proposal
    attributes:
      label: Proposed solution
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
```

**`.github/PULL_REQUEST_TEMPLATE.md`**
```markdown
## What does this PR do?

## How to test

- [ ] `npm run build` completes without errors
- [ ] `node scripts/smoke-stdio.mjs` passes
- [ ] Vendor files rebuilt if `src/viewer/entry.jsx` was changed

## Related issues

Closes #
```

---

### D-10 · Add a CI workflow (optional but recommended)

**`.github/workflows/ci.yml`** — runs on push and PR:

```yaml
name: CI
on: [push, pull_request]
jobs:
  smoke:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        node-version: [18, 20, 22]
        os: [ubuntu-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm install
      - run: node scripts/smoke-stdio.mjs
```

Note: `npm run build` is skipped in CI because `vendor/` is committed to git.
The smoke test runs directly against the committed vendor files.

**Decision needed:** Do you want CI? If yes, which platforms to test (ubuntu/macos/windows)?

---

## Track 3 — Authors & Contributors

### A-1 · Add `author` to `package.json` (covered in D-2)

The `author` field in `package.json` is the canonical author credit for an npm package.
This is handled as part of D-2 above.

---

### A-2 · Create `AUTHORS.md`

Simple file listing the founding author(s).

```markdown
# Authors

This project was created and is maintained by:

- **[Name]** — [GitHub profile URL]

## Contributors

Contributors are listed on [GitHub](https://github.com/TBD/embedded-editor-for-claude-code/graphs/contributors).
```

**Decision needed:** What name and GitHub URL to use?

---

### A-3 · Create `CONTRIBUTING.md` (covered in D-4)

`CONTRIBUTING.md` is the primary document that invites and guides future contributors.
Already planned in D-4.

---

## Decisions Needed Before Execution

Before we start, please answer these so the files can be written correctly:

| # | Question | Affects |
|---|----------|---------|
| 1 | **New public repo or current repo?** (fresh history vs. full history) | S-1, S-2 |
| 2 | **Copyright name** — what name/entity goes in the MIT license? | D-1 |
| 3 | **GitHub username/org** and final repo URL | D-2, D-5, D-9 |
| 4 | **Security contact** — email or GitHub security advisories only? | D-4, D-5 |
| 5 | **Developer CLAUDE.md?** — yes/no | D-8 |
| 6 | **CI workflow?** — yes/no, and which platforms | D-10 |
| 7 | **Author credit** — name and GitHub URL for AUTHORS.md | A-2 |

---

## Execution Order (once decisions are made)

1. S-1 — Remove `todos/` from git + gitignore
2. D-1 — Add `LICENSE`
3. D-2 — Add `package.json` metadata
4. A-2 — Create `AUTHORS.md`
5. D-4 — Create `CONTRIBUTING.md`
6. D-5 — Create `SECURITY.md`
7. D-3 — Update `README.md` (Installation + Architecture + Contributing)
8. D-6 — Create `CHANGELOG.md`
9. D-7 — Create `CODE_OF_CONDUCT.md`
10. D-8 — Developer `CLAUDE.md` (if yes)
11. D-9 — Add `.github/` community files
12. D-10 — Add CI workflow (if yes)
