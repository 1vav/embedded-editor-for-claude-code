# DuckDB Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.duckdb` as a first-class file type — MCP tools for Claude, HTTP API, full tab view with query pane, inline note embed, and `/table` + `/query` slash commands.

**Architecture:** `src/duck.js` is the shared DuckDB module (connection pool, query execution, frontmatter helper) imported by both `server.js` (MCP) and `viewer-server.js` (HTTP). The SPA gains a `DuckDBView.jsx` component for the tab view and a `TableEmbed` component rendered inline in notes. All new routes follow the existing pattern in `viewer-server.js`.

**Tech Stack:** `duckdb` npm package (Node.js native addon), `@codemirror/lang-sql` (already installed), React, existing CM6 setup.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/duck.js` | DuckDB connection pool, `runQuery`, `runExec`, `readFrontmatter`, path safety |
| Create | `src/viewer/DuckDBView.jsx` | `TableView` + `TableEmbed` React components |
| Modify | `package.json` | Add `duckdb` dependency |
| Modify | `src/workspace.js` | Extend `rewriteLinks` + `findBacklinks` for `.duckdb` |
| Modify | `src/viewer-server.js` | HTTP routes, SSE watcher, import duck.js |
| Modify | `src/server.js` | Six MCP tools |
| Modify | `src/viewer/entry.jsx` | Theme tokens, duck icon, tab routing, note embed, slash commands |
| Modify | `scripts/smoke-stdio.mjs` | DuckDB MCP smoke tests |

---

## Task 1: Install duckdb + create src/duck.js

**Files:**
- Modify: `package.json`
- Create: `src/duck.js`

- [ ] **Step 1.1: Install duckdb**

```bash
npm install duckdb
```

Expected: `duckdb` appears in `package.json` dependencies. Native addon compiles (may take ~30s).

- [ ] **Step 1.2: Verify install**

```bash
node -e "import('duckdb').then(m => { const db = new m.default.Database(':memory:'); db.all('SELECT 42 AS n', (e,r) => { console.log(r[0].n === 42 ? 'OK' : 'FAIL'); db.close(); }); })"
```

Expected output: `OK`

- [ ] **Step 1.3: Create src/duck.js**

```js
// DuckDB connection pool shared by server.js (MCP) and viewer-server.js (HTTP).
import duckdb from "duckdb";
import path   from "path";
import { glob } from "glob";
import { ROOT } from "./workspace.js";

// pool: Map<filePath, { db: duckdb.Database, timer: NodeJS.Timeout }>
const pool = new Map();
const IDLE_MS = 60_000;

function resetTimer(filePath) {
  const entry = pool.get(filePath);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.db.close(() => {});
    pool.delete(filePath);
  }, IDLE_MS);
}

export function getDb(filePath) {
  if (pool.has(filePath)) {
    resetTimer(filePath);
    return Promise.resolve(pool.get(filePath).db);
  }
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(filePath, (err) => {
      if (err) return reject(err);
      const entry = { db, timer: null };
      pool.set(filePath, entry);
      resetTimer(filePath);
      resolve(db);
    });
  });
}

export function closeAll() {
  for (const { db, timer } of pool.values()) {
    clearTimeout(timer);
    try { db.close(() => {}); } catch {}
  }
  pool.clear();
}

// Run a SELECT-style query; returns { columns: string[], rows: object[] }
export async function runQuery(filePath, sql, cwd = null) {
  const safeSql = cwd ? injectCwd(sql, filePath, cwd) : sql;
  const db = await getDb(filePath);
  return new Promise((resolve, reject) => {
    db.all(safeSql, (err, rows) => {
      if (err) return reject(err);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      resolve({ columns, rows, rowCount: rows.length });
    });
  });
}

