// Local HTTP server for the Claude Code preview pane.
//
//   GET  /                           SPA shell
//   GET  /events                     SSE stream (live sync)
//   GET  /api/diagrams               list .excalidraw names
//   GET  /api/notes                  list .md names
//   GET  /api/recent                 recent files [{name,type,at}]
//   GET  /api/diagram/:name          diagram JSON
//   PUT  /api/diagram/:name          save diagram
//   POST /api/diagram/:name          create diagram
//   DEL  /api/diagram/:name          delete
//   GET  /api/note/:name             raw markdown text
//   PUT  /api/note/:name             save note
//   POST /api/note/:name             create note
//   DEL  /api/note/:name             delete note
//   GET  /api/svg/:name              rendered SVG
//   GET  /api/png/:name              rendered PNG
//   GET  /api/history/:name          snapshot list
//   POST /api/restore/:name/:ts      restore snapshot
//   GET  /api/backlinks/:name        who links here
//   POST /api/rename                 rename + rewrite all links
//   POST /api/asset                   upload image into assets/ folder
//   GET  /vendor/*                   static assets

import http  from "http";
import path  from "path";
import fs    from "fs/promises";
import { writeFileSync, readFileSync } from "fs";
import { watch }         from "fs";
import { glob }          from "glob";
import { fileURLToPath } from "url";
import { renderToSvg, renderToPng } from "./render.js";
import { DEFAULT_PORT } from "./paths.js";
import { ROOT, validateName, rewriteLinks, findBacklinks, listSnapshots } from "./workspace.js";

const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

const CWD        = ROOT;
const VENDOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor");
const RECENT_F   = path.join(CWD, ".excalidraw-recent.json");
const HIST_DIR   = path.join(CWD, ".excalidraw-history");

// Render cache — keyed by diagram name, invalidated on write
const svgCache = new Map(); // name → { mtime, svg }
const pngCache = new Map(); // name → { mtime, buf }  ← stores Buffer, not base64

// LRU cap: evict oldest-inserted entries when a cache grows beyond `max`.
// Map iteration order is insertion order, so keys() gives us the oldest first.
function trimCache(cache, max = 200) {
  if (cache.size <= max) return;
  const excess = cache.size - max;
  let i = 0;
  for (const k of cache.keys()) {
    if (i++ >= excess) break;
    cache.delete(k);
  }
}

// Per-diagram render lock — avoids serialising unrelated diagrams.
// A global lock was the previous approach; this Map keeps one Promise chain
// per diagram name so concurrent renders of different diagrams run in parallel.
const renderLocks = new Map(); // name → Promise
function queueRender(name, fn) {
  const prev = renderLocks.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn); // fn is its own error handler so the chain never breaks
  renderLocks.set(name, next);
  // Tidy up so the Map doesn't grow unboundedly for one-off diagrams
  next.finally(() => { if (renderLocks.get(name) === next) renderLocks.delete(name); });
  return next;
}

// ── SSE ───────────────────────────────────────────────────────────────────────

const clients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch {} }
}

// Watch CWD for file changes
const debounces = new Map();
try {
  watch(CWD, { recursive: true }, (_, filename) => {
    if (!filename) return;
    let event;
    if      (filename.endsWith(".excalidraw")) event = "diagram:changed";
    else if (filename.endsWith(".tldraw"))     event = "tldraw:changed";
    else if (filename.endsWith(".md"))         event = "note:changed";
    else if (isCodeFile(filename))             event = "code:changed";
    else return;
    const name = filename.endsWith(".excalidraw") ? filename.replace(/\.excalidraw$/, "")
               : filename.endsWith(".tldraw")     ? filename.replace(/\.tldraw$/, "")
               : filename.endsWith(".md")         ? filename.replace(/\.md$/, "")
               : filename;
    clearTimeout(debounces.get(filename));
    debounces.set(filename, setTimeout(() => {
      debounces.delete(filename); // #006 fix: avoid unbounded Map growth
      broadcast(event, { name });
    }, 120));
  });
} catch (e) {
  process.stderr.write(`[embedded-editor] file watcher failed to start: ${e.message}\n`);
}

