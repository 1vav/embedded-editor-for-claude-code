// Entry point for scripts/build-excalidraw-bundle.mjs.
// Exports exactly what src/render.js needs from @excalidraw/excalidraw so
// esbuild can tree-shake and bundle only the necessary code.
export { exportToSvg } from "@excalidraw/excalidraw";
