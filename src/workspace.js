// Shared workspace utilities — used by both the MCP server (server.js)
// and the HTTP viewer server (viewer-server.js).
//
// Extracted here so that security fixes (name validation, link rewriting)
// propagate to both code paths automatically.

import fs   from "fs/promises";
import path from "path";
import { glob } from "glob";
import { resolveRoot } from "./paths.js";

export const ROOT     = resolveRoot();
const HIST_DIR        = path.join(ROOT, ".excalidraw-history");

// ── Name validation ───────────────────────────────────────────────────────────

// Strict name sanitiser — shared by MCP and HTTP paths so any security fix
// here applies to both. Strips the given extension, rejects traversal and
// special characters, returns the clean relative path.
export function validateName(raw, stripExt = "") {
  const s = String(raw || "")
    .replace(/\\/g, "/")
    .replace(new RegExp(`\\${stripExt}$`, "i"), "");
  if (!s) throw new Error("empty file name");
  if (path.isAbsolute(s)) throw new Error("name must be relative");
  const segs = s.split("/").filter(Boolean);
  for (const seg of segs) {
    if (seg === ".." || seg === ".") throw new Error("name may not contain '..' or '.'");
    if (!/^[\w-][\w.\- ]*$/.test(seg)) throw new Error(`invalid segment: "${seg}"`);
  }
  return segs.join("/");
}

// Resolve a validated name to an absolute file path, asserting it stays
// inside ROOT.
export function resolveFile(name, ext) {
  const safe = validateName(name, ext);
  const abs  = path.join(ROOT, `${safe}${ext}`);
  const rel  = path.relative(ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw new Error("path escapes workspace root");
  return abs;
}

// ── Link rewriting ────────────────────────────────────────────────────────────

export async function rewriteLinks(oldName, newName) {
  const [mdFiles, exFiles] = await Promise.all([
    glob("**/*.md",         { cwd: ROOT, ignore: ["node_modules/**"] }),
    glob("**/*.excalidraw", { cwd: ROOT, ignore: ["node_modules/**", ".excalidraw-history/**"] }),
  ]);
  // Use an atomic counter-style accumulator compatible with Promise.all fan-out
  let updated = 0;

  await Promise.all(mdFiles.map(async f => {
    const fp = path.join(ROOT, f);
    try {
      const text = await fs.readFile(fp, "utf8");
      let changed = false;
      const newText = text.replace(
        /(!?\[\[)([^\]|]+?)(\.(md|excalidraw))?(\|[^\]]+)?(\]\])/g,
        (match, open, name, ext, _extType, alias, close) => {
          const trimmed = name.trim();
          if (trimmed === oldName || trimmed === oldName + (ext || "")) {
            changed = true;
            return `${open}${newName}${ext || ""}${alias || ""}${close}`;
          }
          return match;
        }
      );
      if (changed) { await fs.writeFile(fp, newText, "utf8"); updated++; }
    } catch (e) { process.stderr.write(`[embedded-editor] rewriteLinks md error ${fp}: ${e.message}\n`); }
  }));

  await Promise.all(exFiles.map(async f => {
    const fp = path.join(ROOT, f);
    try {
      const data = JSON.parse(await fs.readFile(fp, "utf8"));
      let changed = false;
      if (Array.isArray(data.elements)) {
        for (const el of data.elements) {
          if (el.link && typeof el.link === "string") {
            const wl = el.link.match(/^\[\[(.+)\]\]$/);
            if (wl) {
              const ref = wl[1].replace(/\.(md|excalidraw|duckdb)$/i, "").trim();
              if (ref === oldName) { el.link = `[[${newName}]]`; changed = true; }
            }
          }
        }
      }
      if (changed) { await fs.writeFile(fp, JSON.stringify(data, null, 2), "utf8"); updated++; }
    } catch (e) { process.stderr.write(`[embedded-editor] rewriteLinks excalidraw error ${fp}: ${e.message}\n`); }
  }));

  return updated;
}

// ── Backlinks ─────────────────────────────────────────────────────────────────

export async function findBacklinks(name) {
  const results = [];
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkRe = new RegExp(
    `!?\\[\\[${escapedName}(?:\\.(md|excalidraw))?(?:\\|[^\\]]+)?\\]\\]`, "i"
  );

  const [mdFiles, exFiles] = await Promise.all([
    glob("**/*.md",         { cwd: ROOT, ignore: ["node_modules/**"] }),
    glob("**/*.excalidraw", { cwd: ROOT, ignore: ["node_modules/**", ".excalidraw-history/**"] }),
  ]);

  // Read all files in parallel — each file is independent, safe to fan-out
  await Promise.all(mdFiles.map(async f => {
    try {
      const text = await fs.readFile(path.join(ROOT, f), "utf8");
      if (linkRe.test(text)) results.push({ name: f.replace(/\.md$/, ""), type: "note" });
    } catch (e) { process.stderr.write(`[embedded-editor] findBacklinks md error ${f}: ${e.message}\n`); }
  }));

  await Promise.all(exFiles.map(async f => {
    try {
      const data = JSON.parse(await fs.readFile(path.join(ROOT, f), "utf8"));
      const fn = f.replace(/\.excalidraw$/, "");
      if (fn === name) return; // skip self
      const hasLink = data.elements?.some(el => {
        if (!el.link) return false;
        const wl = el.link.match(/^\[\[(.+)\]\]$/);
        return wl && wl[1].replace(/\.(md|excalidraw|duckdb)$/i, "").trim() === name;
      });
      if (hasLink) results.push({ name: fn, type: "diagram" });
    } catch (e) { process.stderr.write(`[embedded-editor] findBacklinks excalidraw error ${f}: ${e.message}\n`); }
  }));

  return results;
}

// ── Snapshot list ─────────────────────────────────────────────────────────────

export async function listSnapshots(name) {
  try {
    const dir   = path.join(HIST_DIR, name);
    const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort().reverse();
    return files.map(f => ({ ts: parseInt(f), file: f }));
  } catch { return []; }
}
