import React from "react";

export function PdfView({ name, T }) {
  const src = `/api/pdf/${encodeURIComponent(name)}`;
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
      {/* PDF iframe — browser native renderer */}
      <iframe
        src={src}
        title={name}
        style={{ flex: 1, border: "none", background: "#fff" }}
      />
    </div>
  );
}
