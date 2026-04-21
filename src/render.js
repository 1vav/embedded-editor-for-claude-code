// Renders an Excalidraw JSON diagram to a PNG Buffer using Excalidraw's
// own `exportToSvg` (so shapes get the real rough.js hand-drawn look, hachure
// fills, etc.) and then rasterizes with @resvg/resvg-js.
//
// Requires a minimal browser shim (see ./shim.js). The vendored Excalidraw
// bundle (../vendor/excalidraw.mjs) is produced by scripts/build-excalidraw-bundle.mjs
// — it inlines React + rough.js + friends into one self-contained ESM file.

import path from "path";
import { fileURLToPath } from "url";
import { ensureBrowserShim } from "./shim.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorBundlePath = path.resolve(here, "..", "vendor", "excalidraw.mjs");

// Both the Excalidraw bundle and @resvg/resvg-js (native module) are loaded
// lazily. This keeps MCP initialize fast and — critically — prevents a
// native-module load failure from killing the server before it can respond
// to protocol messages. Under Electron's bundled Node some native modules
// reject at load time; deferring gives the server a chance to at least
// report the error in a tool result instead of dying silently.
let excaliPromise = null;
function loadExcalidraw() {
  if (!excaliPromise) {
    ensureBrowserShim();
    excaliPromise = import(vendorBundlePath);
  }
  return excaliPromise;
}

let resvgPromise = null;
function loadResvg() {
  if (!resvgPromise) resvgPromise = import("@resvg/resvg-js");
  return resvgPromise;
}


export async function renderToSvg(diagram) {
  const { exportToSvg } = await loadExcalidraw();
  const elements = Array.isArray(diagram?.elements) ? diagram.elements : [];
  const appState = {
    viewBackgroundColor: "#ffffff",
    exportBackground: true,
    exportWithDarkMode: false,
    ...(diagram?.appState || {}),
  };
  const svgEl = await exportToSvg({
    elements,
    appState,
    files: diagram?.files || {},
    exportPadding: 24,
  });
  return new globalThis.XMLSerializer().serializeToString(svgEl);
}

export async function renderToPng(diagram, { pngWidth = 1000 } = {}) {
  const svg = await renderToSvg(diagram);
  const { Resvg } = await loadResvg();
  const background =
    diagram?.appState?.viewBackgroundColor &&
    diagram.appState.viewBackgroundColor !== "transparent"
      ? diagram.appState.viewBackgroundColor
      : "#ffffff";
  const resvg = new Resvg(svg, {
    background,
    fitTo: { mode: "width", value: pngWidth },
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}

export async function renderToPngBase64(diagram, opts = {}) {
  const png = await renderToPng(diagram, opts);
  return png.toString("base64");
}
