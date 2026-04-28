import React, { useState, useEffect } from "react";

export function PdfView({ name, T }) {
  const src = `/api/pdf/${encodeURIComponent(name)}`;
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let url;
    fetch(src)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.blob();
      })
      .then(blob => {
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(e => setError(e.message));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [src]);

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
      {/* PDF viewer — blob URL avoids Chrome iframe black-screen issue */}
      {error ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: T.mono, fontSize: 12, color: T.muted }}>
          Failed to load PDF: {error}
        </div>
      ) : blobUrl ? (
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <embed
            src={blobUrl}
            type="application/pdf"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: T.mono, fontSize: 12, color: T.muted }}>
          Loading…
        </div>
      )}
    </div>
  );
}