// ── Recent files (in-memory, debounced write-behind) ─────────────────────────
// #013: avoid a readFile+writeFile per request; keep the list in memory and
// flush to disk at most once every 2 s (and on process exit).

let recentList = null;          // null = not yet hydrated from disk
let recentFlushTimer = null;

async function hydrateRecent() {
  if (recentList !== null) return;
  try { recentList = JSON.parse(await fs.readFile(RECENT_F, "utf8")); }
  catch { recentList = []; }
}

async function loadRecent() {
  await hydrateRecent();
  return recentList;
}

function touchRecent(name, type) {
  if (recentList === null) {
    // Not yet loaded — hydrate then retry
    hydrateRecent().then(() => touchRecent(name, type)).catch(() => {});
    return;
  }
  recentList = [
    { name, type, at: Date.now() },
    ...recentList.filter(x => !(x.name === name && x.type === type)),
  ].slice(0, 30);
  clearTimeout(recentFlushTimer);
  recentFlushTimer = setTimeout(() => {
    fs.writeFile(RECENT_F, JSON.stringify(recentList, null, 2), "utf8").catch(() => {});
  }, 2000);
}

// Synchronous flush on exit so recent list isn't lost on Ctrl-C
process.on("exit", () => {
  if (recentList !== null) {
    clearTimeout(recentFlushTimer);
    try { writeFileSync(RECENT_F, JSON.stringify(recentList, null, 2), "utf8"); } catch {}
  }
});

// ── Snapshots (count cache — avoids readdir per save) ────────────────────────
// #013: hydrate snapshot count lazily, then maintain in memory.

const snapshotCounts = new Map(); // name → number

