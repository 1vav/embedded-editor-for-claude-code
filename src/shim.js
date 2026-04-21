// Installs enough of a browser environment for @excalidraw/excalidraw's
// export functions to run in Node. Idempotent — safe to call repeatedly.
//
// Required by the vendored Excalidraw bundle (vendor/excalidraw.mjs) which
// assumes: document, window, HTMLCanvasElement (with a real 2D context),
// FontFace + document.fonts, fetch, matchMedia, rAF, XMLSerializer.
//
// We deliberately do NOT depend on the `canvas` npm package (NAN-based, locks
// native binaries to a single Node ABI — breaks .mcpb portability). Instead
// we monkey-patch HTMLCanvasElement.prototype.getContext to return a minimal
// pure-JS 2D-context stub that satisfies Excalidraw's export path. Text
// measurement uses a heuristic — preview text positions may be off by a few
// pixels versus the exact render excalidraw.com produces, which is acceptable
// for an inline preview.

import { JSDOM } from "jsdom";

let installed = false;

// Approximate per-character-width ratios relative to font-size. Tuned to be
// close to common sans-serif metrics; good enough for preview rendering.
const AVG_CHAR_WIDTH_RATIO = 0.54;
const ASCENT_RATIO = 0.8;
const DESCENT_RATIO = 0.2;

function makeCanvas2DStub() {
  let font = "10px sans-serif";
  const parseSize = (f) => parseInt(String(f).match(/(\d+(?:\.\d+)?)px/)?.[1] || "10", 10);

  const measureText = (text) => {
    const size = parseSize(font);
    const width = String(text).length * size * AVG_CHAR_WIDTH_RATIO;
    return {
      width,
      actualBoundingBoxAscent: size * ASCENT_RATIO,
      actualBoundingBoxDescent: size * DESCENT_RATIO,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      fontBoundingBoxAscent: size * (ASCENT_RATIO + 0.1),
      fontBoundingBoxDescent: size * (DESCENT_RATIO - 0.1),
      emHeightAscent: size * ASCENT_RATIO,
      emHeightDescent: size * DESCENT_RATIO,
      hangingBaseline: size * 0.7,
      alphabeticBaseline: 0,
      ideographicBaseline: -size * 0.1,
    };
  };

  const noop = () => {};
  const ctx = {
    // Feature-detect key used at module load in Excalidraw's prod bundle.
    filter: "none",
    // Settable state — assignments from Excalidraw just stick here.
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1,
    lineCap: "butt", lineJoin: "miter", miterLimit: 10,
    globalAlpha: 1, globalCompositeOperation: "source-over",
    textAlign: "start", textBaseline: "alphabetic", direction: "inherit",
    imageSmoothingEnabled: true, imageSmoothingQuality: "low",
    shadowBlur: 0, shadowColor: "rgba(0,0,0,0)", shadowOffsetX: 0, shadowOffsetY: 0,
    canvas: null, // filled in below
    get font() { return font; },
    set font(v) { font = v; },
    measureText,
    // Paint ops — unused for our SVG export path; no-ops keep the surface safe.
    save: noop, restore: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, arc: noop, arcTo: noop,
    rect: noop, roundRect: noop, ellipse: noop,
    fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop,
    translate: noop, scale: noop, rotate: noop,
    transform: noop, setTransform: noop, resetTransform: noop,
    drawImage: noop, createImageData: (w, h) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4), width: w || 1, height: h || 1 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4), width: w || 1, height: h || 1 }),
    putImageData: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({}),
    setLineDash: noop, getLineDash: () => [],
    isPointInPath: () => false, isPointInStroke: () => false,
  };
  return ctx;
}

export function ensureBrowserShim() {
  if (installed) return;
  installed = true;

  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  // Canvas 2D context stub — see module comment above.
  const canvasProto = dom.window.HTMLCanvasElement.prototype;
  const ctxCache = new WeakMap();
  canvasProto.getContext = function getContext(type) {
    if (type !== "2d") return null;
    let ctx = ctxCache.get(this);
    if (!ctx) { ctx = makeCanvas2DStub(); ctx.canvas = this; ctxCache.set(this, ctx); }
    return ctx;
  };
  canvasProto.toDataURL = function () { return "data:image/png;base64,"; };
  canvasProto.toBlob = function (cb) { cb?.(new dom.window.Blob([], { type: "image/png" })); };

  class FontFaceShim {
    constructor(family, src, descriptors = {}) {
      this.family = family;
      this.src = src;
      Object.assign(this, {
        display: "auto", style: "normal", weight: "400",
        stretch: "normal", unicodeRange: "U+0-10FFFF",
        ...descriptors,
      });
      this.status = "loaded";
      this.loaded = Promise.resolve(this);
    }
    async load() { this.status = "loaded"; return this; }
  }

  const fontSet = new Set();
  const fontsShim = {
    add: (f) => { fontSet.add(f); return fontsShim; },
    delete: (f) => fontSet.delete(f),
    clear: () => fontSet.clear(),
    forEach: (cb) => fontSet.forEach(cb),
    [Symbol.iterator]: () => fontSet[Symbol.iterator](),
    ready: Promise.resolve(undefined),
    status: "loaded",
    check: () => true,
    load: async () => [],
  };
  Object.defineProperty(dom.window.document, "fonts", {
    value: fontsShim,
    configurable: true,
  });

  function setGlobal(key, value) {
    try { global[key] = value; } catch {
      Object.defineProperty(globalThis, key, {
        value, writable: true, configurable: true,
      });
    }
  }

  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLCanvasElement: dom.window.HTMLCanvasElement,
    Image: dom.window.Image,
    XMLSerializer: dom.window.XMLSerializer,
    DOMParser: dom.window.DOMParser,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    Element: dom.window.Element,
    Node: dom.window.Node,
    SVGElement: dom.window.SVGElement,
    FontFace: FontFaceShim,
  };
  for (const [k, v] of Object.entries(globals)) setGlobal(k, v);

  dom.window.FontFace = FontFaceShim;
  dom.window.devicePixelRatio = 2;
  globalThis.devicePixelRatio = 2;

  const noopMedia = () => ({
    matches: false,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
  });
  setGlobal("matchMedia", noopMedia);
  dom.window.matchMedia = noopMedia;

  setGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
  setGlobal("cancelAnimationFrame", (id) => clearTimeout(id));
  dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
  dom.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

  // Excalidraw tries to fetch font files over the network. Stub it out so we
  // fall back to locally-available fonts instead of hanging on DNS.
  if (typeof globalThis.fetch !== "function") {
    setGlobal("fetch", async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
      json: async () => ({}),
    }));
  }
}
