import React, { useState, useEffect, useRef, useCallback } from "react";

function buildSlideDoc(css, sectionHtml) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1a2e; }
section { width: 100% !important; height: 100% !important; }
${css}
</style>
</head>
<body>${sectionHtml}</body>
</html>`;
}

export function MarpView({ raw, T }) {
  const [slides,  setSlides]  = useState([]);
  const [css,     setCss]     = useState("");
  const [idx,     setIdx]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIdx(0);

    import("@marp-team/marp-core")
      .then(({ Marp }) => {
        if (cancelled) return;
        const marp = new Marp({ html: false });
        const { html, css: marpCss } = marp.render(raw);
        const div = document.createElement("div");
        div.innerHTML = html;
        const sections = Array.from(div.querySelectorAll("section")).map(s => s.outerHTML);
        if (!cancelled) {
          setCss(marpCss);
          setSlides(sections);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) { setError(err.message); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [raw]);

  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIdx(i => Math.min(slides.length - 1, i + 1)), [slides.length]);

  const onKey = useCallback((e) => {
    if (e.key === "ArrowLeft"  || e.key === "ArrowUp")    { e.preventDefault(); prev(); }
    if (e.key === "ArrowRight" || e.key === "ArrowDown")  { e.preventDefault(); next(); }
  }, [prev, next]);

  const mono    = T?.mono    ?? "monospace";
  const muted   = T?.muted   ?? "#888";
  const bg      = T?.bg      ?? "#1a1a2e";
  const border  = T?.border  ?? "#333";
  const text    = T?.text    ?? "#eee";
  const surface = T?.surface ?? "#252540";

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      background: bg, fontFamily: mono, fontSize: 12, color: muted }}>
      loading marp…
    </div>
  );

  if (error) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      background: bg, fontFamily: mono, fontSize: 12, color: "#f87171", padding: 24 }}>
      render error: {error}
    </div>
  );

  if (!slides.length) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      background: bg, fontFamily: mono, fontSize: 12, color: muted }}>
      no slides found
    </div>
  );

  const srcdoc = buildSlideDoc(css, slides[idx] ?? "");

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKey}
      style={{ flex: 1, display: "flex", flexDirection: "column", background: bg, outline: "none" }}
    >
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, overflow: "hidden" }}>
        <div style={{
          width: "100%", maxWidth: 900,
          aspectRatio: "16 / 9",
          boxShadow: "0 8px 40px rgba(0,0,0,.6)",
          borderRadius: 4, overflow: "hidden",
          border: `1px solid ${border}`,
        }}>
          <iframe
            key={idx}
            srcDoc={srcdoc}
            sandbox="allow-same-origin"
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            title={`Slide ${idx + 1}`}
          />
        </div>
      </div>

      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        gap: 16, padding: "8px 16px", borderTop: `1px solid ${border}`, background: surface }}>
        <button
          onClick={prev} disabled={idx === 0}
          style={{ background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer",
            color: idx === 0 ? muted : text, fontFamily: mono, fontSize: 18, padding: "0 4px",
            opacity: idx === 0 ? 0.3 : 1 }}>
          ‹
        </button>
        <span style={{ fontFamily: mono, fontSize: 11, color: muted, minWidth: 60, textAlign: "center" }}>
          {idx + 1} / {slides.length}
        </span>
        <button
          onClick={next} disabled={idx === slides.length - 1}
          style={{ background: "none", border: "none", cursor: idx === slides.length - 1 ? "default" : "pointer",
            color: idx === slides.length - 1 ? muted : text, fontFamily: mono, fontSize: 18, padding: "0 4px",
            opacity: idx === slides.length - 1 ? 0.3 : 1 }}>
          ›
        </button>
      </div>
    </div>
  );
}
