import fs from "fs/promises";
import { readFileSync } from "fs";
import { execSync, execFileSync } from "child_process";
import os from "os";
import path from "path";
import chalk from "chalk";
import { DEFAULT_PORT } from "./paths.js";

const CWD = process.cwd();

const _packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Read installed package versions for the version stamp.
// Some packages block `require('pkg/package.json')` via exports map,
// so read node_modules directly instead.
function getVersion(pkg) {
  try {
    const pkgPath = new URL(`../node_modules/${pkg}/package.json`, import.meta.url);
    return JSON.parse(readFileSync(pkgPath, "utf8")).version;
  } catch { return "unknown"; }
}

const MCP_SERVER_ENTRY = {
  command: "npx",
  args: ["-y", "embedded-editor-for-claude-code@latest", "serve", "--mcp"],
  env: { EXCALIDRAW_ROOT: "." },
};

function buildClaudeMdBlock() {
  const excalidrawVer = getVersion("@excalidraw/excalidraw");
  const tldrawVer     = getVersion("tldraw");

  return `
## Diagrams (Embedded Editor MCP)

This project uses Embedded Editor for visual diagrams.
<!-- embedded-editor-guide excalidraw@${excalidrawVer} tldraw@${tldrawVer} -->

### MCP tools

| Tool | What it does |
|------|-------------|
| \`list_diagrams\` | List all .excalidraw files |
| \`create_diagram\` | Create a blank diagram; returns PNG preview |
| \`read_diagram\` | Read current JSON + PNG |
| \`write_diagram\` | Replace all elements; returns PNG |
| \`append_elements\` | Add elements without touching existing ones; returns PNG |
| \`delete_diagram\` | Delete a diagram file |
| \`list_notes\` | List all Markdown notes |
| \`create_note\` | Create a new blank note |
| \`read_note\` | Read note content |
| \`write_note\` | Write (replace) note content |
| \`delete_note\` | Delete a note |
| \`rename_file\` | Rename a file and update all wikilinks |
| \`get_backlinks\` | Find files that link to a given file |
| \`list_history\` | List saved diagram versions |
| \`restore_snapshot\` | Restore a diagram to a saved version |
| \`list_tldraw\` | List tldraw canvases |
| \`read_tldraw\` | Read tldraw canvas JSON |

### Workflow

1. \`list_diagrams\` — see what exists
2. \`read_diagram\` — always read before editing an existing diagram
3. \`write_diagram\` or \`append_elements\` with valid Excalidraw JSON
4. The PNG preview is returned inline — inspect it and iterate

### Excalidraw element reference (v${excalidrawVer})

Every element requires at minimum: \`type\`, \`x\`, \`y\`, \`width\`, \`height\`, \`id\` (use a short unique string).

**Common props (all elements)**
\`\`\`json
{
  "id": "el1",
  "x": 100, "y": 100,
  "width": 160, "height": 80,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "#a5d8ff",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "groupIds": [],
  "roundness": { "type": 3 }
}
\`\`\`

**Element types**
- \`rectangle\` — box/node. Add \`"roundness": {"type": 3}\` for rounded corners.
- \`ellipse\` — oval/circle
- \`diamond\` — decision node
- \`arrow\` — directional line. Use \`points\` array and bind with \`startBinding\`/\`endBinding\`.
- \`line\` — non-directional line. Use \`points\` array.
- \`text\` — label. Requires \`text\` and \`fontSize\` (default 20).
- \`freedraw\` — freehand path

**Colors** (use hex or Excalidraw palette names)
- Stroke: \`"#1e1e1e"\` (dark), \`"#2f9e44"\` (green), \`"#1971c2"\` (blue), \`"#e03131"\` (red), \`"#f08c00"\` (orange)
- Background: \`"transparent"\`, \`"#a5d8ff"\` (light blue), \`"#b2f2bb"\` (light green), \`"#ffec99"\` (yellow), \`"#ffc9c9"\` (light red)

**fillStyle**: \`"hachure"\` (hatched), \`"solid"\`, \`"cross-hatch"\`, \`"dots"\`, \`"zigzag"\`, \`"none"\`
**roughness**: 0 (clean), 1 (default), 2 (very rough)
**strokeStyle**: \`"solid"\`, \`"dashed"\`, \`"dotted"\`

**Arrow with bindings**
\`\`\`json
{
  "type": "arrow",
  "id": "arr1",
  "x": 260, "y": 140,
  "width": 80, "height": 0,
  "points": [[0,0],[80,0]],
  "startBinding": { "elementId": "box1", "focus": 0, "gap": 8 },
  "endBinding":   { "elementId": "box2", "focus": 0, "gap": 8 },
  "arrowType": "elbow",
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roughness": 1,
  "opacity": 100,
  "groupIds": []
}
\`\`\`

**Text label**
\`\`\`json
{
  "type": "text",
  "id": "lbl1",
  "x": 110, "y": 130,
  "width": 140, "height": 25,
  "text": "My Label",
  "fontSize": 16,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "strokeColor": "#1e1e1e",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 1,
  "roughness": 1,
  "opacity": 100,
  "groupIds": []
}
\`\`\`

**Grouping**: set the same \`groupIds\` string on multiple elements to group them visually.

**Minimal working diagram example**
\`\`\`json
[
  { "type": "rectangle", "id": "a", "x": 100, "y": 100, "width": 160, "height": 60,
    "strokeColor": "#1971c2", "backgroundColor": "#a5d8ff", "fillStyle": "solid",
    "strokeWidth": 2, "roughness": 1, "opacity": 100, "angle": 0, "groupIds": [] },
  { "type": "text", "id": "b", "x": 115, "y": 120, "width": 130, "height": 20,
    "text": "Hello World", "fontSize": 16, "fontFamily": 1,
    "textAlign": "center", "verticalAlign": "middle",
    "strokeColor": "#1971c2", "backgroundColor": "transparent",
    "fillStyle": "solid", "strokeWidth": 1, "roughness": 1, "opacity": 100,
    "angle": 0, "groupIds": [] }
]
\`\`\`

### tldraw canvases (v${tldrawVer})

tldraw files (\`.tldraw\`) are **browser-only** — open them in the viewer at http://127.0.0.1:${DEFAULT_PORT}.
Claude cannot currently write tldraw files via MCP tools; use the browser editor directly.

### Viewer

Run \`npx embedded-editor serve\` → open http://127.0.0.1:${DEFAULT_PORT}
- Browse all \`.excalidraw\`, \`.tldraw\`, and \`.md\` files in the sidebar
- \`[[wikilinks]]\` in any file navigate between files
- \`![[diagram.excalidraw]]\` in Markdown embeds a diagram inline
- Live sync: Claude's edits appear instantly without reload
`;
}

