import os from "os";
import path from "path";
import { existsSync } from "fs";

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

// Walk up from dir looking for .git or CLAUDE.md to find the project root.
// Falls back to dir itself if none found.
function findProjectRoot(dir) {
  let current = path.resolve(dir);
  while (true) {
    if (existsSync(path.join(current, ".git")) || existsSync(path.join(current, "CLAUDE.md"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return dir; // filesystem root — give up
    current = parent;
  }
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

  // No env var set — auto-detect by walking up from cwd.
  if (!raw) {
    const detected = findProjectRoot(process.cwd());
    log(`EXCALIDRAW_ROOT unset; auto-detected root=${detected} (cwd=${process.cwd()})`);
    return detected;
  }

  const expanded = expandPath(raw);

  // "." is the legacy global-init default — treat it like unset so auto-detection runs.
  if (expanded === ".") {
    const detected = findProjectRoot(process.cwd());
    log(`EXCALIDRAW_ROOT="." (legacy); auto-detected root=${detected} (cwd=${process.cwd()})`);
    return detected;
  }

  if (/\$\{[^}]+\}|(?<![\\a-zA-Z0-9])\$[A-Za-z_]\w*/.test(expanded)) {
    const detected = findProjectRoot(process.cwd());
    log(`EXCALIDRAW_ROOT=${JSON.stringify(raw)} contains unresolved templates; auto-detected root=${detected}`);
    return detected;
  }

  const resolved = path.resolve(expanded);
  log(`EXCALIDRAW_ROOT=${JSON.stringify(raw)} → ${resolved}`);
  return resolved;
}
