// Build the browser viewer bundle (entry.jsx → vendor/viewer.js + vendor/viewer.css).
// Also produces .gz and .br pre-compressed variants so the server can send them
// directly with Content-Encoding without compressing on every request.
//
// NOTE: vendor/ is gitignored to prevent bundled third-party code from being
// committed.  The .gz/.br files land there too and are excluded from git the
// same way.  They are included in the npm package via the "files" field in
// package.json.
//
// Run: node scripts/build-viewer-bundle.mjs

import { build } from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createGzip, createBrotliCompress, constants as zlibConstants } from "zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const noCompress = process.argv.includes("--no-compress");

console.log("Building viewer bundle…");
const t0 = Date.now();

await build({
  entryPoints: [path.join(root, "src/viewer/entry.jsx")],
  bundle:      true,
  splitting:   true,
  outdir:      path.join(root, "vendor"),
  entryNames:  "viewer",
  chunkNames:  "chunk-[hash]",
  format:      "esm",
  jsx:         "automatic",
  minify:      true,
  define:      { "process.env.NODE_ENV": '"production"' },
  target:      ["chrome100"],
  conditions:  ["production", "browser"],
  loader: {
    ".woff":  "file",
    ".woff2": "file",
    ".ttf":   "file",
    ".png":   "file",
    ".jpg":   "file",
    ".jpeg":  "file",
    ".gif":   "file",
    ".webp":  "file",
    ".svg":   "dataurl",  // tldraw uses SVG assets as URLs; Excalidraw rough.js doesn't import SVG files
  },
  assetNames:  "[name]-[hash]",
  publicPath:  "/vendor/",
});

console.log(`Bundle done in ${((Date.now() - t0) / 1000).toFixed(1)}s  →  vendor/viewer.js + vendor/viewer.css`);

if (noCompress) process.exit(0);

// ── Pre-compress JS and CSS for Content-Encoding serving ─────────────────────
// Produces vendor/viewer.js.gz, vendor/viewer.js.br, vendor/viewer.css.gz, vendor/viewer.css.br
console.log("Compressing assets…");
const t1 = Date.now();

async function compress(src) {
  await Promise.all([
    pipeline(
      createReadStream(src),
      createGzip({ level: 9 }),
      createWriteStream(src + ".gz")
    ),
    pipeline(
      createReadStream(src),
      createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }),
      createWriteStream(src + ".br")
    ),
  ]);
}

const vendorDir = path.join(root, "vendor");
const { readdir } = await import("fs/promises");
const vendorEntries = await readdir(vendorDir);
const toCompress = vendorEntries.filter(f => (f.endsWith(".js") || f.endsWith(".css")) && !f.endsWith(".gz") && !f.endsWith(".br"));
await Promise.all(toCompress.map(f => compress(path.join(vendorDir, f))));

console.log(`Compression done in ${((Date.now() - t1) / 1000).toFixed(1)}s  →  .gz + .br variants written`);
