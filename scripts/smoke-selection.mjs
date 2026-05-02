#!/usr/bin/env node
// Smoke tests for /api/selection endpoints.
// Usage: node scripts/smoke-selection.mjs [port]
// Requires the viewer server to be running on the given port (default 3000).

import assert from "node:assert/strict";

const PORT = parseInt(process.argv[2] || "3000");
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;

async function req(method, path, body, headers = {}) {
  const opts = { method, headers: { Origin: ORIGIN, ...headers } };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  return fn().then(() => { console.log(`  ✓  ${name}`); passed++; })
             .catch(e => { console.error(`  ✗  ${name}: ${e.message}`); failed++; });
}

await test("GET /api/selection returns null when empty", async () => {
  const r = await req("GET", "/api/selection");
  assert.equal(r.status, 200);
  assert.equal(r.json, null);
});

await test("PUT /api/selection stores markdown payload", async () => {
  const payload = {
    type: "markdown", file: "test.md", selectedText: "hello world",
    startLine: 1, endLine: 1, startCol: 0, endCol: 11,
    headingPath: ["Introduction"], contextBefore: "before", contextAfter: "after",
    frontmatter: { tags: "test" }, totalLines: 10, positionPct: 10,
  };
  const r = await req("PUT", "/api/selection", payload);
  assert.equal(r.status, 200);
  assert.equal(r.json?.ok, true);
});

await test("GET /api/selection returns stored payload", async () => {
  const r = await req("GET", "/api/selection");
  assert.equal(r.status, 200);
  assert.equal(r.json?.type, "markdown");
  assert.equal(r.json?.file, "test.md");
  // raw GET does NOT clear
  const r2 = await req("GET", "/api/selection");
  assert.equal(r2.json?.type, "markdown");
});

await test("GET /api/selection?text=1 returns formatted text and clears", async () => {
  const r = await req("GET", "/api/selection?text=1");
  assert.equal(r.status, 200);
  assert.ok(r.text.includes("<editor-selection"), "missing opening tag");
  assert.ok(r.text.includes('type="markdown"'), "missing type");
  assert.ok(r.text.includes('file="test.md"'), "missing file");
  assert.ok(r.text.includes("hello world"), "missing selected text");
  assert.ok(r.text.includes("Introduction"), "missing heading");
  assert.ok(r.text.includes("</editor-selection>"), "missing closing tag");
  // one-shot: should now be cleared
  const r2 = await req("GET", "/api/selection?text=1");
  assert.equal(r2.text.trim(), "", "should be empty after one-shot read");
});

await test("PUT /api/selection stores excalidraw payload", async () => {
  const payload = {
    type: "excalidraw", file: "system.excalidraw",
    selectedElements: [{
      type: "rectangle", text: "User Service", x: 100, y: 200, width: 150, height: 80,
      boundElements: [{ direction: "out", arrowLabel: "HTTP", connectedElementText: "Database" }],
      frameName: "Backend", groupIds: [], link: null,
    }],
    totalElements: 42,
  };
  const r = await req("PUT", "/api/selection", payload);
  assert.equal(r.status, 200);
  const rf = await req("GET", "/api/selection?text=1");
  assert.ok(rf.text.includes('type="excalidraw"'));
  assert.ok(rf.text.includes("User Service"));
  assert.ok(rf.text.includes("→ arrow"));
  assert.ok(rf.text.includes("Database"));
  assert.ok(rf.text.includes("Backend"));
  assert.ok(rf.text.includes("42 elements total"));
});

await test("PUT /api/selection stores tldraw payload", async () => {
  const payload = {
    type: "tldraw", file: "wireframe.tldraw",
    selectedShapes: [{
      type: "geo", geo: "rectangle", text: "Login Form",
      x: 200, y: 150, width: 300, height: 400,
      connectedArrows: [{ direction: "out", arrowLabel: "submit", otherEndText: "Dashboard" }],
      parentFrameName: "Onboarding",
    }],
    totalShapes: 28,
  };
  const r = await req("PUT", "/api/selection", payload);
  assert.equal(r.status, 200);
  const rf = await req("GET", "/api/selection?text=1");
  assert.ok(rf.text.includes('type="tldraw"'));
  assert.ok(rf.text.includes("Login Form"));
  assert.ok(rf.text.includes("Onboarding"));
  assert.ok(rf.text.includes("28 shapes total"));
});

await test("PUT /api/selection stores duckdb payload", async () => {
  const payload = {
    type: "duckdb", file: "jobs.duckdb", tableName: "jobs",
    schema: [{ column: "company", type: "TEXT" }, { column: "status", type: "TEXT" }],
    selectedRows: [
      { rowIndex: 2, data: { company: "Anthropic", status: "interview" } },
    ],
    totalRows: 45, currentQuery: "SELECT * FROM jobs",
  };
  const r = await req("PUT", "/api/selection", payload);
  assert.equal(r.status, 200);
  const rf = await req("GET", "/api/selection?text=1");
  assert.ok(rf.text.includes('type="duckdb"'));
  assert.ok(rf.text.includes("Anthropic"));
  assert.ok(rf.text.includes("Schema:"));
  assert.ok(rf.text.includes("SELECT * FROM jobs"));
});

await test("DELETE /api/selection clears state", async () => {
  await req("PUT", "/api/selection", { type: "markdown", file: "x.md", selectedText: "x",
    startLine: 1, endLine: 1, startCol: 0, endCol: 1, headingPath: [],
    contextBefore: "", contextAfter: "", frontmatter: {}, totalLines: 1, positionPct: 50 });
  const r = await req("DELETE", "/api/selection");
  assert.equal(r.status, 200);
  const r2 = await req("GET", "/api/selection");
  assert.equal(r2.json, null);
});

await test("PUT without Origin header returns 403", async () => {
  const res = await fetch(`${BASE}/api/selection`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "markdown" }),
  });
  assert.equal(res.status, 403);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