// Run a non-SELECT statement (CREATE TABLE, INSERT, DELETE, etc.)
export async function runExec(filePath, sql, cwd = null) {
  const safeSql = cwd ? injectCwd(sql, filePath, cwd) : sql;
  const db = await getDb(filePath);
  return new Promise((resolve, reject) => {
    db.exec(safeSql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Replace relative ./path references in SQL with absolute paths that stay
// within EXCALIDRAW_ROOT. Throws if a resolved path escapes ROOT.
function injectCwd(sql, filePath, cwd) {
  const base = cwd || path.dirname(filePath);
  return sql.replace(/(['"])(\.\/[^'"]+)(['"])/g, (_, q1, rel, q2) => {
    // Expand glob-like patterns by keeping them as-is after resolving base.
    // DuckDB resolves globs itself; we just need the absolute base prefix.
    const abs = path.resolve(base, rel);
    if (!abs.startsWith(ROOT)) throw new Error(`Path escapes workspace: ${rel}`);
    return q1 + abs + q2;
  });
}

// Parse YAML frontmatter from .md files matching a glob pattern.
// Returns an array of objects (one per file) with all frontmatter keys + _file.
export async function readFrontmatter(globPattern, baseDir) {
  const files = await glob(globPattern, { cwd: baseDir, absolute: true });
  const { readFile } = await import("fs/promises");
  const results = [];
  for (const f of files) {
    try {
      const text = await readFile(f, "utf8");
      const fm = parseFrontmatter(text);
      if (fm) results.push({ _file: path.relative(baseDir, f), ...fm });
    } catch {}
  }
  return results;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const obj = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) obj[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return Object.keys(obj).length ? obj : null;
}
```

- [ ] **Step 1.4: Smoke-test duck.js**

```bash
node --input-type=module <<'EOF'
import { runExec, runQuery, closeAll } from "./src/duck.js";
import os from "os";
import path from "path";
const tmp = path.join(os.tmpdir(), `test-${Date.now()}.duckdb`);
await runExec(tmp, "CREATE TABLE t (id INTEGER, name TEXT)");
await runExec(tmp, "INSERT INTO t VALUES (1, 'hello')");
const { rows } = await runQuery(tmp, "SELECT * FROM t");
console.assert(rows[0].name === "hello", "expected hello");
console.log("duck.js OK");
closeAll();
EOF
```

Expected: `duck.js OK`

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json src/duck.js
git commit -m "feat: add duckdb dependency and connection pool (src/duck.js)"
```

---

## Task 2: Extend workspace.js for .duckdb

**Files:**
- Modify: `src/workspace.js`

- [ ] **Step 2.1: Read current rewriteLinks and findBacklinks**

Open `src/workspace.js` and locate the `rewriteLinks` and `findBacklinks` functions. Note the regex patterns used for `.excalidraw` and `.md` files — `.duckdb` follows the same `[[name]]` wikilink convention.

- [ ] **Step 2.2: Add .duckdb support to rewriteLinks**

In `src/workspace.js`, extend the `rewriteLinks` function to also rewrite `[[oldName.duckdb]]` → `[[newName.duckdb]]` in `.md` and `.excalidraw` files. The pattern is the same as for excalidraw links — add a third regex for `.duckdb`:

```js
// Inside rewriteLinks, after the existing excalidraw/tldraw patterns:
const duckRe = new RegExp(`\\[\\[${escRe(oldName)}\\.duckdb\\]\\]`, "gi");
rewritten = rewritten.replace(duckRe, `[[${newName}.duckdb]]`);
```

- [ ] **Step 2.3: Add .duckdb support to findBacklinks**

In `findBacklinks`, add `.duckdb` to the set of extensions searched. The pattern `[[name.duckdb]]` should be detectable in `.md` files. Add:

```js
// After existing backlink checks:
if (ext === ".duckdb") {
  const duckRe = new RegExp(`\\[\\[${escRe(name)}\\.duckdb\\]\\]`, "i");
  if (duckRe.test(content)) backlinks.push(relativePath);
}
```

- [ ] **Step 2.4: Verify workspace changes don't break existing smoke test**

```bash
node scripts/smoke-stdio.mjs
```

Expected: all assertions pass, exits 0.

- [ ] **Step 2.5: Commit**

```bash
git add src/workspace.js
git commit -m "feat: extend workspace.js rewriteLinks + findBacklinks for .duckdb files"
```

---

## Task 3: HTTP routes in viewer-server.js

**Files:**
- Modify: `src/viewer-server.js`

- [ ] **Step 3.1: Import duck.js in viewer-server.js**

At the top of `src/viewer-server.js`, after the existing imports, add:

```js
import { runQuery, runExec, closeAll as duckCloseAll } from "./duck.js";
```

- [ ] **Step 3.2: Add .duckdb to the SSE file watcher**

In the `watch(CWD, ...)` callback (around line 86), add a branch for `.duckdb` files:

```js
else if (filename.endsWith(".duckdb") && !filename.includes("_ee_")) {
  event = "table:changed";
}
// And in the name-stripping block:
: filename.endsWith(".duckdb") ? filename.replace(/\.duckdb$/, "")
```

And in the touchRecent call after the broadcast:

```js
else if (event === "table:changed") touchRecent(name, "table");
```

- [ ] **Step 3.3: Add GET /api/tables route**

After the `GET /api/tldraw` route (~line 447), add:

```js
// ── Tables list
if (pathname === "/api/tables") {
  const files = await glob("**/*.duckdb", { cwd: CWD, ignore: ["node_modules/**"] });
  return json(res, files.map(f => f.replace(/\.duckdb$/, "")).sort());
}
```

- [ ] **Step 3.4: Add table CRUD routes**

After the GET /api/tables block, add:

```js
// ── Table CRUD
const tbm = pathname.match(/^\/api\/table\/(.+)$/);
if (tbm) {
  const rawSeg = tbm[1];
  // split off /rows and /query suffixes before name validation
  const isRows  = rawSeg.endsWith("/rows");
  const isQuery = rawSeg.endsWith("/query");
  const rawName = isRows ? rawSeg.slice(0, -5)
                : isQuery ? rawSeg.slice(0, -6)
                : rawSeg;
  const name = safeName(rawName);
  if (!name) return json(res, { error: "invalid name" }, 400);
  const fp = path.join(CWD, `${name}.duckdb`);
  const tableDir = path.dirname(fp);

  // GET /api/table/:name — read rows (optional ?sql= for custom SELECT)
  if (method === "GET" && !isRows && !isQuery) {
    try {
      const params = new URL(req.url, "http://x").searchParams;
      const sql = params.get("sql") || "SELECT * FROM (SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_ee_%') t";
      const result = await runQuery(fp, sql, tableDir);
      touchRecent(name, "table");
      return json(res, result);
    } catch (e) { return json(res, { error: e.message }, 400); }
  }

  // POST /api/table/:name — create
  if (method === "POST" && !isRows && !isQuery) {
    if (!checkOrigin(req)) return json(res, { error: "forbidden" }, 403);
    try {
      await fs.access(fp);
      return json(res, { error: `${name}.duckdb already exists` }, 409);
    } catch {}
    const body = await readBody(req);
    const createdBy = body?.created_by ?? "table";
    try {
      await fs.mkdir(path.dirname(fp), { recursive: true });
      // Open (creates file), write meta
      await runExec(fp, `CREATE TABLE IF NOT EXISTS _ee_meta (key TEXT PRIMARY KEY, value TEXT)`);
      await runExec(fp, `INSERT OR REPLACE INTO _ee_meta VALUES ('created_by', '${createdBy}')`);
      if (body?.schema) await runExec(fp, body.schema, tableDir);
      touchRecent(name, "table");
      broadcast("table:changed", { name, op: "created" });
      return json(res, { ok: true });
    } catch (e) { return json(res, { error: e.message }, 400); }
  }

  // PUT /api/table/:name/rows — upsert rows
  if (method === "PUT" && isRows) {
    if (!checkOrigin(req)) return json(res, { error: "forbidden" }, 403);
    const body = await readBody(req);
    if (!body?.table || !Array.isArray(body.rows)) return json(res, { error: "expected {table, rows}" }, 400);
    try {
      for (const row of body.rows) {
        const cols = Object.keys(row).join(", ");
        const vals = Object.values(row).map(v => typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : v).join(", ");
        await runExec(fp, `INSERT OR REPLACE INTO "${body.table}" (${cols}) VALUES (${vals})`, tableDir);
      }
      broadcast("table:changed", { name, op: "updated" });
      return json(res, { ok: true, count: body.rows.length });
    } catch (e) { return json(res, { error: e.message }, 400); }
  }

  // DELETE /api/table/:name
  if (method === "DELETE" && !isRows && !isQuery) {
    if (!checkOrigin(req)) return json(res, { error: "forbidden" }, 403);
    try {
      // Close connection before deleting the file
      const { closeAll: _ } = await import("./duck.js");
      await fs.unlink(fp);
      broadcast("table:deleted", { name, op: "deleted" });
      return json(res, { ok: true });
    } catch { return json(res, { error: "not found" }, 404); }
  }

  // POST /api/table/:name/query — run arbitrary SQL
  if (method === "POST" && isQuery) {
    if (!checkOrigin(req)) return json(res, { error: "forbidden" }, 403);
    const body = await readBody(req);
    if (!body?.sql) return json(res, { error: "expected {sql}" }, 400);
    try {
      const result = await runQuery(fp, body.sql, tableDir);
      return json(res, result);
    } catch (e) { return json(res, { error: e.message }, 400); }
  }

  res.writeHead(405); return res.end();
}
```

- [ ] **Step 3.5: Remove per-route checkOrigin calls**

The existing middleware at the top of the request handler (lines 364-371 of `viewer-server.js`) already blocks all PUT/POST/DELETE requests without a valid `Origin` header — returning 403 before any route handler runs. Remove all `if (!checkOrigin(req)) return json(res, { error: "forbidden" }, 403);` lines from the route handlers added in Step 3.4. No `checkOrigin` helper is needed.

- [ ] **Step 3.6: Manual test — start server and curl the routes**

```bash
# In one terminal: start the viewer server
node bin/cli.js view 3858

# In another terminal:
# List tables (empty)
curl -s http://localhost:3858/api/tables
# Expected: []

# Create a table
curl -s -X POST http://localhost:3858/api/table/test-jobs \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3858" \
  -d '{"created_by":"table","schema":"CREATE TABLE jobs (id INTEGER, company TEXT, status TEXT)"}'
# Expected: {"ok":true}

# Upsert a row
curl -s -X PUT http://localhost:3858/api/table/test-jobs/rows \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3858" \
  -d '{"table":"jobs","rows":[{"id":1,"company":"Acme","status":"Applied"}]}'
# Expected: {"ok":true,"count":1}

# Read rows
curl -s "http://localhost:3858/api/table/test-jobs"
# Expected: {"columns":["id","company","status"],"rows":[{"id":1,"company":"Acme","status":"Applied"}],"rowCount":1}

# Delete
curl -s -X DELETE http://localhost:3858/api/table/test-jobs \
  -H "Origin: http://localhost:3858"
# Expected: {"ok":true}
```

- [ ] **Step 3.7: Commit**

```bash
git add src/viewer-server.js src/duck.js
git commit -m "feat: add DuckDB HTTP routes to viewer-server + SSE watcher"
```

---

## Task 4: MCP tools in server.js

**Files:**
- Modify: `src/server.js`

- [ ] **Step 4.1: Import duck.js in server.js**

At the top of `src/server.js`, add:

```js
import { runQuery, runExec } from "./duck.js";
```

- [ ] **Step 4.2: Add list_tables tool**

After the last existing `server.tool(...)` call, add:

```js
server.tool(
  "list_tables",
  "List all .duckdb table files in the workspace",
  {},
  async () => {
    const { glob } = await import("glob");
    const files = await glob("**/*.duckdb", { cwd: wsROOT, ignore: ["node_modules/**"] });
    const names = files.map(f => f.replace(/\.duckdb$/, "")).sort();
    return { content: [{ type: "text", text: names.length ? names.join("\n") : "(no tables)" }] };
  }
);
```

Note: `ROOT` is imported from `workspace.js` in server.js. Use `ROOT` (not `wsROOT`) for the cwd in the glob call.

- [ ] **Step 4.3: Add create_table tool**

```js
server.tool(
  "create_table",
  "Create a new .duckdb file with a schema. Use CREATE TABLE SQL for schema.",
  {
    name:       z.string().describe("Table file name (without .duckdb extension)"),
    schema:     z.string().describe("CREATE TABLE SQL statement(s) to run after creating the file"),
    created_by: z.enum(["table", "query"]).optional().default("table").describe("'table' for managed tables, 'query' for query views"),
  },
  async ({ name, schema, created_by = "table" }) => {
    const fp = wsResolveFile(name, ".duckdb");
    try { await import("fs/promises").then(m => m.access(fp)); return { content: [{ type: "text", text: `${name}.duckdb already exists. Use query_table or write_rows to modify it.` }] }; } catch {}
    const tableDir = path.dirname(fp);
    await import("fs/promises").then(m => m.mkdir(tableDir, { recursive: true }));
    await runExec(fp, `CREATE TABLE IF NOT EXISTS _ee_meta (key TEXT PRIMARY KEY, value TEXT)`);
    await runExec(fp, `INSERT OR REPLACE INTO _ee_meta VALUES ('created_by', '${created_by}')`);
    if (schema) await runExec(fp, schema, tableDir);
    return { content: [{ type: "text", text: `Created ${name}.duckdb` }] };
  }
);
```

- [ ] **Step 4.4: Add read_table tool**

```js
server.tool(
  "read_table",
  "Read rows from a .duckdb table. Returns a markdown table.",
  {
    name:      z.string().describe("Table file name (without .duckdb extension)"),
    table:     z.string().optional().describe("SQL table name inside the file (defaults to first user table)"),
    where:     z.string().optional().describe("WHERE clause (without the WHERE keyword)"),
    order_by:  z.string().optional().describe("ORDER BY clause (without ORDER BY)"),
    limit:     z.number().optional().default(50).describe("Max rows to return"),
  },
  async ({ name, table, where, order_by, limit = 50 }) => {
    const fp = wsResolveFile(name, ".duckdb");
    const tableDir = path.dirname(fp);
    // Discover first user table if not specified
    let tbl = table;
    if (!tbl) {
      const { rows } = await runQuery(fp, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_ee_%' LIMIT 1`);
      if (!rows.length) return { content: [{ type: "text", text: `${name}.duckdb has no tables yet. Use create_table with a schema first.` }] };
      tbl = rows[0].name;
    }
    let sql = `SELECT * FROM "${tbl}"`;
    if (where)    sql += ` WHERE ${where}`;
    if (order_by) sql += ` ORDER BY ${order_by}`;
    sql += ` LIMIT ${limit}`;
    const { columns, rows, rowCount } = await runQuery(fp, sql, tableDir);
    if (!rows.length) return { content: [{ type: "text", text: `${name}.duckdb / ${tbl}: 0 rows` }] };
    const header = `| ${columns.join(" | ")} |`;
    const sep    = `| ${columns.map(() => "---").join(" | ")} |`;
    const body   = rows.map(r => `| ${columns.map(c => String(r[c] ?? "")).join(" | ")} |`).join("\n");
    return { content: [{ type: "text", text: `${name}.duckdb / ${tbl} (${rowCount} rows)\n\n${header}\n${sep}\n${body}` }] };
  }
);
```

- [ ] **Step 4.5: Add write_rows tool**

```js
server.tool(
  "write_rows",
  "Insert or upsert rows into a table inside a .duckdb file.",
  {
    name:  z.string().describe("Table file name (without .duckdb extension)"),
    table: z.string().describe("SQL table name inside the file"),
    rows:  z.array(z.record(z.unknown())).describe("Array of row objects to insert or replace"),
  },
  async ({ name, table, rows }) => {
    const fp = wsResolveFile(name, ".duckdb");
    const tableDir = path.dirname(fp);
    for (const row of rows) {
      const cols = Object.keys(row).join(", ");
      const vals = Object.values(row).map(v =>
        v === null || v === undefined ? "NULL"
        : typeof v === "string" ? `'${v.replace(/'/g, "''")}'`
        : v
      ).join(", ");
      await runExec(fp, `INSERT OR REPLACE INTO "${table}" (${cols}) VALUES (${vals})`, tableDir);
    }
    return { content: [{ type: "text", text: `Wrote ${rows.length} row(s) to ${name}.duckdb / ${table}` }] };
  }
);
```

- [ ] **Step 4.6: Add delete_rows tool**

```js
server.tool(
  "delete_rows",
  "Delete rows from a table in a .duckdb file matching a condition.",
  {
    name:      z.string().describe("Table file name (without .duckdb extension)"),
    table:     z.string().describe("SQL table name inside the file"),
    condition: z.string().describe("WHERE condition (without WHERE keyword), e.g. 'id = 5' or 'status = \\'Rejected\\'"),
  },
  async ({ name, table, condition }) => {
    const fp = wsResolveFile(name, ".duckdb");
    await runExec(fp, `DELETE FROM "${table}" WHERE ${condition}`);
    return { content: [{ type: "text", text: `Deleted rows from ${name}.duckdb / ${table} WHERE ${condition}` }] };
  }
);
```

- [ ] **Step 4.7: Add query_table tool**

```js
server.tool(
  "query_table",
  "Run arbitrary SQL against a .duckdb file. Paths like './subdir/*.csv' in read_csv() resolve relative to the .duckdb file's directory. Use read_frontmatter('./glob') to load YAML frontmatter from .md files as rows.",
  {
    name: z.string().describe("Table file name (without .duckdb extension)"),
    sql:  z.string().describe("SQL to execute. May reference read_csv('./path'), read_json('./path'), or use read_frontmatter syntax."),
    save_as: z.string().optional().describe("If provided, INSERT results into this table name (table must exist)"),
  },
  async ({ name, sql, save_as }) => {
    const fp = wsResolveFile(name, ".duckdb");
    const tableDir = path.dirname(fp);

    // read_frontmatter('./glob') — custom syntax, not real SQL
    const fmMatch = sql.match(/read_frontmatter\(['"]([^'"]+)['"]\)/);
    if (fmMatch) {
      const { readFrontmatter } = await import("./duck.js");
      const rows = await readFrontmatter(fmMatch[1], tableDir);
      if (save_as && rows.length) {
        for (const row of rows) {
          const cols = Object.keys(row).join(", ");
          const vals = Object.values(row).map(v => `'${String(v).replace(/'/g, "''")}'`).join(", ");
          await runExec(fp, `INSERT OR REPLACE INTO "${save_as}" (${cols}) VALUES (${vals})`);
        }
        return { content: [{ type: "text", text: `Inserted ${rows.length} frontmatter rows into ${name}.duckdb / ${save_as}` }] };
      }
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const header = `| ${cols.join(" | ")} |`;
      const sep    = `| ${cols.map(() => "---").join(" | ")} |`;
      const body   = rows.map(r => `| ${cols.map(c => String(r[c] ?? "")).join(" | ")} |`).join("\n");
      return { content: [{ type: "text", text: `${rows.length} frontmatter rows\n\n${header}\n${sep}\n${body}` }] };
    }

    const { columns, rows, rowCount } = await runQuery(fp, sql, tableDir);
    if (save_as && rows.length) {
      for (const row of rows) {
        const cols = Object.keys(row).join(", ");
        const vals = Object.values(row).map(v =>
          v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`
        ).join(", ");
        await runExec(fp, `INSERT OR REPLACE INTO "${save_as}" (${cols}) VALUES (${vals})`);
      }
      return { content: [{ type: "text", text: `Inserted ${rowCount} rows into ${name}.duckdb / ${save_as}` }] };
    }
    if (!rows.length) return { content: [{ type: "text", text: `Query returned 0 rows` }] };
    const header = `| ${columns.join(" | ")} |`;
    const sep    = `| ${columns.map(() => "---").join(" | ")} |`;
    const body   = rows.map(r => `| ${columns.map(c => String(r[c] ?? "")).join(" | ")} |`).join("\n");
    return { content: [{ type: "text", text: `${rowCount} rows\n\n${header}\n${sep}\n${body}` }] };
  }
);
```

- [ ] **Step 4.8: Commit**

```bash
git add src/server.js
git commit -m "feat: add list_tables, create_table, read_table, write_rows, delete_rows, query_table MCP tools"
```

---

## Task 5: Extend smoke test for DuckDB MCP tools

**Files:**
- Modify: `scripts/smoke-stdio.mjs`

- [ ] **Step 5.1: Add DuckDB assertions to smoke-stdio.mjs**

At the end of `scripts/smoke-stdio.mjs`, before the `child.kill()` and `process.exit(0)` calls, add:

```js
// ── DuckDB MCP tools
console.log("\n── DuckDB tools");

let r;

r = await rpc("tools/call", { name: "list_tables", arguments: {} });
assert(r.content[0].text === "(no tables)", "list_tables empty");

r = await rpc("tools/call", { name: "create_table", arguments: {
  name: "smoke-jobs",
  schema: "CREATE TABLE jobs (id INTEGER, company TEXT, status TEXT)",
  created_by: "table"
}});
assert(r.content[0].text.includes("Created"), "create_table");

r = await rpc("tools/call", { name: "write_rows", arguments: {
  name: "smoke-jobs", table: "jobs",
  rows: [{ id: 1, company: "Acme", status: "Applied" }]
}});
assert(r.content[0].text.includes("1 row"), "write_rows");

r = await rpc("tools/call", { name: "read_table", arguments: { name: "smoke-jobs" }});
assert(r.content[0].text.includes("Acme"), "read_table");

r = await rpc("tools/call", { name: "query_table", arguments: {
  name: "smoke-jobs",
  sql: "SELECT count(*) AS n FROM jobs"
}});
assert(r.content[0].text.includes("1"), "query_table count");

r = await rpc("tools/call", { name: "delete_rows", arguments: {
  name: "smoke-jobs", table: "jobs", condition: "id = 1"
}});
assert(r.content[0].text.includes("Deleted"), "delete_rows");

r = await rpc("tools/call", { name: "list_tables", arguments: {} });
assert(r.content[0].text.includes("smoke-jobs"), "list_tables after create");
```

- [ ] **Step 5.2: Run the full smoke test**

```bash
node scripts/smoke-stdio.mjs
```

Expected: all assertions pass including the new DuckDB ones, exits 0.

- [ ] **Step 5.3: Commit**

```bash
git add scripts/smoke-stdio.mjs
git commit -m "test: add DuckDB MCP tool assertions to smoke-stdio"
```

---

## Task 6: Theme tokens + duck SVG icon in entry.jsx

**Files:**
- Modify: `src/viewer/entry.jsx`

- [ ] **Step 6.1: Add duck color tokens to DARK and LIGHT themes**

In `src/viewer/entry.jsx`, locate the `DARK` object (~line 380) and add `duck`:

```js
const DARK = {
  // ...existing tokens...
  duck: "#facc15",
  // ...
};
```

Locate the `LIGHT` object (~line 389) and add:

```js
const LIGHT = {
  // ...existing tokens...
  duck: "#b45309",
  // ...
};
```

- [ ] **Step 6.2: Add DuckBrandIcon SVG component**

After `TldrawBrandIcon` (~line 898), add:

```jsx
// DuckDB duck icon — simplified duck silhouette in yellow
const DuckBrandIcon = ({ size = 14 }) => (
  <svg width={size} height={Math.round(size * 0.93)} viewBox="0 0 24 22" fill="none" aria-label="duckdb">
    <ellipse cx="13" cy="14" rx="9" ry="7" fill="#facc15"/>
    <circle cx="20" cy="7" r="4.5" fill="#facc15"/>
    <circle cx="21.5" cy="5.5" r="1" fill="#0d0d0d"/>
    <path d="M23.5 7.5 L26.5 8 L23.5 9Z" fill="#fb923c"/>
    <ellipse cx="11" cy="13" rx="5" ry="3.5" fill="#facc1566" transform="rotate(-15 11 13)"/>
  </svg>
);
```

- [ ] **Step 6.3: Add duck icon to BrandMark**

In the `BrandMark` component (~line 900), add the duck icon between the tldraw and code icons:

```jsx
{dot}
<span title="DuckDB tables" style={{ display: "flex" }}>
  <DuckBrandIcon size={14} />
</span>
```

Also reduce the gap from `5` to `4` on the BrandMark container to keep the top bar from overflowing: `gap: 4`.

- [ ] **Step 6.4: Add duck icon + color to file list items**

In the `FileListItem` component (where `icon` and `iconColor` are determined for the dropdown, ~line 782), add a `table` branch:

```js
const icon      = type === "diagram" ? "⬡" : type === "tldraw" ? "◈" : type === "code" ? "</>" : type === "table" ? null : "¶";
const iconColor = type === "diagram" ? T.accent : type === "tldraw" ? T.tldraw : type === "code" ? T.orange : type === "table" ? T.duck : T.blue;
```

And render the duck SVG for `table` type instead of a text glyph:

```jsx
{type === "table"
  ? <DuckBrandIcon size={10} />
  : <span style={{ fontSize: 10, color: iconColor, flexShrink: 0 }}>{icon}</span>
}
```

Do the same in `FileTab` (~line 1070).

- [ ] **Step 6.5: Add 'table' to the file filter in FileDropdown**

In `FileDropdown` (~line 651), add `table` to the filter options and the allFiles array. Locate where `diagrams`, `notes`, `tldrawFiles`, `codeFiles` are combined and add:

```js
...(tableFiles || []).map(n => ({ name: n, type: "table" })),
```

Add the filter button: after the `code` filter pill, add one for `data`:

```jsx
{["all","drawings","notes","code","data"].map(f => (...))}
```

And in the filter condition:
```js
if (filter === "data" && f.type !== "table") return false;
```

- [ ] **Step 6.6: Build and verify the brand mark renders**

```bash
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=p.version.replace(/-dev\d*$/,'')+'-dev2';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');console.log(p.version)"
npm run build:viewer
```

Restart the preview server and confirm the duck icon appears in the brand mark with no layout overflow.

- [ ] **Step 6.7: Commit**

```bash
git add src/viewer/entry.jsx
git commit -m "feat: add duck color token, DuckBrandIcon, and table type to file list"
```

---

## Task 7: Create src/viewer/DuckDBView.jsx (TableView component)

**Files:**
- Create: `src/viewer/DuckDBView.jsx`

- [ ] **Step 7.1: Create the file with TableView skeleton**

```jsx
// TableView — full-tab view for .duckdb files.
// Exports: TableView
import React, { useState, useEffect, useCallback, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

// Minimal inline theme hook — receives the app theme object via prop
// so DuckDBView.jsx doesn't need to import the ThemeCtx directly.

const enc = encodeURIComponent;
const api = {
  getTables: (name) => fetch(`/api/table/${enc(name)}`).then(r => r.json()),
  upsertRows: (name, table, rows) =>
    fetch(`/api/table/${enc(name)}/rows`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({ table, rows }),
    }).then(r => r.json()),
  runQuery: (name, sql) =>
    fetch(`/api/table/${enc(name)}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({ sql }),
    }).then(r => r.json()),
  getMeta: (name) =>
    fetch(`/api/table/${enc(name)}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({ sql: "SELECT value FROM _ee_meta WHERE key='created_by'" }),
    }).then(r => r.json()),
  listUserTables: (name) =>
    fetch(`/api/table/${enc(name)}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_ee_%'" }),
    }).then(r => r.json()),
};
```

- [ ] **Step 7.2: Add the main TableView component**

Continue in `src/viewer/DuckDBView.jsx`:

```jsx
export function TableView({ name, T, onOpen }) {
  const [dataView,    setDataView]    = useState(() => localStorage.getItem(`ee-table-view-${name}`) ?? "table");
  const [queryOpen,   setQueryOpen]   = useState(false);
  const [liveSync,    setLiveSync]    = useState(() => localStorage.getItem(`ee-table-sync-${name}`) === "live");
  const [isQuery,     setIsQuery]     = useState(false);
  const [userTables,  setUserTables]  = useState([]);
  const [activeTable, setActiveTable] = useState(null);
  const [result,      setResult]      = useState({ columns: [], rows: [] });
  const [sqlText,     setSqlText]     = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const cmRef    = useRef(null);
  const cmViewRef = useRef(null);

  // Load table list + meta on mount
  useEffect(() => {
    let cancelled = false;
    api.listUserTables(name).then(({ rows }) => {
      if (cancelled) return;
      const names = (rows || []).map(r => r.name);
      setUserTables(names);
      if (names.length) {
        setActiveTable(names[0]);
        fetchRows(names[0]);
      }
    }).catch(() => {});
    api.getMeta(name).then(({ rows }) => {
      if (cancelled) return;
      const createdBy = rows?.[0]?.value ?? "table";
      setIsQuery(createdBy === "query");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [name]);

  function fetchRows(tbl) {
    if (!tbl) return;
    setLoading(true); setError(null);
    api.getTables(name).then(res => {
      setResult(res);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }

  function fetchCustom(sqlStr) {
    setLoading(true); setError(null);
    api.runQuery(name, sqlStr || sqlText).then(res => {
      if (res.error) setError(res.error);
      else setResult(res);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }

  async function handleCellBlur(rowIndex, col, newVal) {
    if (!activeTable) return;
    const row = { ...result.rows[rowIndex], [col]: newVal };
    const updated = [...result.rows];
    updated[rowIndex] = row;
    setResult(r => ({ ...r, rows: updated }));
    await api.upsertRows(name, activeTable, [row]).catch(e => setError(e.message));
  }

  async function handleAddRow() {
    if (!activeTable) return;
    const blank = Object.fromEntries(result.columns.map(c => [c, ""]));
    const updated = [...result.rows, blank];
    setResult(r => ({ ...r, rows: updated }));
  }

  function toggleDataView(v) {
    setDataView(v);
    localStorage.setItem(`ee-table-view-${name}`, v);
  }

  function toggleLive() {
    const next = !liveSync;
    setLiveSync(next);
    localStorage.setItem(`ee-table-sync-${name}`, next ? "live" : "lock");
  }

  // CM6 SQL editor in query pane
  useEffect(() => {
    if (!queryOpen || !cmRef.current) return;
    if (cmViewRef.current) return; // already mounted
    const startState = EditorState.create({
      doc: sqlText || `SELECT * FROM ${activeTable ?? "table_name"} LIMIT 50`,
      extensions: [
        history(), sql(), keymap.of([...defaultKeymap, ...historyKeymap,
          { key: "Mod-Enter", run: () => { fetchCustom(cmViewRef.current?.state.doc.toString()); return true; } }
        ]),
        EditorView.updateListener.of(upd => { if (upd.docChanged) setSqlText(upd.state.doc.toString()); }),
        EditorView.theme({ "&": { background: T.surface, color: T.text, fontSize: "12px" }, ".cm-content": { fontFamily: T.mono, padding: "12px 14px" }, ".cm-cursor": { borderLeftColor: T.accent } }),
      ],
    });
    cmViewRef.current = new EditorView({ state: startState, parent: cmRef.current });
    return () => { cmViewRef.current?.destroy(); cmViewRef.current = null; };
  }, [queryOpen]);

  const ghost = (label, active, onClick, title) => (
    <span onClick={onClick} title={title} style={{
      padding: "3px 9px", border: `1px solid ${active ? T.duck + "66" : T.border2}`,
      borderRadius: 5, cursor: "pointer", fontSize: 11, fontFamily: T.mono,
      color: active ? T.duck : T.muted, background: active ? T.duck + "11" : "transparent",
      transition: "all .1s", userSelect: "none",
    }}>{label}</span>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T.bg }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px",
        borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.duck, fontWeight: 600 }}>⬡ {name}.duckdb</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>· {result.rowCount ?? result.rows.length} rows</span>
        <span style={{ color: T.border2, margin: "0 3px" }}>|</span>
        {ghost("⌘ Query", queryOpen, () => setQueryOpen(o => !o), "Toggle SQL query pane")}
        {ghost("≡ Table", dataView === "table", () => toggleDataView("table"), "Table view")}
        {ghost("⊞ Cards", dataView === "cards", () => toggleDataView("cards"), "Card view")}
        <span style={{ color: T.border2, margin: "0 3px" }}>|</span>
        {ghost("↓ Export", false, () => exportCsv(result), "Download as CSV")}
        <span style={{ flex: 1 }} />
        {isQuery && ghost(liveSync ? "⊙ Live" : "⊙ Lock", liveSync, toggleLive, liveSync ? "Re-runs on note changes. Click to lock." : "Locked. Click for live sync.")}
      </div>

      {/* Body: query pane + data pane */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Query pane */}
        <div style={{
          width: queryOpen ? 300 : 0, overflow: "hidden", flexShrink: 0,
          borderRight: queryOpen ? `1px solid ${T.border}` : "none",
          background: T.surface, display: "flex", flexDirection: "column",
          transition: "width .2s ease",
        }}>
          <div style={{ padding: "7px 12px", fontSize: 10, color: T.muted, letterSpacing: ".07em", fontFamily: T.mono, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>SQL · QUERY</div>
          <div ref={cmRef} style={{ flex: 1, overflow: "auto" }} />
          <div style={{ padding: "8px 12px" }}>
            <span onClick={() => fetchCustom()} style={{
              display: "inline-block", padding: "4px 12px", background: T.surface2,
              border: `1px solid ${T.duck}44`, color: T.duck, borderRadius: 5,
              fontSize: 11, fontFamily: T.mono, cursor: "pointer",
            }}>▶ Run <span style={{ color: T.muted, marginLeft: 4 }}>⌘↵</span></span>
          </div>
        </div>

        {/* Data pane */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {error && <div style={{ padding: "10px 14px", color: T.red || "#f87171", fontFamily: T.mono, fontSize: 12 }}>{error}</div>}
          {loading && <div style={{ padding: "10px 14px", color: T.muted, fontFamily: T.mono, fontSize: 12 }}>Loading…</div>}
          {!loading && dataView === "table" && (
            <TableDataView result={result} T={T} onCellBlur={handleCellBlur} onAddRow={handleAddRow} />
          )}
          {!loading && dataView === "cards" && (
            <CardDataView result={result} T={T} onCellBlur={handleCellBlur} onAddRow={handleAddRow} />
          )}
        </div>
      </div>
    </div>
  );
}

function exportCsv({ columns, rows }) {
  if (!columns.length) return;
  const header = columns.join(",");
  const body   = rows.map(r => columns.map(c => JSON.stringify(r[c] ?? "")).join(",")).join("\n");
  const blob   = new Blob([header + "\n" + body], { type: "text/csv" });
  const a      = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "export.csv"; a.click();
}
```

- [ ] **Step 7.3: Add TableDataView subcomponent**

```jsx
function TableDataView({ result, T, onCellBlur, onAddRow }) {
  const { columns, rows } = result;
  if (!columns.length) return <div style={{ padding: 20, color: T.muted, fontFamily: T.mono, fontSize: 12 }}>No data. Run a query or add rows.</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: T.mono }}>
      <thead>
        <tr>
          {columns.map(c => (
            <th key={c} style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 500,
              color: T.muted, letterSpacing: ".06em", textTransform: "uppercase",
              borderBottom: `1px solid ${T.border}`, background: T.surface, whiteSpace: "nowrap" }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={{ borderBottom: `1px solid ${T.border}` }}>
            {columns.map(c => (
              <td key={c} contentEditable suppressContentEditableWarning
                onBlur={e => onCellBlur(ri, c, e.currentTarget.textContent)}
                style={{ padding: "7px 12px", color: T.textDim, outline: "none", whiteSpace: "nowrap" }}
                onFocus={e => e.currentTarget.style.background = T.surface2}
                onBlurCapture={e => e.currentTarget.style.background = "transparent"}>
                {String(row[c] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={columns.length}>
            <button onClick={onAddRow} style={{
              padding: "8px 12px", color: T.muted, fontSize: 11, fontFamily: T.mono,
              cursor: "pointer", textAlign: "left", width: "100%", background: "transparent",
              border: "none", borderTop: `1px solid ${T.border}`, transition: "color .1s",
            }}
            onMouseEnter={e => e.currentTarget.style.color = T.duck}
            onMouseLeave={e => e.currentTarget.style.color = T.muted}>
              + Add row
            </button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
```

- [ ] **Step 7.4: Add CardDataView subcomponent**

```jsx
function CardDataView({ result, T, onCellBlur, onAddRow }) {
  const { columns, rows } = result;
  if (!columns.length) return <div style={{ padding: 20, color: T.muted, fontFamily: T.mono, fontSize: 12 }}>No data.</div>;
  const titleCol  = columns[0];
  const otherCols = columns.slice(1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10, padding: 14 }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
          <div contentEditable suppressContentEditableWarning
            onBlur={e => onCellBlur(ri, titleCol, e.currentTarget.textContent)}
            style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6, outline: "none" }}>
            {String(row[titleCol] ?? "")}
          </div>
          {otherCols.map(c => (
            <div key={c} style={{ fontSize: 11, color: T.muted, marginBottom: 3, fontFamily: T.mono }}>
              {c}:{" "}
              <span contentEditable suppressContentEditableWarning
                onBlur={e => onCellBlur(ri, c, e.currentTarget.textContent)}
                style={{ color: T.textDim, outline: "none" }}>
                {String(row[c] ?? "")}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div onClick={onAddRow} style={{
        border: `1px dashed ${T.border2}`, borderRadius: 8, display: "flex",
        alignItems: "center", justifyContent: "center", color: T.muted,
        cursor: "pointer", minHeight: 100, fontSize: 12, fontFamily: T.mono,
      }}
      onMouseEnter={e => e.currentTarget.style.color = T.duck}
      onMouseLeave={e => e.currentTarget.style.color = T.muted}>
        + Add row
      </div>
    </div>
  );
}
```

- [ ] **Step 7.5: Commit (component only — not wired up yet)**

```bash
git add src/viewer/DuckDBView.jsx
git commit -m "feat: add TableView component with query pane, table/cards views, inline editing"
```

---

## Task 8: Wire TableView into app routing and tab system

**Files:**
- Modify: `src/viewer/entry.jsx`

- [ ] **Step 8.1: Import DuckDBView in entry.jsx**

Near the top of `src/viewer/entry.jsx`, after the existing component imports:

```js
import { TableView, TableEmbed } from "./DuckDBView.jsx";
```

- [ ] **Step 8.2: Add table API methods to the api object**

In the `api` object (~line 406), add:

```js
tables:     ()               => fetch("/api/tables").then(j),
newTable:   (n, createdBy)   => fetch(`/api/table/${enc(n)}`, { method: "POST", headers: { "Content-Type": "application/json", "Origin": location.origin }, body: JSON.stringify({ created_by: createdBy }) }),
delTable:   (n)              => fetch(`/api/table/${enc(n)}`, { method: "DELETE", headers: { "Origin": location.origin } }),
```

- [ ] **Step 8.3: Add tableFiles to App state and refresh**

In the `App` component, add `tableFiles` state alongside `diagrams`, `notes`, etc.:

```js
const [tableFiles, setTableFiles] = useState([]);
```

In the `refresh()` function, add:

```js
api.tables().then(setTableFiles).catch(() => {});
```

In `refreshRecent()`, keep as-is (recent list already includes tables after Task 3).

- [ ] **Step 8.4: Add table:changed/table:deleted to the SSE event listener**

In the SSE `addEventListener` call (~line 448 area), add:

```js
["diagram:changed","diagram:deleted","note:changed","note:deleted",
 "tldraw:changed","tldraw:deleted","code:changed",
 "table:changed","table:deleted"]  // ← add these two
```

In the SSE handler callback, add cases:

```js
if (type === "table") {
  if (sub === "changed") refresh();
  if (sub === "deleted") { refresh(); closeTabs(t => t.type === "table" && t.name === data.name); }
}
```

- [ ] **Step 8.5: Pass tableFiles to FileDropdown and TopBar**

Find where `FileDropdown` and `TopBar` are rendered and add `tableFiles={tableFiles}` prop. Update their prop signatures accordingly.

- [ ] **Step 8.6: Wire TableView in the main render switch**

Find the section in `App` where the active tab type is checked to render the correct view component (the switch between `DiagramView`, `NoteView`, `TldrawView`, `CodeView`). Add:

```jsx
{active?.type === "table" && (
  <TableView
    key={active.name}
    name={active.name}
    T={T}
    onOpen={(name, type) => openTab({ name, type })}
  />
)}
```

- [ ] **Step 8.7: Build and verify TableView opens in a tab**

```bash
npm run build:viewer
```

Restart the preview server. Create a `.duckdb` file manually:

```bash
node -e "
import('./src/duck.js').then(async ({ runExec, closeAll }) => {
  const fp = '/tmp/test-jobs.duckdb';
  await runExec(fp, 'CREATE TABLE IF NOT EXISTS _ee_meta (key TEXT PRIMARY KEY, value TEXT)');
  await runExec(fp, \"INSERT OR REPLACE INTO _ee_meta VALUES ('created_by', 'table')\");
  await runExec(fp, 'CREATE TABLE jobs (id INTEGER, company TEXT, status TEXT)');
  await runExec(fp, \"INSERT INTO jobs VALUES (1, 'Acme', 'Applied')\");
  closeAll(); console.log('done');
});
" 2>/dev/null
# Then copy to your workspace root and open in the editor
```

Open the file in the embedded editor. Confirm the TableView renders with the toolbar, query pane toggle, and table data.

- [ ] **Step 8.8: Commit**

```bash
git add src/viewer/entry.jsx
git commit -m "feat: wire TableView into app tab routing and SSE refresh"
```

---

## Task 9: TableEmbed + parseNoteSegments extension

**Files:**
- Modify: `src/viewer/entry.jsx`
- Modify: `src/viewer/DuckDBView.jsx`

- [ ] **Step 9.1: Add TableEmbed component to DuckDBView.jsx**

Append to `src/viewer/DuckDBView.jsx`:

```jsx
// TableEmbed — rendered inline in notes for ![[name.duckdb]]
export function TableEmbed({ name, T, onOpen }) {
  const [view,    setView]    = useState(() => localStorage.getItem(`ee-embed-view-${name}`) ?? "table");
  const [result,  setResult]  = useState({ columns: [], rows: [], rowCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/table/${enc(name)}?limit=10`)
      .then(r => r.json())
      .then(res => { setResult(res); setLoading(false); })
      .catch(() => setLoading(false));
  }, [name]);

  function toggleView() {
    const next = view === "table" ? "chips" : "table";
    setView(next);
    localStorage.setItem(`ee-embed-view-${name}`, next);
  }

  const { columns, rows, rowCount } = result;

  return (
    <div style={{ margin: "12px 0", border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden", background: T.surface }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: `1px solid ${T.border}`, background: T.surface2 }}>
        <svg width="12" height="11" viewBox="0 0 24 22" fill="none" aria-hidden>
          <ellipse cx="13" cy="14" rx="9" ry="7" fill="#facc15"/>
          <circle cx="20" cy="7" r="4.5" fill="#facc15"/>
          <circle cx="21.5" cy="5.5" r="1" fill="#0d0d0d"/>
          <path d="M23.5 7.5 L26.5 8 L23.5 9Z" fill="#fb923c"/>
        </svg>
        <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.duck }}>{name}.duckdb</span>
        {!loading && <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted, marginLeft: 2 }}>· {rowCount} rows</span>}
        <span style={{ flex: 1 }} />
        <span onClick={toggleView} title="Toggle table/chips view" style={{
          fontSize: 10, color: T.muted, border: `1px solid ${T.border2}`, padding: "2px 7px",
          borderRadius: 4, cursor: "pointer", fontFamily: T.mono,
        }}>
          {view === "table" ? "⊞" : "≡"}
        </span>
        <span onClick={() => onOpen(name, "table")} style={{
          fontSize: 10, color: T.muted, border: `1px solid ${T.border2}`, padding: "2px 7px",
          borderRadius: 4, cursor: "pointer", fontFamily: T.mono, marginLeft: 3,
        }}>Open ↗</span>
      </div>

      {/* Body */}
      {loading && <div style={{ padding: "10px 12px", color: T.muted, fontFamily: T.mono, fontSize: 11 }}>Loading…</div>}
      {!loading && view === "table" && columns.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: T.mono }}>
            <thead>
              <tr>
                {columns.map(c => (
                  <th key={c} style={{ padding: "5px 10px", textAlign: "left", fontSize: 9, fontWeight: 500,
                    color: T.muted, letterSpacing: ".06em", textTransform: "uppercase",
                    borderBottom: `1px solid ${T.border}`, background: T.surface, whiteSpace: "nowrap" }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row, ri) => (
                <tr key={ri} style={{ borderBottom: `1px solid ${T.border}` }}>
                  {columns.map(c => (
                    <td key={c} style={{ padding: "5px 10px", color: T.textDim, whiteSpace: "nowrap" }}>
                      {String(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && view === "chips" && rows.length > 0 && (
        <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rows.map((row, ri) => {
            const vals = columns.slice(0, 2).map(c => String(row[c] ?? "")).join(" · ");
            const statusCol = columns.find(c => /status|state|stage/i.test(c));
            const dotColor  = statusCol ? statusColor(String(row[statusCol] ?? "")) : T.muted;
            return (
              <span key={ri} style={{
                background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 12,
                padding: "3px 10px", fontSize: 11, fontFamily: T.mono, color: T.textDim,
              }}>
                <span style={{ color: dotColor, fontSize: 8, marginRight: 4 }}>●</span>{vals}
              </span>
            );
          })}
        </div>
      )}
      {!loading && !columns.length && (
        <div style={{ padding: "10px 12px", color: T.muted, fontFamily: T.mono, fontSize: 11 }}>Empty table</div>
      )}
    </div>
  );
}

function statusColor(val) {
  const v = val.toLowerCase();
  if (/offer|accepted|done|complet/.test(v)) return "#60a5fa";
  if (/interview|progress|review/.test(v))   return "#4ade80";
  if (/applied|pending|wait/.test(v))        return "#facc15";
  if (/reject|declin|cancel/.test(v))        return "#f87171";
  return "#5a5a5a";
}
```

- [ ] **Step 9.2: Extend parseNoteSegments in entry.jsx**

Find the `parseNoteSegments` function (~line 272) which currently handles `.excalidraw` and `.tldraw` embeds. Add `.duckdb` support:

```js
// After existing tlRe definition:
const dbRe  = /!\[\[([^\]]+\.duckdb)\]\]/gi;
for (const m of raw.matchAll(dbRe)) {
  if (!inCode(m.index)) matches.push({
    index: m.index, len: m[0].length, type: "duckdb",
    name: m[1].replace(/\.duckdb$/i, "").trim()
  });
}
```

- [ ] **Step 9.3: Render TableEmbed in the note preview**

Find the note preview rendering section where `segment.type === "diagram"` and `segment.type === "tldraw"` embeds are rendered. Add:

```jsx
{seg.type === "duckdb" && (
  <TableEmbed
    key={seg.name}
    name={seg.name}
    T={N}
    onOpen={(name, type) => onNavigate(name, type)}
  />
)}
```

- [ ] **Step 9.4: Build and verify the embed renders in a note**

```bash
npm run build:viewer
```

In the embedded editor, create a note containing `![[test-jobs.duckdb]]` and confirm the embed renders with the header, table preview, and toggle button.

- [ ] **Step 9.5: Commit**

```bash
git add src/viewer/DuckDBView.jsx src/viewer/entry.jsx
git commit -m "feat: add TableEmbed component + parseNoteSegments duckdb support"
```

---

## Task 10: /table and /query slash commands

**Files:**
- Modify: `src/viewer/entry.jsx`

- [ ] **Step 10.1: Add /table and /query to ALL_CMDS in makeSlashSource**

Find `const ALL_CMDS = ["diagram", "canvas", "note", "link"]` (~line 1304). Change to:

```js
const ALL_CMDS = ["diagram", "canvas", "note", "table", "query", "link"];
const CMD_DETAIL = {
  diagram: "embed Excalidraw diagram",
  canvas:  "embed tldraw canvas",
  note:    "create & link a note",
  table:   "create DuckDB table",
  query:   "create DuckDB query view",
  link:    "link to existing file",
};
```

- [ ] **Step 10.2: Add table and query cases to the apply() function**

In the `apply()` function inside `makeSlashSource` (~line 1379), after the `} else if (cmd === "note")` block, add:

```js
} else if (cmd === "table") {
  await api.newTable(name, "table");
  insert = `![[${name}.duckdb]]`;
  if (desc) claudePrompt = `${desc}\n\nTable file: [[${name}.duckdb]] (already created). Use create_table to define the schema (provide the table name and a CREATE TABLE SQL statement), then write_rows to populate it.`;
} else if (cmd === "query") {
  await api.newTable(name, "query");
  insert = `![[${name}.duckdb]]`;
  if (desc) claudePrompt = `${desc}\n\nQuery file: [[${name}.duckdb]] (already created). Use query_table to scan files relative to this table's directory (supports read_csv('./glob'), read_json('./glob'), and read_frontmatter('./glob') for YAML frontmatter from .md files) and save results as rows.`;
}
```

Also rename the auto-generated name prefix to match:

```js
const id   = Date.now().toString(36);
const name = cmd === "table" ? `table-${id}`
           : cmd === "query" ? `query-${id}`
           : `${cmd}-${id}`;
```

- [ ] **Step 10.3: Add table and query to /link search**

In the `/link` handler (~line 1342), add table files to the options:

```js
const [diagrams, notes, tldraws, tables] = await Promise.all([
  api.diagrams().catch(() => []),
  api.notes().catch(() => []),
  api.tldrawList().catch(() => []),
  api.tables().catch(() => []),
]);
const allOpts = [
  ...diagrams.map(n => ({ label: n, detail: "⬡ diagram", ftype: "diagram" })),
  ...notes.map(n =>    ({ label: n, detail: "¶ note",    ftype: "note"    })),
  ...tldraws.map(n =>  ({ label: n, detail: "◈ canvas",  ftype: "tldraw"  })),
  ...tables.map(n =>   ({ label: n, detail: "⬡ table",   ftype: "duckdb"  })),
];
```

And in the `apply` for link:

```js
const insert = o.ftype === "diagram" ? `![[${o.label}.excalidraw]]`
             : o.ftype === "tldraw"  ? `![[${o.label}.tldraw]]`
             : o.ftype === "duckdb"  ? `![[${o.label}.duckdb]]`
             : `[[${o.label}]]`;
```

- [ ] **Step 10.4: Build and manually test the slash commands**

```bash
npm run build:viewer
```

Restart preview, open a note, type `/table ` and verify the autocomplete appears with "create DuckDB table" detail. Type a description, press Enter, and confirm the embed is inserted and a `slash-prompt` fires with the correct Claude instructions.

Repeat for `/query`.

- [ ] **Step 10.5: Commit**

```bash
git add src/viewer/entry.jsx
git commit -m "feat: add /table and /query slash commands with MCP prompt handoff"
```

---

## Task 11: Lock/live toggle and frontmatter sync

**Files:**
- Modify: `src/viewer/DuckDBView.jsx`

- [ ] **Step 11.1: Add live re-run on SSE in TableView**

The TableView already reads `isQuery` and `liveSync` state. Add a SSE listener for `note:changed` events when `isQuery && liveSync` is true. In `TableView`, add a `useEffect`:

```js
useEffect(() => {
  if (!isQuery || !liveSync) return;
  const handler = () => {
    if (sqlText) fetchCustom(sqlText);
  };
  // Listen to the custom event the App broadcasts internally, or use SSE directly
  const es = new EventSource("/events");
  es.addEventListener("note:changed", handler);
  es.addEventListener("table:changed", handler);
  return () => es.close();
}, [isQuery, liveSync, sqlText]);
```

- [ ] **Step 11.2: Verify lock/live toggle persists**

Open a query-type table (created with `created_by: 'query'`). Confirm the lock/live toggle appears in the toolbar. Click it to switch modes and reload the page — confirm the toggle state persists via `localStorage`.

- [ ] **Step 11.3: Test read_frontmatter via query_table MCP tool**

Create a workspace with a couple of `.md` files with frontmatter:

```bash
mkdir -p /tmp/fm-test
cat > /tmp/fm-test/note1.md << 'EOF'
---
title: Note One
status: active
priority: high
---
Body text
EOF
cat > /tmp/fm-test/note2.md << 'EOF'
---
title: Note Two
status: done
priority: low
---
Body text
EOF
```

Then test via the MCP smoke path:

```bash
EXCALIDRAW_ROOT=/tmp/fm-test node -e "
import('./src/duck.js').then(async ({ readFrontmatter, closeAll }) => {
  const rows = await readFrontmatter('./*.md', '/tmp/fm-test');
  console.assert(rows.length === 2, 'expected 2 rows');
  console.assert(rows[0].status === 'active' || rows[1].status === 'active', 'expected active');
  console.log('readFrontmatter OK');
  closeAll();
});
"
```

Expected: `readFrontmatter OK`

- [ ] **Step 11.4: Commit**

```bash
git add src/viewer/DuckDBView.jsx
git commit -m "feat: lock/live toggle re-runs query on SSE note:changed events"
```

---

## Task 12: Build, version cleanup, and final verification

**Files:**
- Modify: `package.json`

- [ ] **Step 12.1: Revert the -dev version suffix**

```bash
node -e "const fs=require('fs'),p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=p.version.replace(/-dev\d*$/,'');fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');console.log('version:', p.version)"
```

- [ ] **Step 12.2: Full production build**

```bash
npm run build
```

Expected: both `vendor/excalidraw.mjs` and `vendor/viewer.js` build without errors.

- [ ] **Step 12.3: Run full smoke test**

```bash
node scripts/smoke-stdio.mjs
```

Expected: all assertions pass, exits 0.

- [ ] **Step 12.4: Manual end-to-end verification**

Start the preview server. Verify each of the following:

1. Duck icon appears in brand mark top bar
2. `/table my job search` in a note creates embed + fires Claude prompt
3. `/query scan my notes` in a note creates embed + fires Claude prompt
4. Opening a `.duckdb` tab shows the TableView with toolbar
5. `⌘ Query` toggles the SQL pane open/closed
6. `≡ Table` / `⊞ Cards` switches views without closing the query pane
7. Editing a cell in table view and clicking away saves the row (check via re-open)
8. `![[name.duckdb]]` in a note renders the TableEmbed with A/B toggle
9. Lock/live toggle appears only for `created_by: 'query'` tables
10. `↓ Export` downloads a CSV

- [ ] **Step 12.5: Final commit**

```bash
git add package.json package-lock.json
git commit -m "chore: revert -dev version suffix after DuckDB feature build"
```

---

## Summary

| Task | What ships |
|------|-----------|
| 1 | `duckdb` dep + `src/duck.js` connection pool |
| 2 | `workspace.js` wikilink support for `.duckdb` |
| 3 | HTTP API routes in `viewer-server.js` |
| 4 | Six MCP tools in `server.js` |
| 5 | Smoke test coverage for MCP tools |
| 6 | Duck icon + theme tokens in SPA |
| 7 | `TableView` component (query pane, table/cards, inline editing) |
| 8 | Tab routing wired up in `entry.jsx` |
| 9 | `TableEmbed` + `![[name.duckdb]]` note embeds |
| 10 | `/table` and `/query` slash commands |
| 11 | Lock/live toggle + `readFrontmatter` helper |
| 12 | Build, smoke test, cleanup |
