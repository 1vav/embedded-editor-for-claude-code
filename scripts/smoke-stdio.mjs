// Drives the stdio MCP server through the full happy path and verifies:
//   - MCP initialize handshake
//   - list_diagrams (empty)
//   - create_diagram -> file appears + PNG image content returned
//   - write_diagram  -> PNG image content returned
//   - read_diagram   -> JSON + PNG returned
//   - append_elements -> PNG returned
//   - list_diagrams (one entry)
//   - delete_diagram -> file gone
// Exits non-zero on any failure.

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "excali-smoke-"));
console.error(`[smoke] workdir = ${workdir}`);

const child = spawn("node", ["bin/cli.js", "serve"], {
  cwd: process.cwd(),
  env: { ...process.env, EXCALIDRAW_ROOT: workdir },
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const waiters = new Map();
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && waiters.has(msg.id)) {
      waiters.get(msg.id)(msg);
      waiters.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiters.set(id, (msg) => {
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function assert(cond, label) {
  if (!cond) throw new Error("assert failed: " + label);
  console.log("  ✓", label);
}

function contentTypes(r) { return (r?.content || []).map((c) => c.type).join(","); }

const sampleElement = {
  id: "r1", type: "rectangle", x: 50, y: 50, width: 200, height: 100,
  strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "solid",
  strokeWidth: 2, roughness: 1, opacity: 100, angle: 0, seed: 1,
  version: 1, versionNonce: 1, isDeleted: false, groupIds: [], frameId: null,
  roundness: null, boundElements: null, updated: 0, link: null, locked: false,
  strokeStyle: "solid", index: null,
};

try {
  console.log("\n[smoke] initialize");
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  assert(init.serverInfo?.name === "embedded-editor", "server identifies itself");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  console.log("\n[smoke] tools/list");
  const tools = await rpc("tools/list", {});
  const names = tools.tools.map((t) => t.name).sort();
  const expected = [
    "append_elements","create_diagram","create_note","create_table","create_view",
    "delete_diagram","delete_note","delete_rows","get_backlinks",
    "list_diagrams","list_history","list_notes","list_tables","list_tldraw","list_workspace",
    "query_table","read_diagram","read_note","read_table","read_tldraw","rename_file","restore_snapshot",
    "write_diagram","write_note","write_rows",
  ].sort();
  assert(
    JSON.stringify(names) === JSON.stringify(expected),
    `all ${expected.length} tools registered`
  );

  console.log("\n[smoke] list_diagrams (empty)");
  const empty = await rpc("tools/call", { name: "list_diagrams", arguments: {} });
  assert(empty.content[0].text.includes("No .excalidraw files"), "empty listing");

  console.log("\n[smoke] create_diagram 'flow'");
  const created = await rpc("tools/call", { name: "create_diagram", arguments: { name: "flow", title: "Test Flow" } });
  assert(fs.existsSync(path.join(workdir, "flow.excalidraw")), "file created on disk");
  assert(contentTypes(created).includes("image"), `create returns image content (got: ${contentTypes(created)})`);
  const img1 = created.content.find((c) => c.type === "image");
  assert(img1.mimeType === "image/png", "image is PNG");
  assert(img1.data.length > 100, `PNG base64 non-empty (${img1.data.length} chars)`);
  fs.writeFileSync("/tmp/smoke-created.png", Buffer.from(img1.data, "base64"));

  console.log("\n[smoke] write_diagram (add rectangle)");
  const written = await rpc("tools/call", { name: "write_diagram", arguments: { name: "flow", elements: [sampleElement] } });
  assert(contentTypes(written).includes("image"), "write returns image");
  const img2 = written.content.find((c) => c.type === "image");
  assert(img2.data.length > img1.data.length, "PNG grew after adding element");
  fs.writeFileSync("/tmp/smoke-written.png", Buffer.from(img2.data, "base64"));

  console.log("\n[smoke] read_diagram");
  const readResult = await rpc("tools/call", { name: "read_diagram", arguments: { name: "flow" } });
  assert(contentTypes(readResult) === "text,image", "read returns text + image");
  assert(readResult.content[0].text.includes("Test Flow"), "title preserved");

  console.log("\n[smoke] append_elements");
  const ellipse = { ...sampleElement, id: "e1", type: "ellipse", x: 300, y: 50,
    strokeColor: "#c92a2a", backgroundColor: "#ffc9c9", fillStyle: "hachure",
    seed: 2, versionNonce: 2 };
  const appended = await rpc("tools/call", { name: "append_elements", arguments: { name: "flow", elements: [ellipse] } });
  assert(contentTypes(appended).includes("image"), "append returns image");
  assert(appended.content[0].text.includes("2 total"), "element count updated");
  fs.writeFileSync("/tmp/smoke-appended.png", Buffer.from(
    appended.content.find((c) => c.type === "image").data, "base64"));

  console.log("\n[smoke] list_diagrams (one entry)");
  const one = await rpc("tools/call", { name: "list_diagrams", arguments: {} });
  assert(one.content[0].text.includes("flow"), "listing shows 'flow'");

  console.log("\n[smoke] delete_diagram");
  const del = await rpc("tools/call", { name: "delete_diagram", arguments: { name: "flow" } });
  assert(del.content[0].text.includes("Deleted"), "delete confirmed");
  assert(!fs.existsSync(path.join(workdir, "flow.excalidraw")), "file removed on disk");

  // ── DuckDB MCP tools
  console.log("\n── DuckDB tools");

  let duckR;

  duckR = await rpc("tools/call", { name: "list_tables", arguments: {} });
  assert(duckR.content[0].text === "(no tables)", "list_tables empty");

  duckR = await rpc("tools/call", { name: "create_table", arguments: {
    name: "smoke-jobs",
    schema: "CREATE TABLE jobs (id INTEGER PRIMARY KEY, company TEXT, status TEXT)",
    created_by: "table"
  }});
  assert(duckR.content[0].text.includes("Created"), "create_table");

  duckR = await rpc("tools/call", { name: "write_rows", arguments: {
    name: "smoke-jobs", table: "jobs",
    rows: [{ id: 1, company: "Acme", status: "Applied" }]
  }});
  assert(duckR.content[0].text.includes("1 row"), "write_rows");

  duckR = await rpc("tools/call", { name: "read_table", arguments: { name: "smoke-jobs" }});
  assert(duckR.content[0].text.includes("Acme"), "read_table");

  duckR = await rpc("tools/call", { name: "query_table", arguments: {
    name: "smoke-jobs",
    sql: "SELECT count(*) AS n FROM jobs"
  }});
  assert(duckR.content[0].text.includes("1"), "query_table count");

  duckR = await rpc("tools/call", { name: "delete_rows", arguments: {
    name: "smoke-jobs", table: "jobs", condition: "id = 1"
  }});
  assert(duckR.content[0].text.includes("Deleted"), "delete_rows");

  duckR = await rpc("tools/call", { name: "list_tables", arguments: {} });
  assert(duckR.content[0].text.includes("smoke-jobs"), "list_tables after create");

  // Clean up DuckDB smoke test file
  try { fs.unlinkSync(path.join(workdir, "smoke-jobs.duckdb")); } catch {}

  console.log("\n[smoke] OK — all checks passed.");
  console.log("[smoke] PNGs saved at /tmp/smoke-{created,written,appended}.png");
  child.kill();
  process.exit(0);
} catch (err) {
  console.error("\n[smoke] FAILED:", err.message);
  child.kill();
  process.exit(1);
}