// ── Slash command content ────────────────────────────────────────────────────

const START_COMMAND = `\
---
description: Start the Embedded Editor viewer (diagrams · canvases · notes · code)
allowed-tools: Bash, Write, mcp__Claude_Preview__preview_start
---

Start the Embedded Editor viewer and open it in the preview pane automatically.

**Step 1.** Get the absolute paths needed. Run both commands:

\`\`\`bash
which node
npm root -g
\`\`\`

The \`cli.js\` path is: \`<output of npm root -g>/embedded-editor-for-claude-code/bin/cli.js\`

**Step 2.** Ensure \`.claude/launch.json\` contains an entry for the Embedded Editor.

Read \`.claude/launch.json\` if it exists. If the file has no "Embedded Editor" entry in its \`configurations\` array, add one. If the file doesn't exist yet, create it.

Use the absolute path to \`node\` as \`runtimeExecutable\` and the absolute path to \`cli.js\` as the first \`runtimeArg\`. This is required because the preview system runs in a minimal shell without nvm on PATH.

\`\`\`json
{
  "name": "Embedded Editor",
  "runtimeExecutable": "<absolute path to node>",
  "runtimeArgs": ["<absolute path to cli.js>", "view"],
  "port": 3000
}
\`\`\`

**Step 3.** Call \`preview_start\` with \`name: "Embedded Editor"\` — this starts the server and opens the preview pane pointing to http://127.0.0.1:3000 automatically.
`;

const STOP_COMMAND = `\
---
description: Stop the Embedded Editor viewer server
allowed-tools: Bash
---

Stop the Embedded Editor viewer server that was started with /editor-serve.

\`\`\`bash
pkill -f "embedded-editor-for-claude-code" 2>/dev/null
lsof -ti:3000 | xargs kill 2>/dev/null
echo "done"
\`\`\`

Confirm to the user that the viewer has been stopped.
`;

