// DuckDB connection pool shared by server.js (MCP) and viewer-server.js (HTTP).
import duckdb from "duckdb";
import path   from "path";
import { glob } from "glob";
import { ROOT } from "./workspace.js";

// pool: Map<filePath, { db: duckdb.Database|null, timer: NodeJS.Timeout|null, promise: Promise|null }>
const pool = new Map();
const IDLE_MS = 60_000;

function resetTimer(filePath) {
  const entry = pool.get(filePath);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    if (entry.db) entry.db.close(() => {});
    pool.delete(filePath);
  }, IDLE_MS);
}

export function getDb(filePath) {
  if (pool.has(filePath)) {
    const entry = pool.get(filePath);
    // entry.promise is set while opening; entry.db is set once open
    resetTimer(filePath);
    return entry.promise || Promise.resolve(entry.db);
  }
  // Placeholder so concurrent callers coalesce onto this open attempt
  const entry = { db: null, timer: null, promise: null };
  pool.set(filePath, entry);

  entry.promise = new Promise((resolve, reject) => {
    const db = new duckdb.Database(filePath, (err) => {
      if (err) {
        pool.delete(filePath);
        return reject(err);
      }
      if (!pool.has(filePath)) {
        // closeAll() was called while we were opening; close this orphan
        db.close(() => {});
        return reject(new Error('DuckDB pool cleared during open'));
      }
      entry.db = db;
      entry.promise = null; // clear the in-flight promise
      resetTimer(filePath);
      resolve(db);
    });
  });

  return entry.promise;
}

export function closeAll() {
  for (const { db, timer } of pool.values()) {
    clearTimeout(timer);
    try { if (db) db.close(() => {}); } catch {}
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
  return sql.replace(/(['"])(\.[./][^'"]+)(['"])/g, (_, q1, rel, q2) => {
    const abs = path.resolve(base, rel);
    const rel2 = path.relative(ROOT, abs);
    if (rel2.startsWith('..') || path.isAbsolute(rel2)) {
      throw new Error(`Path escapes workspace: ${rel}`);
    }
    return q1 + abs + q2;
  });
}

// Parse YAML frontmatter from .md files matching a glob pattern.
// Returns an array of objects (one per file) with all frontmatter keys + _file.
export async function readFrontmatter(globPattern, baseDir) {
  const files = await glob(globPattern, { cwd: baseDir, absolute: true });
  const { readFile } = await import("fs/promises");
  const entries = await Promise.all(
    files.map(async (f) => {
      try {
        const text = await readFile(f, "utf8");
        const fm = parseFrontmatter(text);
        if (fm) return { _file: path.relative(baseDir, f), ...fm };
      } catch (err) {
        process.stderr.write(`readFrontmatter: skipping ${f}: ${err.message}\n`);
      }
      return null;
    })
  );
  return entries.filter(Boolean);
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