async function saveSnapshot(name, data) {
  const dir = path.join(HIST_DIR, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${Date.now()}.json`),
    JSON.stringify(data, null, 2), "utf8"
  );
  let count = snapshotCounts.get(name);
  if (count === undefined) {
    // First save for this name in this session — hydrate from disk
    const files = (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith(".json"));
    count = files.length;
    // Prune if necessary (handles pre-existing over-limit directories)
    if (count > 30) {
      const sorted = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
      for (const old of sorted.slice(0, count - 30)) {
        await fs.unlink(path.join(dir, old)).catch(() => {});
      }
      count = 30;
    }
  } else {
    count++;
    if (count > 30) {
      // Prune oldest: readdir only when we know we're over limit
      const all = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
      for (const old of all.slice(0, count - 30)) {
        await fs.unlink(path.join(dir, old)).catch(() => {});
      }
      count = 30;
    }
  }
  snapshotCounts.set(name, count);
}

// ── Code file support ─────────────────────────────────────────────────────────

const CODE_EXTS = new Set([
  "js","mjs","cjs","jsx","ts","tsx","py","go","rs","java","c","cpp","cc","cxx","h","hpp",
  "cs","php","swift","kt","kts","scala","css","scss","sass","less","html","htm","xml","xhtml",
  "sh","bash","zsh","fish","ps1","bat","cmd","yaml","yml","toml","ini","conf","sql","txt",
  "log","csv","tsv","graphql","gql","proto","tf","hcl","json","jsonc","json5",
]);

function isCodeFile(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? CODE_EXTS.has(ext) : false;
}

function safeCodeName(raw) {
  try {
    const decoded = decodeURIComponent(String(raw || ""));
    // Allow dotfiles: relax leading char to [\w\-.]
    const s = decoded.replace(/\\/g, "/");
    if (!s) return null;
    if (path.isAbsolute(s)) return null;
    const segs = s.split("/").filter(Boolean);
    for (const seg of segs) {
      if (seg === ".." || seg === ".") return null;
      if (!/^[\w\-.][\w.\- ]*$/.test(seg)) return null;
    }
    return segs.join("/");
  } catch { return null; }
}

async function isBinary(fp) {
  try {
    const buf = Buffer.alloc(512);
    const fh = await fs.open(fp, "r");
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    await fh.close();
    for (let i = 0; i < bytesRead; i++) if (buf[i] === 0) return true;
    return false;
  } catch { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// #008: safeName now uses validateName from workspace.js (same strict rules as
// MCP's sanitizeName) so security fixes propagate to both code paths.
// Returns null on failure (caller must check) rather than throwing.
function safeName(raw) {
  try {
    // Decode percent-encoding first (URL pathname is already decoded by new URL,
    // but the name segment may carry extra encoding from the client).
    const decoded = decodeURIComponent(String(raw || ""));
    // Strip all three supported extensions
    const stripped = decoded.replace(/\.(excalidraw|tldraw|md)$/i, "");
    return validateName(stripped);
  } catch {
    return null;
  }
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const MAX = 5 * 1024 * 1024; // #013: 5 MB (was 50 MB). Note: tldraw snapshots embed images as dataURLs,
    // so large dragged-in images can push tldraw saves close to or over this limit.
    req.on("data", c => {
      total += c.length;
      if (total > MAX) { req.destroy(); return reject(new Error("request body too large")); }
      chunks.push(c);
    });
    req.on("end", () => {
      const s = Buffer.concat(chunks).toString("utf8");
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/json")) {
        try { resolve(s ? JSON.parse(s) : undefined); } catch (e) { reject(e); }
      } else {
        resolve(s);
      }
    });
    req.on("error", reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// #007: security headers applied to all non-SSE, non-vendor responses
function secHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; " +
    "font-src 'self' data:; connect-src 'self'; worker-src blob: 'self';"
  );
}

function appHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Embedded Editor</title>
  <link rel="stylesheet" href="/vendor/viewer.css?v=${PACKAGE_VERSION}">
  <style>*{box-sizing:border-box}html,body,#root{margin:0;padding:0;height:100%;overflow:hidden;background:#0d0d0d}</style>
</head>
<body><div id="root"></div><script type="module" src="/vendor/viewer.js?v=${PACKAGE_VERSION}"></script></body>
</html>`;
}

// ── Server ────────────────────────────────────────────────────────────────────

export async function startViewerServer(port = DEFAULT_PORT) {
  // Vendor asset map — populated by the background preload below.
  const vendorFiles = new Map(); // basename → { buf, ct, gz?, br? }
  const MIME = (ext) =>
    ext === ".js"    ? "application/javascript; charset=utf-8"
    : ext === ".css"   ? "text/css; charset=utf-8"
    : ext === ".woff2" ? "font/woff2"
    : ext === ".woff"  ? "font/woff"
    : "application/octet-stream";

  // Kick off vendor preload in the background — do NOT await here so the HTTP
  // server can start listening immediately (~49 MB of files was the bottleneck).
  // The vendor request handler awaits this promise on first hit.
  const vendorReady = (async () => {
    try {
      const entries = await fs.readdir(VENDOR_DIR);
      // First pass: index which compressed variants exist
      const gzSet = new Set(entries.filter(f => f.endsWith(".gz")).map(f => f.slice(0, -3)));
      const brSet = new Set(entries.filter(f => f.endsWith(".br")).map(f => f.slice(0, -3)));
      // Second pass: load uncompressed files (and compressed variants if present)
      await Promise.all(
        entries
          .filter(f => !f.endsWith(".gz") && !f.endsWith(".br"))
          .map(async f => {
            try {
              const ext = path.extname(f);
              const [buf, gz, br] = await Promise.all([
                fs.readFile(path.join(VENDOR_DIR, f)),
                gzSet.has(f) ? fs.readFile(path.join(VENDOR_DIR, f + ".gz")) : Promise.resolve(null),
                brSet.has(f) ? fs.readFile(path.join(VENDOR_DIR, f + ".br")) : Promise.resolve(null),
              ]);
              vendorFiles.set(f, { buf, ct: MIME(ext), gz, br });
            } catch {}
          })
      );
    } catch (e) {
      process.stderr.write(`[embedded-editor] vendor preload failed: ${e.message}\n`);
    }
  })();

  const server = http.createServer(async (req, res) => {
    // #013: per-request timeout — prevents slow bodies from stalling the server
    req.setTimeout(30_000, () => {
      if (!res.headersSent) { res.writeHead(408, { "Content-Type": "text/plain" }); res.end("timeout"); }
      req.destroy();
    });

    const url      = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;
    const method   = req.method;

    // #001: CSRF protection — require Origin on all mutating requests.
    // Absent Origin header (curl, DNS-rebind) is now treated as forbidden,
    // not as a pass-through. GET/HEAD are always allowed (read-only).
    if (method === "PUT" || method === "POST" || method === "DELETE") {
      const origin  = req.headers["origin"];
      const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
      if (!origin || !allowed.includes(origin)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end("Forbidden");
      }
    }

    try {

      // Health
      if (pathname === "/health") {
        secHeaders(res);
        return json(res, { ok: true, cwd: CWD });
      }

      // #007: SSE — restrict ACAO to same origin only (was wildcard *)
      if (pathname === "/events") {
        const reqOrigin = req.headers["origin"] || `http://127.0.0.1:${port}`;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": reqOrigin,
          "Vary": "Origin",
        });
        res.write(": connected\n\n");
        clients.add(res);
        const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 20000);
        req.on("close", () => { clients.delete(res); clearInterval(hb); });
        return;
      }

      // Vendor static (long-cache, no secHeaders — immutable assets)
      // Served from the pre-loaded in-memory Map; supports Content-Encoding for
      // .gz/.br variants produced by the build script.
      if (pathname.startsWith("/vendor/")) {
        // Wait for background preload to finish (instant on subsequent requests
        // once the Map is populated; only the very first request(s) may wait).
        await vendorReady;
        const basename = pathname.slice("/vendor/".length);
        // Guard: no path traversal
        if (basename.includes("..") || basename.includes("/")) {
          // Allow one level of sub-path for asset files (fonts etc.) but reject traversal
          const resolved = path.resolve(VENDOR_DIR, basename);
          if (!resolved.startsWith(VENDOR_DIR + path.sep)) { res.writeHead(403); return res.end(); }
        }
        const entry = vendorFiles.get(basename);
        if (!entry) { res.writeHead(404); return res.end(); }
        const accept = req.headers["accept-encoding"] || "";
        const hdrs = { "Content-Type": entry.ct, "Cache-Control": "public, max-age=31536000, immutable" };
        if (entry.br && accept.includes("br")) {
          res.writeHead(200, { ...hdrs, "Content-Encoding": "br", "Vary": "Accept-Encoding" });
          return res.end(entry.br);
        }
        if (entry.gz && accept.includes("gzip")) {
          res.writeHead(200, { ...hdrs, "Content-Encoding": "gzip", "Vary": "Accept-Encoding" });
          return res.end(entry.gz);
        }
        res.writeHead(200, hdrs);
        return res.end(entry.buf);
      }

      // Apply security headers to all remaining routes
      secHeaders(res);

      // ── Diagrams list
      if (pathname === "/api/diagrams") {
        const files = await glob("**/*.excalidraw", { cwd: CWD, ignore: ["node_modules/**", ".excalidraw-history/**"] });
        return json(res, files.map(f => f.replace(/\.excalidraw$/, "")).sort());
      }

      // ── Notes list
      if (pathname === "/api/notes") {
        const files = await glob("**/*.md", { cwd: CWD, ignore: ["node_modules/**"] });
        return json(res, files.map(f => f.replace(/\.md$/, "")).sort());
      }

      // ── tldraw list
      if (pathname === "/api/tldraw") {
        const files = await glob("**/*.tldraw", { cwd: CWD, ignore: ["node_modules/**", ".excalidraw-history/**"] });
        return json(res, files.map(f => f.replace(/\.tldraw$/, "")).sort());
      }

      // ── Recent
      if (pathname === "/api/recent") return json(res, await loadRecent());

      // ── Diagram CRUD
      const dm = pathname.match(/^\/api\/diagram\/(.+)$/);
      if (dm) {
        const name = safeName(dm[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        const fp = path.join(CWD, `${name}.excalidraw`);

        if (method === "GET") {
          try {
            const raw = await fs.readFile(fp, "utf8");
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
            res.end(raw);
            touchRecent(name, "diagram");
          } catch { json(res, { error: "not found" }, 404); }
          return;
        }
        if (method === "PUT" || method === "POST") {
          const body = await readBody(req);
          if (!body || !Array.isArray(body.elements)) return json(res, { error: "expected {elements:[]}" }, 400);
          await fs.mkdir(path.dirname(fp), { recursive: true });
          await fs.writeFile(fp, JSON.stringify(body, null, 2), "utf8");
          svgCache.delete(name);
          pngCache.delete(name);
          touchRecent(name, "diagram");
          saveSnapshot(name, body).catch(() => {});
          broadcast("diagram:changed", { name, op: method === "POST" ? "created" : "updated" });
          return json(res, { ok: true });
        }
        if (method === "DELETE") {
          try { await fs.unlink(fp); broadcast("diagram:deleted", { name, op: "deleted" }); return json(res, { ok: true }); }
          catch { return json(res, { error: "not found" }, 404); }
        }
        res.writeHead(405); return res.end();
      }

      // ── tldraw CRUD
      const tlm = pathname.match(/^\/api\/tldraw\/(.+)$/);
      if (tlm) {
        const name = safeName(tlm[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        const fp = path.join(CWD, `${name}.tldraw`);

        if (method === "GET") {
          try {
            const raw = await fs.readFile(fp, "utf8");
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
            res.end(raw);
            touchRecent(name, "tldraw");
          } catch {
            // #p3: return 404 for missing tldraw file; client treats 404 as fresh canvas
            return json(res, { error: "not found" }, 404);
          }
          return;
        }
        if (method === "PUT" || method === "POST") {
          const body = await readBody(req);
          // #security: validate tldraw body is at least a plain object
          if (body !== null && typeof body !== "object") return json(res, { error: "expected JSON object" }, 400);
          await fs.mkdir(path.dirname(fp), { recursive: true });
          await fs.writeFile(fp, JSON.stringify(body ?? {}, null, 2), "utf8");
          touchRecent(name, "tldraw");
          broadcast("tldraw:changed", { name, op: method === "POST" ? "created" : "updated" });
          return json(res, { ok: true });
        }
        if (method === "DELETE") {
          try { await fs.unlink(fp); broadcast("tldraw:deleted", { name, op: "deleted" }); return json(res, { ok: true }); }
          catch { return json(res, { error: "not found" }, 404); }
        }
        res.writeHead(405); return res.end();
      }

      // ── Note CRUD
      const nm = pathname.match(/^\/api\/note\/(.+)$/);
      if (nm) {
        const name = safeName(nm[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        const fp = path.join(CWD, `${name}.md`);

        if (method === "GET") {
          try {
            const text = await fs.readFile(fp, "utf8");
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
            res.end(text);
            touchRecent(name, "note");
          } catch { res.writeHead(404); res.end("not found"); }
          return;
        }
        if (method === "PUT" || method === "POST") {
          const body = await readBody(req);
          await fs.mkdir(path.dirname(fp), { recursive: true });
          await fs.writeFile(fp, typeof body === "string" ? body : `# ${name}\n\n`, "utf8");
          touchRecent(name, "note");
          broadcast("note:changed", { name, op: method === "POST" ? "created" : "updated" });
          return json(res, { ok: true });
        }
        if (method === "DELETE") {
          try { await fs.unlink(fp); broadcast("note:deleted", { name, op: "deleted" }); return json(res, { ok: true }); }
          catch { return json(res, { error: "not found" }, 404); }
        }
        res.writeHead(405); return res.end();
      }

      // ── SVG render
      const sm = pathname.match(/^\/api\/svg\/(.+)$/);
      if (sm) {
        const name = safeName(sm[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        try {
          const fp = path.join(CWD, `${name}.excalidraw`);
          const stat = await fs.stat(fp);
          const etag = `"${stat.mtimeMs.toString(36)}-svg"`;
          if (req.headers["if-none-match"] === etag) { res.writeHead(304); return res.end(); }
          const cached = svgCache.get(name);
          const headers = { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=5", "ETag": etag, "Last-Modified": new Date(stat.mtimeMs).toUTCString() };
          if (cached && cached.mtime === stat.mtimeMs) {
            res.writeHead(200, headers);
            return res.end(cached.svg);
          }
          const diagram = JSON.parse(await fs.readFile(fp, "utf8"));
          const svg = await queueRender(name, () => renderToSvg(diagram));
          svgCache.set(name, { mtime: stat.mtimeMs, svg });
          trimCache(svgCache);
          res.writeHead(200, headers);
          res.end(svg);
        } catch { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); }
        return;
      }

      // ── PNG render
      const pm = pathname.match(/^\/api\/png\/(.+)$/);
      if (pm) {
        const name = safeName(pm[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        try {
          const fp = path.join(CWD, `${name}.excalidraw`);
          const stat = await fs.stat(fp);
          const etag = `"${stat.mtimeMs.toString(36)}-png"`;
          if (req.headers["if-none-match"] === etag) { res.writeHead(304); return res.end(); }
          const cached = pngCache.get(name);
          const headers = { "Content-Type": "image/png", "Cache-Control": "max-age=5", "ETag": etag, "Last-Modified": new Date(stat.mtimeMs).toUTCString() };
          if (cached && cached.mtime === stat.mtimeMs) {
            res.writeHead(200, headers);
            return res.end(cached.buf); // ← Buffer, no base64 decode on every hit
          }
          const diagram = JSON.parse(await fs.readFile(fp, "utf8"));
          const buf = await queueRender(name, () => renderToPng(diagram));
          pngCache.set(name, { mtime: stat.mtimeMs, buf });
          trimCache(pngCache);
          res.writeHead(200, headers);
          res.end(buf);
        } catch { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found"); }
        return;
      }

      // ── Snapshot list
      const hm = pathname.match(/^\/api\/history\/(.+)$/);
      if (hm) {
        const name = safeName(hm[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        return json(res, await listSnapshots(name));
      }

      // ── Restore snapshot
      const restM = pathname.match(/^\/api\/restore\/(.+?)\/(\d+)$/);
      if (restM) {
        const name = safeName(restM[1]), ts = restM[2];
        if (!name) return json(res, { error: "invalid name" }, 400);
        try {
          const valid = await listSnapshots(name);
          if (!valid.some(s => String(s.ts) === ts)) return json(res, { error: "snapshot not found" }, 404);
          const snap = JSON.parse(await fs.readFile(path.join(HIST_DIR, name, `${ts}.json`), "utf8"));
          await fs.writeFile(path.join(CWD, `${name}.excalidraw`), JSON.stringify(snap, null, 2), "utf8");
          svgCache.delete(name); pngCache.delete(name);
          broadcast("diagram:changed", { name });
          return json(res, { ok: true });
        } catch { return json(res, { error: "snapshot not found" }, 404); }
      }

      // ── Resolve name → type (case-insensitive filesystem check)
      // #006: run the three fallback globs in parallel (was sequential)
      const resolveM = pathname.match(/^\/api\/resolve\/(.+)$/);
      if (resolveM) {
        const name = safeName(resolveM[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        // Exact match first (fast — three fs.access calls in parallel)
        const [mdEx, exEx, tlEx] = await Promise.all([
          fs.access(path.join(CWD, `${name}.md`)).then(() => true).catch(() => false),
          fs.access(path.join(CWD, `${name}.excalidraw`)).then(() => true).catch(() => false),
          fs.access(path.join(CWD, `${name}.tldraw`)).then(() => true).catch(() => false),
        ]);
        if (mdEx) return json(res, { type: "note",    name });
        if (exEx) return json(res, { type: "diagram", name });
        if (tlEx) return json(res, { type: "tldraw",  name });
        // Case-insensitive fallback — run all three globs in parallel
        const lo = name.toLowerCase();
        const [allMd, allEx, allTl] = await Promise.all([
          glob("**/*.md",         { cwd: CWD, ignore: ["node_modules/**"] }),
          glob("**/*.excalidraw", { cwd: CWD, ignore: ["node_modules/**", ".excalidraw-history/**"] }),
          glob("**/*.tldraw",     { cwd: CWD, ignore: ["node_modules/**"] }),
        ]);
        const mdHit = allMd.find(f => f.replace(/\.md$/, "").toLowerCase() === lo);
        if (mdHit) return json(res, { type: "note",    name: mdHit.replace(/\.md$/, "") });
        const exHit = allEx.find(f => f.replace(/\.excalidraw$/, "").toLowerCase() === lo);
        if (exHit) return json(res, { type: "diagram", name: exHit.replace(/\.excalidraw$/, "") });
        const tlHit = allTl.find(f => f.replace(/\.tldraw$/, "").toLowerCase() === lo);
        if (tlHit) return json(res, { type: "tldraw",  name: tlHit.replace(/\.tldraw$/, "") });
        return json(res, { type: null, name });
      }

      // ── Backlinks
      const bm = pathname.match(/^\/api\/backlinks\/(.+)$/);
      if (bm) {
        const name = safeName(bm[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        return json(res, await findBacklinks(name));
      }

      // ── Rename + link rewrite
      if (pathname === "/api/rename" && method === "POST") {
        const { from, to, type } = await readBody(req);
        if (!from || !to || from === to) return json(res, { error: "invalid params" }, 400);
        const safFrom = safeName(from);
        const safTo   = safeName(to);
        if (!safFrom || !safTo) return json(res, { error: "invalid name" }, 400);
        const ext   = type === "note" ? ".md" : type === "tldraw" ? ".tldraw" : ".excalidraw";
        const oldFp = path.join(CWD, `${safFrom}${ext}`);
        const newFp = path.join(CWD, `${safTo}${ext}`);
        const rel1 = path.relative(CWD, oldFp);
        const rel2 = path.relative(CWD, newFp);
        if (rel1.startsWith("..") || path.isAbsolute(rel1) || rel2.startsWith("..") || path.isAbsolute(rel2)) {
          return json(res, { error: "path escape" }, 400);
        }
        try {
          await fs.rename(oldFp, newFp);
          const updated = await rewriteLinks(from, to);
          // Update in-memory recent list entries
          if (recentList) {
            recentList = recentList.map(r =>
              r.name === from && r.type === type ? { ...r, name: to } : r
            );
          }
          const evType = type === "note" ? "note:changed" : type === "tldraw" ? "tldraw:changed" : "diagram:changed";
          broadcast(evType, { name: to, op: "renamed", from: safFrom });
          return json(res, { ok: true, updated });
        } catch (e) { return json(res, { error: e.message }, 500); }
      }

      // ── Asset upload
      if (pathname === "/api/asset" && method === "POST") {
        let body;
        try { body = await readBody(req); } catch { return json(res, { error: "bad request" }, 400); }
        const { name, data } = body ?? {};
        if (!name || !data) return json(res, { error: "missing name or data" }, 400);
        let safeAssetName;
        try { safeAssetName = validateName(name); } catch { return json(res, { error: "invalid filename" }, 400); }
        const assetsDir = path.join(CWD, "assets");
        await fs.mkdir(assetsDir, { recursive: true });
        await fs.writeFile(path.join(assetsDir, safeAssetName), Buffer.from(data, "base64"));
        return json(res, { path: "assets/" + safeAssetName });
      }

      // ── Code files list
      if (pathname === "/api/code-files") {
        const ignore = ["node_modules/**", ".excalidraw-history/**", "vendor/**", ".git/**"];
        const all = await glob("**/*", { cwd: CWD, nodir: true, ignore });
        const codeFiles = all.filter(f => {
          const base = path.basename(f);
          return !base.startsWith(".excalidraw-") && isCodeFile(base);
        }).sort();
        return json(res, codeFiles);
      }

      // ── Code file CRUD
      const cm = pathname.match(/^\/api\/code\/(.+)$/);
      if (cm) {
        const name = safeCodeName(cm[1]);
        if (!name) return json(res, { error: "invalid name" }, 400);
        const fp = path.join(CWD, name);
        // Guard: must stay inside CWD
        if (!fp.startsWith(CWD + path.sep) && fp !== CWD) return json(res, { error: "path escape" }, 400);

        if (method === "GET") {
          try {
            if (await isBinary(fp)) {
              return json(res, { binary: true });
            }
            const raw = await fs.readFile(fp);
            // BOM detection
            let bom = false;
            let buf = raw;
            if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) { bom = true; buf = raw.slice(3); }
            const text = buf.toString("utf8");
            const crlf = text.includes("\r\n");
            // Normalize to LF for the editor
            const normalized = crlf ? text.replace(/\r\n/g, "\n") : text;
            touchRecent(name, "code");
            return json(res, { text: normalized, binary: false, crlf, bom });
          } catch { return json(res, { error: "not found" }, 404); }
        }

        if (method === "PUT" || method === "POST") {
          const body = await readBody(req);
          if (!body || typeof body.text !== "string") return json(res, { error: "expected {text}" }, 400);
          let out = body.text;
          if (body.crlf) out = out.replace(/\n/g, "\r\n");
          const encoded = body.bom ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(out, "utf8")]) : Buffer.from(out, "utf8");
          await fs.mkdir(path.dirname(fp), { recursive: true });
          await fs.writeFile(fp, encoded);
          touchRecent(name, "code");
          broadcast("code:changed", { name, op: method === "POST" ? "created" : "updated" });
          return json(res, { ok: true });
        }

        if (method === "DELETE") {
          try { await fs.unlink(fp); broadcast("code:changed", { name, op: "deleted" }); return json(res, { ok: true }); }
          catch { return json(res, { error: "not found" }, 404); }
        }
        res.writeHead(405); return res.end();
      }

      // ── Static media (images, audio, video referenced in notes)
      // Serve files directly from CWD so that markdown `![](img.png)` links work.
      // SVG and PDF served with attachment disposition to prevent script execution.
      const MEDIA_TYPES = {
        ".png":  "image/png",      ".jpg":  "image/jpeg",  ".jpeg": "image/jpeg",
        ".gif":  "image/gif",      ".webp": "image/webp",  ".svg":  "image/svg+xml",
        ".ico":  "image/x-icon",   ".mp4":  "video/mp4",   ".webm": "video/webm",
        ".mp3":  "audio/mpeg",     ".ogg":  "audio/ogg",   ".wav":  "audio/wav",
        ".m4a":  "audio/mp4",      ".pdf":  "application/pdf",
      };
      const mediaExt = path.extname(pathname).toLowerCase();
      if (MEDIA_TYPES[mediaExt] && !pathname.includes("..")) {
        const rel  = pathname.replace(/^\//, "");
        const file = path.join(CWD, rel);
        // Guard: resolved path must stay within CWD
        if (file.startsWith(CWD + path.sep) || file === CWD) {
          try {
            const buf = await fs.readFile(file);
            const headers = {
              "Content-Type": MEDIA_TYPES[mediaExt],
              "Cache-Control": "no-cache",
            };
            // Force download for active-content types to prevent script execution
            if (mediaExt === ".svg" || mediaExt === ".pdf") {
              headers["Content-Disposition"] = "attachment";
            }
            res.writeHead(200, headers);
            return res.end(buf);
          } catch { /* fall through to SPA */ }
        }
      }

      // SPA fallback
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
      res.end(appHtml());

    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(err.message);
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", resolve);
    server.on("error", reject);
  });

  return server;
}