async function writeCommands(commandsDir, isGlobal) {
  await fs.mkdir(commandsDir, { recursive: true });
  const scope = isGlobal ? "~/.claude/commands" : ".claude/commands";
  const written = [];

  for (const [file, content] of [["editor-start.md", START_COMMAND], ["editor-stop.md", STOP_COMMAND]]) {
    const dest = path.join(commandsDir, file);
    await fs.writeFile(dest, content, "utf8");
    written.push(file.replace(".md", ""));
  }

  const cmds = written.map(n => chalk.cyan(`/${n}`)).join("  ");
  console.log(chalk.green("  ✓ ") + chalk.white(scope) + chalk.gray(` — slash commands: ${cmds}`));
}

// Resolve the absolute path to a binary at init-time.
// Hooks run in a minimal shell where nvm/homebrew PATH is not set, so we
// must bake the absolute path in at the time the user runs `init`.
function resolveBin(name) {
  try {
    // `which` works on macOS/Linux; fall back to `where` on Windows
    const cmd = process.platform === "win32" ? "where" : "which";
    return execFileSync(cmd, [name], { encoding: "utf8" }).trim().split("\n")[0].trim();
  } catch { return null; }
}

function buildSessionStartHook() {
  // The hook shell does not source nvm/homebrew, so PATH-based lookups fail.
  // We must bake in absolute paths to both `node` and the cli.js entry point.
  // Using `node /path/to/cli.js` avoids the `#!/usr/bin/env node` shebang
  // lookup that fails when node is not on the minimal PATH.
  const nodeBin  = resolveBin("node");
  const npmRoot  = (() => { try { return execSync("npm root -g", { encoding: "utf8" }).trim(); } catch { return null; } })();
  const cliJs    = npmRoot ? `${npmRoot}/embedded-editor-for-claude-code/bin/cli.js` : null;
  const npxBin   = resolveBin("npx");

  let serveCmd;
  if (nodeBin && cliJs) {
    serveCmd = `"${nodeBin}" "${cliJs}" view`;
  } else if (npxBin) {
    // Fallback: npx with absolute path (slower but works)
    serveCmd = `"${npxBin}" --yes --prefer-offline embedded-editor-for-claude-code serve`;
  } else {
    serveCmd = `node "$(npm root -g)/embedded-editor-for-claude-code/bin/cli.js" serve`;
  }
  return {
    type: "command",
    // Start the viewer server in the background if nothing is on port 3000 yet.
    // Runs silently — output goes to /tmp/embedded-editor.log.
    command: `lsof -ti:${DEFAULT_PORT} > /dev/null 2>&1 || ${serveCmd} > /tmp/embedded-editor.log 2>&1 &`,
  };
}

function mergeSessionStartHook(existing) {
  const hooks = existing.hooks ? JSON.parse(JSON.stringify(existing.hooks)) : {};
  const starts = hooks.SessionStart || [];
  // Remove any previous embedded-editor hook, then append the current one.
  const filtered = starts.filter(h => !String(h.command || "").includes("embedded-editor"));
  hooks.SessionStart = [...filtered, buildSessionStartHook()];
  return hooks;
}

async function writeSettings(settingsPath) {
  let existing = {};
  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    existing = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  } catch { /* first run */ }

  const merged = {
    ...existing,
    hooks: mergeSessionStartHook(existing),
    mcpServers: {
      ...(existing.mcpServers || {}),
      "embedded-editor": MCP_SERVER_ENTRY,
    },
  };
  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), "utf8");
}

