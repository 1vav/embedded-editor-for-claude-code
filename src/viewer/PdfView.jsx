import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.min.mjs";

// Real worker file served from /vendor/ (filename carries the pdfjs version, written
// by scripts/build-viewer-bundle.mjs). The main-thread "fake worker" fallback relies
// on eval, which the page CSP (script-src 'self' 'unsafe-inline') forbids — so a real
// worker is mandatory, not an optimisation.
pdfjsLib.GlobalWorkerOptions.workerSrc = `/vendor/pdf.worker.${pdfjsLib.version}.min.js`;

export function PdfView({ name, T }) {
  const src = `/api/pdf/${encodeURIComponent(name)}`;
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);

  const renderPdf = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    setLoading(true);
    setError(null);
    let pdf;
    try {
      const buf = await fetch(src).then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.arrayBuffer();
      });
      pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      setNumPages(pdf.numPages);
      container.replaceChildren();
      const dpr = window.devicePixelRatio || 1;
      // Fit page width to container (minus padding), capped so huge pages don't explode.
      const avail = Math.max(320, container.clientWidth - 32);
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(avail / base.width, 2);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.style.display = "block";
        canvas.style.margin = "0 auto 12px";
        canvas.style.boxShadow = "0 1px 6px rgba(0,0,0,0.3)";
        container.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
      setLoading(false);
    } catch (e) {
      setError(e?.message || String(e));
      setLoading(false);
    } finally {
      pdf?.destroy?.();
    }
  }, [src]);

  useEffect(() => { renderPdf(); }, [renderPdf]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T.bg }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
        borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0,
      }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.text, fontWeight: 600 }}>
          {name}.pdf
        </span>
        {numPages > 0 && (
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>
            {numPages} page{numPages === 1 ? "" : "s"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <a
          href={src}
          download={`${name}.pdf`}
          style={{
            padding: "3px 9px", border: `1px solid ${T.border2}`, borderRadius: 5,
            fontSize: 11, fontFamily: T.mono, color: T.muted,
            textDecoration: "none", cursor: "pointer",
          }}
        >
          ↓ Download
        </a>
      </div>
      {/* Rendered pages — the scroll container stays laid out so clientWidth is
          readable during render; loading/error sit on top as a centered overlay. */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "auto", padding: 16 }} />
        {(loading || error) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", fontFamily: T.mono, fontSize: 12, color: T.muted,
            background: T.bg, pointerEvents: "none" }}>
            {error ? `Failed to load PDF: ${error}` : "Loading…"}
          </div>
        )}
      </div>
    </div>
  );
}
