import os from "os";
import path from "path";

export const DEFAULT_PORT = 3000;

export function expandPath(raw) {
  if (!raw) return raw;
  let out = raw;
  out = out.replace(/\$\{HOME\}/g, os.homedir());
  out = out.replace(/\$HOME\b/g, os.homedir());
  out = out.replace(/\$\{USER\}/g, os.userInfo().username || "");
  out = out.replace(/\$USER\b/g, os.userInfo().username || "");
  if (out.startsWith("~/") || out === "~") out = path.join(os.homedir(), out.slice(1));
  return out;
}

export function resolveRoot() {
  const raw = process.env.EXCALIDRAW_ROOT;
  const log = (msg) => { try { process.stderr.write(`[embedded-editor] ${msg}\n`); } catch {} };
  if (!raw) {
    log(`EXCALIDRAW_ROOT unset; using cwd=${process.cwd()}`);
    return process.cwd();
  }
  const expanded = expandPath(raw);
  if (/\$\{[^}]+\}|(?<![\\a-zA-Z0-9])\$[A-Za-z_]\w*/.test(expanded)) {
    const fallback = path.join(os.homedir(), "Documents", "excalidraw");
    log(`EXCALIDRAW_ROOT=${JSON.stringify(raw)} still contains unresolved templates after expansion (${JSON.stringify(expanded)}); falling back to ${fallback}`);
    return fallback;
  }
  const resolved = path.resolve(expanded);
  log(`EXCALIDRAW_ROOT=${JSON.stringify(raw)} → ${resolved}`);
  return resolved;
}
