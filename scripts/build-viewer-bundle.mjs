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
import { copyFile, readFile, mkdir, readdir, stat } from "fs/promises";
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

// ── Copy the pdf.js worker into vendor/ ──────────────────────────────────────
// pdf.js cannot run its parser on the main thread under our CSP (the fallback
// "fake worker" uses eval, which script-src forbids), so it needs a real worker
// served from /vendor/. The pdfjs version is in the filename so an upgrade yields
// a fresh URL (no stale immutable-cache hit); PdfView builds the same URL from
// pdfjsLib.version. Copied as .js (not .mjs) so the server's vendor MIME map
// serves it as application/javascript and it gets gz/br compressed below.
{
  const pdfjsPkg = JSON.parse(await readFile(path.join(root, "node_modules/pdfjs-dist/package.json"), "utf8"));
  await copyFile(
    path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    path.join(root, "vendor", `pdf.worker.${pdfjsPkg.version}.min.js`),
  );
  console.log(`Copied pdf.js worker  →  vendor/pdf.worker.${pdfjsPkg.version}.min.js`);
}

// ── Copy pdf.js cmaps and standard fonts into vendor/ ────────────────────────
// PDF.js needs these resource directories to render fonts correctly:
//   • cmaps/         — CID character maps for CJK and ligature-heavy embedded fonts.
//                      Without these, glyphs like the "ffi" ligature in "Officer" are
//                      dropped or replaced with blanks ("O f cer").
//   • standard_fonts — Foxit/Liberation fallback fonts for the 14 standard PDF fonts
//                      (Helvetica, Times, Courier, Symbol, Dingbats) that PDFs are
//                      allowed to reference by name without embedding.
// PdfView.jsx points pdfjs at /vendor/cmaps/ and /vendor/standard_fonts/ via
// cMapUrl / standardFontDataUrl. Total ~2.4 MB of binary assets — bundled into npm.
async function copyDir(src, dst) {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src);
  await Promise.all(entries.map(async name => {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = await stat(s);
    if (st.isDirectory()) await copyDir(s, d);
    else await copyFile(s, d);
  }));
}
{
  const pairs = [
    ["node_modules/pdfjs-dist/cmaps",          "vendor/cmaps"],
    ["node_modules/pdfjs-dist/standard_fonts", "vendor/standard_fonts"],
  ];
  for (const [src, dst] of pairs) {
    await copyDir(path.join(root, src), path.join(root, dst));
    console.log(`Copied ${src.split("/").pop()}  →  ${dst}/`);
  }
}

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
const vendorEntries = await readdir(vendorDir);
const toCompress = vendorEntries.filter(f => (f.endsWith(".js") || f.endsWith(".css")) && !f.endsWith(".gz") && !f.endsWith(".br"));
await Promise.all(toCompress.map(f => compress(path.join(vendorDir, f))));

console.log(`Compression done in ${((Date.now() - t1) / 1000).toFixed(1)}s  →  .gz + .br variants written`);