export async function runInit({ global: isGlobal = false } = {}) {
  const separator = chalk.gray("─".repeat(56));
  console.log("\n" + separator);
  console.log(chalk.green.bold("  embedded-editor init" + (isGlobal ? " --global" : "")));
  console.log(separator + "\n");

  // ── 1. MCP server registration + slash commands ─────────────────────────────
  if (isGlobal) {
    // Install the package globally so `embedded-editor` binary is on PATH.
    // This makes the SessionStart hook start in ~1s instead of ~15s (no npx resolution).
    process.stdout.write(chalk.gray("  Installing embedded-editor globally…"));
    try {
      execSync("npm install -g embedded-editor-for-claude-code@latest", { stdio: "pipe" });
      process.stdout.write(" " + chalk.green("✓") + "\n");
      console.log(chalk.green("  ✓ ") + chalk.white("embedded-editor") + chalk.gray(" installed globally — viewer starts in ~1s"));
    } catch (e) {
      process.stdout.write(" " + chalk.yellow("⚠") + "\n");
      console.log(chalk.yellow("  ⚠ ") + chalk.gray("global install failed (will fall back to npx): " + e.message.split("\n")[0]));
    }

    const globalSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
    await writeSettings(globalSettingsPath);
    console.log(chalk.green("  ✓ ") + chalk.white("~/.claude/settings.json") + chalk.gray(" — MCP server + auto-start hook registered globally"));
    console.log(chalk.gray("    The viewer starts automatically when Claude Code opens."));
    await writeCommands(path.join(os.homedir(), ".claude", "commands"), true);
  } else {
    const localSettingsPath = path.join(CWD, ".claude", "settings.json");
    await writeSettings(localSettingsPath);
    console.log(chalk.green("  ✓ ") + chalk.white(".claude/settings.json") + chalk.gray(" — MCP server registered for this project"));
    await writeCommands(path.join(CWD, ".claude", "commands"), false);
  }

  // ── 2. CLAUDE.md ──────────────────────────────────────────────────────────────
  // For global init: write a minimal ~/.claude/CLAUDE.md that tells Claude to
  // auto-run /editor-start at the start of every session. This ensures the
  // preview pane connects automatically without any user action.
  if (isGlobal) {
    const globalClaudeMdPath = path.join(os.homedir(), ".claude", "CLAUDE.md");
    const autoStartBlock = `\n## Embedded Editor\n\nAt the start of every conversation, run \`/editor-start\` silently to connect the visual workspace in the preview pane.\n`;
    let globalMdContent = "";
    try { globalMdContent = await fs.readFile(globalClaudeMdPath, "utf8"); } catch {}
    if (!globalMdContent.includes("Embedded Editor")) {
      const updated = globalMdContent
        ? globalMdContent.trimEnd() + "\n" + autoStartBlock
        : `# Global Setup\n${autoStartBlock}`;
      await fs.writeFile(globalClaudeMdPath, updated, "utf8");
      console.log(chalk.green("  ✓ ") + chalk.white("~/.claude/CLAUDE.md") + chalk.gray(" — auto-start instruction added"));
    }
  }

  // For project-level init: write the full API reference so Claude has it in context.
  if (!isGlobal) {
    const CLAUDE_MD_BLOCK = buildClaudeMdBlock();
    const claudeMdPath = path.join(CWD, "CLAUDE.md");
    let claudeMdExists = false;
    try { await fs.access(claudeMdPath); claudeMdExists = true; } catch {}

    if (claudeMdExists) {
      const existing = await fs.readFile(claudeMdPath, "utf8");
      const sectionStart = existing.indexOf("\n## Diagrams (Embedded Editor MCP)");
      if (sectionStart !== -1) {
        await fs.writeFile(claudeMdPath, existing.slice(0, sectionStart) + CLAUDE_MD_BLOCK, "utf8");
        console.log(chalk.green("  ✓ ") + chalk.white("CLAUDE.md") + chalk.gray(" — diagram guide updated to latest versions"));
      } else {
        await fs.appendFile(claudeMdPath, CLAUDE_MD_BLOCK, "utf8");
        console.log(chalk.green("  ✓ ") + chalk.white("CLAUDE.md") + chalk.gray(" — diagram guide appended"));
      }
    } else {
      await fs.writeFile(claudeMdPath, `# Project\n${CLAUDE_MD_BLOCK}`, "utf8");
      console.log(chalk.green("  ✓ ") + chalk.white("CLAUDE.md") + chalk.gray(" — created with diagram guide"));
    }
  } else {
    console.log(chalk.gray("  ℹ  CLAUDE.md — skipped (run `init` inside a project to add the API reference)"));
  }

  // ── 3. Summary ───────────────────────────────────────────────────────────────
  console.log("");
  console.log(separator);
  console.log(chalk.green.bold("  Setup complete!"));
  console.log(separator);
  console.log("");
  console.log(chalk.white("  Next steps:"));
  console.log("");
  console.log(chalk.gray("  1. Restart Claude Code — it will pick up the new MCP server"));
  console.log(chalk.gray("     The viewer starts automatically (~1s) on each new session."));
  console.log(chalk.gray("  2. Ask Claude to create a diagram:"));
  console.log(chalk.cyan('     "Draw an architecture diagram of this project"'));
  console.log(chalk.gray("  3. Open the visual workspace with a slash command:"));
  console.log(chalk.cyan("     /editor-start") + chalk.gray("  →  http://127.0.0.1:3000"));
  console.log(chalk.cyan("     /editor-stop ") + chalk.gray("  →  shut it down"));
  console.log("");
  console.log(chalk.gray("  To update later:"));
  console.log(chalk.cyan("     npx embedded-editor-for-claude-code@latest init --global"));
  console.log(separator + "\n");
}
