---
description: Start the Embedded Editor viewer (diagrams · canvases · notes)
allowed-tools: Bash
---

Start the Embedded Editor viewer server in the background so you can browse and edit diagrams, tldraw canvases, and Markdown notes at http://127.0.0.1:3000.

First check if it's already running:

```bash
lsof -ti:3000 > /dev/null 2>&1 && echo "already_running" || echo "not_running"
```

If not running, start it in the background and wait for it to be ready:

```bash
npx embedded-editor-for-claude-code serve > /tmp/embedded-editor.log 2>&1 &
sleep 2 && curl -sf http://127.0.0.1:3000 > /dev/null && echo "✓ Viewer ready" || echo "✗ Failed — check /tmp/embedded-editor.log"
```

Tell the user the viewer is running at **http://127.0.0.1:3000** and they can open it in the preview pane (the ☁ button in Claude Code's toolbar) or directly in their browser. Use /editor-stop to shut it down.
