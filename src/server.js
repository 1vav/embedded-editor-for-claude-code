import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";
import { renderToPngBase64 } from "./render.js";
import { ROOT, resolveFile as wsResolveFile, rewriteLinks, findBacklinks, listSnapshots } from "./workspace.js";
import { derivePort } from "./paths.js";

const HIST_DIR = path.join(ROOT, ".excalidraw-history");

// ── Excalidraw helpers ────────────────────────────────────────────────────────

function blankDiagram(title = "Untitled") {
  return {
    type: "excalidraw",
    version: 2,
    source: "embedded-editor",
    title,
    elements: [],
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {},
  };
}

async function readDiagram(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeDiagram(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// Render with a 15-second timeout so a stuck headless browser never hangs the MCP server.
async function previewContent(diagram) {
  try {
    const png = await Promise.race([
      renderToPngBase64(diagram),
      new Promise((_, rej) => setTimeout(() => rej(new Error("render timeout")), 15_000)),
    ]);
    return { type: "image", data: png, mimeType: "image/png" };
  } catch (err) {
    return { type: "text", text: `(render failed: ${err.message})` };
  }
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerTools(server) {
  // ── Excalidraw: list ────────────────────────────────────────────────────────
  server.tool(
    "list_diagrams",
    "List all .excalidraw files in the workspace",
    {},
    async () => {
      const files = await glob("**/*.excalidraw", { cwd: ROOT, ignore: ["node_modules/**", ".excalidraw-history/**"] });
      if (files.length === 0) return { content: [{ type: "text", text: "No .excalidraw files found." }] };
      const lines = files.map(f => `- ${f.replace(/\.excalidraw$/, "")}`);
      return { content: [{ type: "text", text: `Found ${files.length} diagram(s):\n${lines.join("\n")}` }] };
    }
  );

  // ── Excalidraw: read ────────────────────────────────────────────────────────
  server.tool(
    "read_diagram",
    "Read a .excalidraw file. Returns a PNG preview plus the full JSON.",
    { name: z.string().describe("Diagram name (without .excalidraw extension)") },
    async ({ name }) => {
      const filePath = wsResolveFile(name, ".excalidraw");
      try {
        const data = await readDiagram(filePath);
        const summary = `Diagram: ${data.title || name}\nElements: ${data.elements?.length ?? 0}\n\nFull JSON:\n${JSON.stringify(data, null, 2)}`;
        return { content: [{ type: "text", text: summary }, await previewContent(data)] };
      } catch {
        return { content: [{ type: "text", text: `Error: Could not read ${name}.excalidraw — does it exist? Run list_diagrams to check.` }] };
      }
    }
  );

  // ── Excalidraw: create ──────────────────────────────────────────────────────
  server.tool(
    "create_diagram",
    "Create a new blank Excalidraw diagram and render it inline as a PNG. USE THIS (instead of writing <svg>, Mermaid, or ASCII art) whenever the user asks to draw, sketch, diagram, chart, or visualize something.",
    {
      name:  z.string().describe("Diagram name (without .excalidraw extension)"),
      title: z.string().optional().describe("Human-readable title"),
    },
    async ({ name, title }) => {
      const filePath = wsResolveFile(name, ".excalidraw");
      try { await fs.access(filePath); return { content: [{ type: "text", text: `${name}.excalidraw already exists. Use write_diagram to update it.` }] }; } catch {}
      const data = blankDiagram(title || name);
      await writeDiagram(filePath, data);
      return { content: [{ type: "text", text: `Created ${name}.excalidraw` }, await previewContent(data)] };
    }
  );

  // ── Excalidraw: write ───────────────────────────────────────────────────────
  server.tool(
    "write_diagram",
    `Write or overwrite a diagram's elements and render it inline as a PNG. USE THIS (instead of <svg>/Mermaid/ASCII) for drawing requests.

Each element needs at minimum: id, type, x, y, width, height.
Supported types: rectangle, ellipse, diamond, arrow, line, text, freedraw.
Common fields: strokeColor, backgroundColor, fillStyle, strokeWidth (1|2|4),
strokeStyle ("solid"|"dashed"|"dotted"), opacity (0-100), angle (radians).
For text: add text, fontSize, fontFamily (1=Virgil, 2=Helvetica, 3=Cascadia), textAlign.
For line/arrow: add points as [[0,0],[dx,dy],...] relative to (x,y).`,
    {
      name:            z.string().describe("Diagram name (without .excalidraw extension)"),
      elements:        z.array(z.any()).describe("Array of Excalidraw elements"),
      title:           z.string().optional().describe("Diagram title"),
      backgroundColor: z.string().optional().describe("Canvas background color (default #ffffff)"),
    },
    async ({ name, elements, title, backgroundColor }) => {
      const filePath = wsResolveFile(name, ".excalidraw");
      let existing = blankDiagram(title || name);
      try { existing = await readDiagram(filePath); } catch {}
      const data = {
        ...existing,
        title: title || existing.title || name,
        elements,
        appState: { ...existing.appState, viewBackgroundColor: backgroundColor || existing.appState?.viewBackgroundColor || "#ffffff" },
      };
      await writeDiagram(filePath, data);
      return { content: [{ type: "text", text: `Wrote ${elements.length} element(s) to ${name}.excalidraw` }, await previewContent(data)] };
    }
  );

  // ── Excalidraw: append ──────────────────────────────────────────────────────
  server.tool(
    "append_elements",
    "Add new elements to an existing diagram (keeps existing ones) and render it inline as a PNG.",
    {
      name:     z.string().describe("Diagram name"),
      elements: z.array(z.any()).describe("New elements to append"),
    },
    async ({ name, elements }) => {
      const filePath = wsResolveFile(name, ".excalidraw");
      let data;
      try { data = await readDiagram(filePath); } catch {
        return { content: [{ type: "text", text: `${name}.excalidraw not found. Use create_diagram first.` }] };
      }
      data.elements = [...(data.elements || []), ...elements];
      await writeDiagram(filePath, data);
      return { content: [{ type: "text", text: `Appended ${elements.length}; diagram now has ${data.elements.length} total elements.` }, await previewContent(data)] };
    }
  );

  // ── Excalidraw: delete ──────────────────────────────────────────────────────
  server.tool(
    "delete_diagram",
    "Delete a .excalidraw file from the workspace",
    { name: z.string().describe("Diagram name (without extension)") },
    async ({ name }) => {
      const filePath = wsResolveFile(name, ".excalidraw");
      try { await fs.unlink(filePath); return { content: [{ type: "text", text: `Deleted ${name}.excalidraw` }] }; }
      catch { return { content: [{ type: "text", text: `Could not delete — ${name}.excalidraw may not exist.` }] }; }
    }
  );

  // ── Notes: list ─────────────────────────────────────────────────────────────
  server.tool(
    "list_notes",
    "List all Markdown notes (.md files) in the workspace",
    {},
    async () => {
      const files = await glob("**/*.md", { cwd: ROOT, ignore: ["node_modules/**", "CLAUDE.md", ".claude/**"] });
      if (files.length === 0) return { content: [{ type: "text", text: "No .md notes found." }] };
      const lines = files.map(f => `- ${f.replace(/\.md$/, "")}`);
      return { content: [{ type: "text", text: `Found ${files.length} note(s):\n${lines.join("\n")}` }] };
    }
  );

  // ── Notes: read ─────────────────────────────────────────────────────────────
  server.tool(
    "read_note",
    "Read the full Markdown content of a note",
    { name: z.string().describe("Note name (without .md extension)") },
    async ({ name }) => {
      const filePath = wsResolveFile(name, ".md");
      try {
        const text = await fs.readFile(filePath, "utf8");
        return { content: [{ type: "text", text }] };
      } catch {
        return { content: [{ type: "text", text: `Error: Could not read ${name}.md — does it exist? Run list_notes to check.` }] };
      }
    }
  );

  // ── Notes: write ────────────────────────────────────────────────────────────
  server.tool(
    "write_note",
    "Write (replace) the full content of a Markdown note. Creates the file if it does not exist.",
    {
      name:    z.string().describe("Note name (without .md extension)"),
      content: z.string().describe("Full Markdown content to write"),
    },
    async ({ name, content }) => {
      const filePath = wsResolveFile(name, ".md");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      return { content: [{ type: "text", text: `Wrote ${content.length} chars to ${name}.md` }] };
    }
  );

  // ── Notes: create ───────────────────────────────────────────────────────────
  server.tool(
    "create_note",
    "Create a new blank Markdown note. Fails if the note already exists.",
    { name: z.string().describe("Note name (without .md extension)") },
    async ({ name }) => {
      const filePath = wsResolveFile(name, ".md");
      try { await fs.access(filePath); return { content: [{ type: "text", text: `${name}.md already exists. Use write_note to update it.` }] }; } catch {}
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `# ${name}\n\n`, "utf8");
      return { content: [{ type: "text", text: `Created ${name}.md` }] };
    }
  );

  // ── Notes: delete ───────────────────────────────────────────────────────────
  server.tool(
    "delete_note",
    "Delete a Markdown note (.md file) from the workspace",
    { name: z.string().describe("Note name (without .md extension)") },
    async ({ name }) => {
      const filePath = wsResolveFile(name, ".md");
      try { await fs.unlink(filePath); return { content: [{ type: "text", text: `Deleted ${name}.md` }] }; }
      catch { return { content: [{ type: "text", text: `Could not delete — ${name}.md may not exist.` }] }; }
    }
  );

  // ── rename_file ─────────────────────────────────────────────────────────────
  server.tool(
    "rename_file",
    "Rename a diagram or note and update all [[wikilinks]] that reference it across the workspace.",
    {
      from: z.string().describe("Current name (without extension)"),
      to:   z.string().describe("New name (without extension)"),
      type: z.enum(["diagram", "note"]).describe('File type: "diagram" (.excalidraw) or "note" (.md)'),
    },
    async ({ from, to, type }) => {
      const ext = type === "diagram" ? ".excalidraw" : ".md";
      const oldPath = wsResolveFile(from, ext);
      const newPath = wsResolveFile(to, ext);
      try { await fs.access(oldPath); } catch {
        return { content: [{ type: "text", text: `Error: ${from}${ext} not found.` }] };
      }
      try { await fs.access(newPath); return { content: [{ type: "text", text: `Error: ${to}${ext} already exists.` }] }; } catch {}
      await fs.mkdir(path.dirname(newPath), { recursive: true });
      await fs.rename(oldPath, newPath);
      const updated = await rewriteLinks(from, to);
      return { content: [{ type: "text", text: `Renamed ${from}${ext} → ${to}${ext}. Updated ${updated} file(s) with wikilinks.` }] };
    }
  );

  // ── tldraw: list ────────────────────────────────────────────────────────────
  server.tool(
    "list_tldraw",
    "List all tldraw canvas files (.tldraw) in the workspace",
    {},
    async () => {
      const files = await glob("**/*.tldraw", { cwd: ROOT, ignore: ["node_modules/**"] });
      if (files.length === 0) return { content: [{ type: "text", text: "No .tldraw files found." }] };
      const lines = files.map(f => `- ${f.replace(/\.tldraw$/, "")}`);
      return { content: [{ type: "text", text: `Found ${files.length} tldraw canvas(es):\n${lines.join("\n")}` }] };
    }
  );

  // ── tldraw: read ────────────────────────────────────────────────────────────
  server.tool(
    "read_tldraw",
    "Read the raw JSON snapshot of a tldraw canvas. Note: tldraw files are browser-only; you can read their state but editing is done in the visual editor at http://127.0.0.1:3000.",
    { name: z.string().describe("Canvas name (without .tldraw extension)") },
    async ({ name }) => {
      const filePath = wsResolveFile(name, ".tldraw");
      try {
        const text = await fs.readFile(filePath, "utf8");
        return { content: [{ type: "text", text: `tldraw canvas: ${name}\n\n${text}` }] };
      } catch {
        return { content: [{ type: "text", text: `Error: Could not read ${name}.tldraw — does it exist? Run list_tldraw to check.` }] };
      }
    }
  );

  // ── get_backlinks ───────────────────────────────────────────────────────────
  server.tool(
    "get_backlinks",
    "Find all files in the workspace that contain a [[wikilink]] to the given file.",
    { name: z.string().describe("File name (without extension) to find backlinks for") },
    async ({ name }) => {
      const links = await findBacklinks(name);
      if (links.length === 0) return { content: [{ type: "text", text: `No files link to "${name}".` }] };
      const lines = links.map(l => `- ${l.name} (${l.type})`);
      return { content: [{ type: "text", text: `${links.length} file(s) link to "${name}":\n${lines.join("\n")}` }] };
    }
  );

  // ── list_history ────────────────────────────────────────────────────────────
  server.tool(
    "list_history",
    "List saved version snapshots for an Excalidraw diagram.",
    { name: z.string().describe("Diagram name (without .excalidraw extension)") },
    async ({ name }) => {
      const snaps = await listSnapshots(name);
      if (snaps.length === 0) return { content: [{ type: "text", text: `No saved versions for "${name}".` }] };
      const lines = snaps.map(s => `- ${s.ts}  (${new Date(s.ts).toLocaleString()})`);
      return { content: [{ type: "text", text: `${snaps.length} saved version(s) for "${name}":\n${lines.join("\n")}` }] };
    }
  );

  // ── restore_snapshot ────────────────────────────────────────────────────────
  server.tool(
    "restore_snapshot",
    "Restore an Excalidraw diagram to a saved version. Use list_history to get valid timestamps.",
    {
      name: z.string().describe("Diagram name (without .excalidraw extension)"),
      ts:   z.number().describe("Snapshot timestamp from list_history"),
    },
    async ({ name, ts }) => {
      const snapPath = path.join(HIST_DIR, name, `${ts}.json`);
      let snap;
      try {
        snap = JSON.parse(await fs.readFile(snapPath, "utf8"));
      } catch {
        return { content: [{ type: "text", text: `Snapshot ${ts} not found for "${name}". Run list_history to see available timestamps.` }] };
      }
      const filePath = wsResolveFile(name, ".excalidraw");
      await writeDiagram(filePath, snap);
      return {
        content: [
          { type: "text", text: `Restored "${name}" to snapshot from ${new Date(ts).toLocaleString()}` },
          await previewContent(snap),
        ],
      };
    }
  );
}

export function buildMcpServer() {
  const server = new McpServer(
    { name: "embedded-editor", version: "0.1.0" },
    {
      instructions: `This server manages Excalidraw diagrams, Markdown notes, and tldraw canvases in your workspace, and returns PNG previews inline.

USE diagram tools whenever the user asks to "draw", "sketch", "diagram", "chart", or "visualize" anything — flowcharts, architecture diagrams, sequence flows, mind maps, UI mockups, etc. PREFER this over inline <svg>, Mermaid code blocks, ASCII art, or prose descriptions. Every write returns a PNG that the host renders inline, so the user sees the diagram as you build it.

USE note tools to read and write Markdown notes. Notes support [[wikilinks]] to link to other notes and diagrams.

Typical diagram workflow:
  1. create_diagram name:"flow"       (blank canvas)
  2. write_diagram  name:"flow" elements:[...]  (replace)  — OR —
     append_elements name:"flow" elements:[...] (additive)

Typical note workflow:
  1. list_notes       — see what exists
  2. read_note        — read content before editing
  3. write_note       — save changes

Other tools:
  - rename_file       — rename and update all [[wikilinks]]
  - get_backlinks     — find files that link to a given file
  - list_history      — list saved diagram versions
  - restore_snapshot  — restore a diagram to a saved version
  - list_tldraw / read_tldraw — inspect tldraw canvases (browser-only; edit at http://127.0.0.1:${derivePort(ROOT)})

Element schema (minimum): { id, type, x, y, width, height }. Types: rectangle, ellipse, diamond, arrow, line, text, freedraw.`,
    },
  );
  registerTools(server);
  return server;
}

// Write .claude/launch.json in the workspace root so /editor-start picks up
// the correct port for this project without any manual config.
async function writeLaunchJson() {
  const port    = derivePort(ROOT);
  const nodeBin = process.execPath;
  const cliJs   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/cli.js");
  const file    = path.join(ROOT, ".claude", "launch.json");
  let config    = { version: "0.0.1", configurations: [] };
  try { config = JSON.parse(await fs.readFile(file, "utf8")); } catch {}
  if (!Array.isArray(config.configurations)) config.configurations = [];
  const entry = { name: "Embedded Editor", runtimeExecutable: nodeBin, runtimeArgs: [cliJs, "view", String(port)], port };
  const idx = config.configurations.findIndex(c => c.name === "Embedded Editor");
  if (idx >= 0) config.configurations[idx] = entry; else config.configurations.push(entry);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n");
}

export async function startServer() {
  // Best-effort — don't let a write failure crash the MCP server.
  writeLaunchJson().catch(() => {});
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
