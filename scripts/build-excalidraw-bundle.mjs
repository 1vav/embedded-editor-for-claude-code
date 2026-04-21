// Pre-bundle @excalidraw/excalidraw into a single ESM file that Node can load
// cleanly. Excalidraw's shipped ESM has assumptions that Node's strict ESM
// resolver doesn't accept (extensionless imports, non-standard Parcel exports
// in transitive deps, JSON imports without attributes). Running it through
// esbuild flattens all that into one portable bundle.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, "..", "vendor", "excalidraw.mjs");

await build({
  entryPoints: [path.resolve(here, "entry.mjs")],
  bundle: true,
  format: "esm",
  platform: "node",
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  target: ["node18"],
  outfile: outFile,
  // Inline React so the bundle is self-contained; Excalidraw expects these
  // to be real modules, and Node ESM's "dynamic require" from a CJS-wrapped
  // ESM bundle fails when they're external.
  external: [],
  loader: { ".json": "json", ".css": "empty" },
  logLevel: "info",
});

console.log("Built", outFile);
