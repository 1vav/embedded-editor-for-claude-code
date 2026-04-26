import React, { useState, useEffect } from "react";

const enc = encodeURIComponent;

function ReadOnlyTable({ columns, rows, T }) {
  if (!columns?.length) return (
    <div style={{ padding: 20, color: T.muted, fontFamily: T.mono, fontSize: 12 }}>
      No data or empty file.
    </div>
  );
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: T.mono }}>
      <thead>
        <tr>
          {columns.map(c => (
            <th key={c} style={{
              padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 500,
              color: T.muted, letterSpacing: ".06em", textTransform: "uppercase",
              borderBottom: `1px solid ${T.border}`, background: T.surface, whiteSpace: "nowrap",
            }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={{ borderBottom: `1px solid ${T.border}` }}>
            {columns.map(c => (
              <td key={c} style={{ padding: "7px 12px", color: T.textDim, whiteSpace: "nowrap" }}>
                {String(row[c] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function exportCsv(name, { columns, rows }) {
  if (!columns?.length) return;
  const header = columns.join(",");
  const body = rows.map(r => columns.map(c => JSON.stringify(r[c] ?? "")).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
}

export function CsvView({ name, T }) {
  const [result, setResult] = useState({ columns: [], rows: [], rowCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`/api/csv/${enc(name)}`)
      .then(r => r.json())
      .then(res => {
        if (res.error) { setError(res.error); } else { setResult(res); }
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [name]);

  const ghost = (label, onClick) => (
    <span onClick={onClick} style={{
      padding: "3px 9px", border: `1px solid ${T.border2}`,
      borderRadius: 5, cursor: "pointer", fontSize: 11, fontFamily: T.mono,
      color: T.muted, background: "transparent", userSelect: "none",
    }}>{label}</span>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T.bg }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
        borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0, flexWrap: "wrap",
      }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.text, fontWeight: 600 }}>
          {name}.csv
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>
          {!loading && `· ${result.rowCount} rows · ${result.columns.length} cols`}
        </span>
        <span style={{ flex: 1 }} />
        {ghost("↓ Export", () => exportCsv(name, result))}
      </div>
      {/* Table */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {error && (
          <div style={{ padding: "10px 14px", color: "#f87171", fontFamily: T.mono, fontSize: 12 }}>{error}</div>
        )}
        {loading && (
          <div style={{ padding: "10px 14px", color: T.muted, fontFamily: T.mono, fontSize: 12 }}>Loading…</div>
        )}
        {!loading && !error && <ReadOnlyTable columns={result.columns} rows={result.rows} T={T} />}
      </div>
    </div>
  );
}
