import React, { useState, useEffect, useRef, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.min.mjs";

// Real worker file served from /vendor/ (filename carries the pdfjs version, written
// by scripts/build-viewer-bundle.mjs). The main-thread "fake worker" fallback relies
// on eval, which the page CSP (script-src 'self' 'unsafe-inline') forbids — so a real
// worker is mandatory, not an optimisation.
pdfjsLib.GlobalWorkerOptions.workerSrc = `/vendor/pdf.worker.${pdfjsLib.version}.min.js`;

export function PdfView({ name, T }) {
  const src = `/api/pdf/${encodeURIComponent(name)}`;
  const containerRef = useRef(null);   // scroll container + canvas parent
  const pdfDocRef = useRef(null);      // loaded pdfjs document, reused across re-renders
  const renderTokenRef = useRef(0);    // bumped to cancel in-flight renders
  const [error, setError] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);

  // Re-render every page at the given target page-width using the already-loaded doc.
  // Preserves scroll fraction so the user's reading position survives a resize.
  const renderAtWidth = useCallback(async (avail) => {
    const container = containerRef.current;
    const pdf = pdfDocRef.current;
    if (!container || !pdf) return;
    const myToken = ++renderTokenRef.current;

    const prevH = container.scrollHeight || 1;
    const prevTop = container.scrollTop || 0;
    const scrollFrac = prevTop / prevH;

    container.replaceChildren();
    const dpr = window.devicePixelRatio || 1;
    for (let n = 1; n <= pdf.numPages; n++) {
      if (myToken !== renderTokenRef.current) return;
      const page = await pdf.getPage(n);
      if (myToken !== renderTokenRef.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(avail / base.width, 3);
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
    if (myToken === renderTokenRef.current) {
      container.scrollTop = scrollFrac * container.scrollHeight;
    }
  }, []);

  // Load the document once per src; initial render uses the current container width.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pdfDocRef.current?.destroy?.();
    pdfDocRef.current = null;

    (async () => {
      try {
        const buf = await fetch(src).then(r => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          return r.arrayBuffer();
        });
        if (cancelled) return;
        // cMapUrl + standardFontDataUrl are required for correct font rendering:
        //   • cMapUrl: CID character maps for CJK and ligature-heavy embedded fonts.
        //     Without these, glyphs like the "ffi" ligature in "Officer" render as
        //     blanks ("O f cer").
        //   • standardFontDataUrl: fallback fonts for the 14 standard PDF fonts
        //     (Helvetica, Times, Courier…) that PDFs reference by name only.
        // Both directories are bundled into vendor/ by scripts/build-viewer-bundle.mjs.
        // Trailing slash matters — pdfjs concatenates the resource name directly.
        const pdf = await pdfjsLib.getDocument({
          data: buf,
          cMapUrl: "/vendor/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/vendor/standard_fonts/",
        }).promise;
        if (cancelled) { pdf.destroy?.(); return; }
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        const c = containerRef.current;
        const avail = Math.max(320, (c?.clientWidth ?? 800) - 32);
        await renderAtWidth(avail);
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTokenRef.current++;
      pdfDocRef.current?.destroy?.();
      pdfDocRef.current = null;
    };
  }, [src, renderAtWidth]);

  // Re-render on container width change (debounced). Skips sub-pixel jitter and
  // waits until the document has finished loading before reacting.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer = null;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (Math.abs(w - lastWidth) < 8) return;
      lastWidth = w;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pdfDocRef.current) return;
        const avail = Math.max(320, w - 32);
        renderAtWidth(avail).catch(() => {});
      }, 120);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [renderAtWidth]);

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
