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

// Derive a stable port in 3100–3999 from the absolute workspace root path.
// Same path always yields the same port; different paths almost always differ.
export function derivePort(rootPath) {
  let hash = 0;
  for (let i = 0; i < rootPath.length; i++) {
    hash = (Math.imul(hash, 31) + rootPath.charCodeAt(i)) >>> 0;
  }
  return 3100 + (hash % 900);
}

export function resolveRoot() {
  const raw = process.env.EXCALIDRAW_ROOT;
  const log = (msg) => { try { process.stderr.write(`[embedded-editor] ${msg}\n`); } catch {} };

  // No env var set — use cwd directly.
  if (!raw) {
    const detected = process.cwd();
    log(`EXCALIDRAW_ROOT unset; using cwd=${detected}`);
    return detected;
  }

  const expanded = expandPath(raw);

  // "." is the legacy global-init default — treat it like unset.
  if (expanded === ".") {
    const detected = process.cwd();
    log(`EXCALIDRAW_ROOT="." (legacy); using cwd=${detected}`);
    return detected;
  }

  if (/\$\{[^}]+\}|(?<![\\a-zA-Z0-9])\$[A-Za-z_]\w*/.test(expanded)) {
    const detected = process.cwd();
    log(`EXCALIDRAW_ROOT=${JSON.stringify(raw)} contains unresolved templates; using cwd=${detected}`);
    return detected;
  }

  const resolved = path.resolve(expanded);
  log(`EXCALIDRAW_ROOT=${JSON.stringify(raw)} → ${resolved}`);
  return resolved;
}
