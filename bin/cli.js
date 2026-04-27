#!/usr/bin/env node
import { startServer } from "../src/server.js";
import { startViewerServer } from "../src/viewer-server.js";
import { runInit } from "../src/init.js";
import { derivePort } from "../src/paths.js";
import { ROOT } from "../src/workspace.js";

const args = process.argv.slice(2);
const command = args[0];

// ── init ─────────────────────────────────────────────────────────────────────
if (command === "init") {
  const isGlobal = args.includes("--global") || args.includes("-g");
  await runInit({ global: isGlobal });
  process.exit(0);
}

// ── view / open ───────────────────────────────────────────────────────────────
// Explicit viewer commands — always start the browser server.
if (command === "view") {
  // --root <path> pins the workspace root explicitly, overriding EXCALIDRAW_ROOT
  // and CWD. launch.json always passes this so the server serves the right folder
  // regardless of which directory Claude Code happens to launch from.
  const rootIdx = args.indexOf("--root");
  if (rootIdx >= 0 && args[rootIdx + 1]) {
    process.env.EXCALIDRAW_ROOT = args[rootIdx + 1];
  }
  const port = parseInt(args[1]) || derivePort(process.env.EXCALIDRAW_ROOT || process.cwd());
  await startViewerServer(port);
  process.stderr.write(`[embedded-editor] viewer running at http://127.0.0.1:${port}\n`);
  await new Promise(() => {});
}

// ── serve ─────────────────────────────────────────────────────────────────────
// Dual-mode: when run from a terminal (stdin is a TTY) start the viewer so
// `npx embedded-editor-for-claude-code serve` just works for end users.
// When Claude Code launches this process (stdin is a pipe), use MCP stdio mode.
if (command === "serve") {
  if (args.includes("--mcp")) {
    // Explicit MCP mode — Claude Code launched this with --mcp
    const log = (msg) => {
      try { process.stderr.write(`[embedded-editor] ${msg}\n`); } catch {}
    };
    log(`starting stdio MCP server (--mcp) pid=${process.pid} node=${process.version} cwd=${process.cwd()} root=${process.env.EXCALIDRAW_ROOT || "(unset)"}`);
    process.on("uncaughtException",  (err)    => log(`UNCAUGHT: ${err?.stack || err}`));
    process.on("unhandledRejection", (reason) => log(`UNHANDLED REJECTION: ${reason?.stack || reason}`));
    process.on("exit",               (code)   => log(`process exit code=${code}`));
    process.stdin.on("end",  ()    => log("stdin end"));
    process.stdin.on("error",(err) => log(`stdin error: ${err?.message}`));
    process.stdout.on("error",(err)=> log(`stdout error: ${err?.message}`));
    try {
      await startServer();
      log("startServer returned — entering idle wait");
      await new Promise(() => {});
    } catch (err) {
      log(`startServer threw: ${err?.stack || err}`);
      process.exit(1);
    }
  } else if (process.stdin.isTTY) {
    // Interactive terminal — the user typed this, they want the viewer.
    const port = parseInt(args[1]) || derivePort(ROOT);
    console.log(`  Starting viewer at http://127.0.0.1:${port}  (Ctrl-C to stop)\n`);
    await startViewerServer(port);
    process.stderr.write(`[embedded-editor] viewer running at http://127.0.0.1:${port}\n`);
    await new Promise(() => {});
  } else {
    // Non-TTY stdin — Claude Code is speaking MCP JSON-RPC over our stdio.
    // Must NEVER write to stdout; everything diagnostic goes to stderr.
    const log = (msg) => {
      try { process.stderr.write(`[embedded-editor] ${msg}\n`); } catch {}
    };

    log(`starting stdio MCP server pid=${process.pid} node=${process.version} platform=${process.platform}-${process.arch} cwd=${process.cwd()} root=${process.env.EXCALIDRAW_ROOT || "(unset)"}`);

    process.on("uncaughtException",   (err)    => log(`UNCAUGHT: ${err?.stack || err}`));
    process.on("unhandledRejection",  (reason) => log(`UNHANDLED REJECTION: ${reason?.stack || reason}`));
    process.on("exit",                (code)   => log(`process exit code=${code}`));
    process.stdin.on("end",   ()      => log("stdin end — parent closed our input"));
    process.stdin.on("close", ()      => log("stdin close"));
    process.stdin.on("error", (err)   => log(`stdin error: ${err?.message}`));
    process.stdout.on("error",(err)   => log(`stdout error: ${err?.message}`));

    try {
      await startServer();
      log("startServer returned — entering idle wait");
      await new Promise(() => {});
    } catch (err) {
      log(`startServer threw: ${err?.stack || err}`);
      process.exit(1);
    }
  }
} else {
  console.log(`
embedded-editor — Visual workspace + MCP tools for Claude Code

Usage:
  npx embedded-editor-for-claude-code init            Set up in current project
  npx embedded-editor-for-claude-code init --global   Set up once for all projects
  npx embedded-editor-for-claude-code serve           Start the viewer (or MCP server if piped)
  npx embedded-editor-for-claude-code serve [port]    Viewer on a custom port

Quick start (one-time global setup):
  npx embedded-editor-for-claude-code init --global
  cd any-project
  npx embedded-editor-for-claude-code serve
  # Restart Claude Code, then ask it to draw diagrams

Quick start (per-project):
  cd your-project
  npx embedded-editor-for-claude-code init
  npx embedded-editor-for-claude-code serve
`);
  process.exit(0);
}
