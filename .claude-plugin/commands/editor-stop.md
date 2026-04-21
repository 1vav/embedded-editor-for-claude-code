---
description: Stop the Embedded Editor viewer server
allowed-tools: Bash
---

Stop the Embedded Editor viewer server that was started with /editor-start.

```bash
pkill -f "embedded-editor-for-claude-code" 2>/dev/null
lsof -ti:3000 | xargs kill 2>/dev/null
echo "done"
```

Confirm to the user that the viewer has been stopped.
