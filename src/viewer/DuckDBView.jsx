// TableView — full-tab view for .duckdb files.
// TableEmbed — inline embed for ![[name.duckdb]] in notes.
import React, { useState, useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

const enc = encodeURIComponent;
const api = {
  getRows: (name, sqlStr) => {
    const url = sqlStr
      ? `/api/table/${enc(name)}?sql=${enc(sqlStr)}`
      : `/api/table/${enc(name)}`;
    return fetch(url).then(r => r.json());
  },
  upsertRows: (name, table, rows) =>
    fetch(`/api/table/${enc(name)}/rows`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({ table, rows }),
    }).then(r => r.json()),
  runQuery: (name, sqlStr) =>
    fetch(`/api/table/${enc(name)}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({ sql: sqlStr }),
    }).then(r => r.json()),
  getMeta: (name) =>
    fetch(`/api/table/${enc(name)}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({ sql: "SELECT value FROM _ee_meta WHERE key='created_by'" }),
    }).then(r => r.json()),
  listUserTables: (name) =>
    fetch(`/api/table/${enc(name)}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": location.origin },
      body: JSON.stringify({ sql: "SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_name NOT LIKE '_ee_%'" }),
    }).then(r => r.json()),
};

export function TableView({ name, T }) {
  const [dataView,    setDataView]    = useState(() => localStorage.getItem(`ee-table-view-${name}`) ?? "table");
  const [queryOpen,   setQueryOpen]   = useState(false);
  const [liveSync,    setLiveSync]    = useState(() => localStorage.getItem(`ee-table-sync-${name}`) === "live");
  const [isQuery,     setIsQuery]     = useState(false);
  const [activeTable, setActiveTable] = useState(null);
  const [result,      setResult]      = useState({ columns: [], rows: [], rowCount: 0 });
  const [sqlText,     setSqlText]     = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const cmRef     = useRef(null);
  const cmViewRef = useRef(null);

  function fetchTableRows(tbl) {
    if (!tbl) return;
    setLoading(true); setError(null);
    api.runQuery(name, `SELECT * FROM "${tbl.replace(/"/g, '""')}" LIMIT 200`)
      .then(res => { if (res.error) setError(res.error); else setResult(res); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  // Load table list + meta on mount
  useEffect(() => {
    let cancelled = false;
    api.listUserTables(name).then(({ rows }) => {
      if (cancelled) return;
      const names = (rows || []).map(r => r.table_name);
      if (names.length) { setActiveTable(names[0]); fetchTableRows(names[0]); }
    }).catch(() => {});
    api.getMeta(name).then(({ rows }) => {
      if (cancelled) return;
      const createdBy = rows?.[0]?.value ?? "table";
      setIsQuery(createdBy === "query");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  function fetchCustom(sqlStr) {
    const s = sqlStr ?? sqlText;
    if (!s) return;
    setLoading(true); setError(null);
    api.runQuery(name, s)
      .then(res => { if (res.error) setError(res.error); else setResult(res); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  async function handleCellBlur(rowIndex, col, newVal) {
    if (!activeTable) return;
    const row = { ...result.rows[rowIndex], [col]: newVal };
    setResult(r => { const rows = [...r.rows]; rows[rowIndex] = row; return { ...r, rows }; });
    await api.upsertRows(name, activeTable, [row]).catch(e => setError(e.message));
  }

  function handleAddRow() {
    if (!activeTable) return;
    const blank = Object.fromEntries(result.columns.map(c => [c, ""]));
    setResult(r => ({ ...r, rows: [...r.rows, blank] }));
  }

  function toggleDataView(v) {
    setDataView(v);
    localStorage.setItem(`ee-table-view-${name}`, v);
  }

  function toggleLive() {
    const next = !liveSync;
    setLiveSync(next);
    localStorage.setItem(`ee-table-sync-${name}`, next ? "live" : "lock");
  }

  // CM6 SQL editor in query pane
  useEffect(() => {
    if (!queryOpen || !cmRef.current || cmViewRef.current) return;
    const doc = sqlText || `SELECT * FROM ${activeTable ?? "table_name"} LIMIT 50`;
    const state = EditorState.create({
      doc,
      extensions: [
        history(), sql(),
        keymap.of([
          ...defaultKeymap, ...historyKeymap,
          { key: "Mod-Enter", run: () => { fetchCustom(cmViewRef.current?.state.doc.toString()); return true; } },
        ]),
        EditorView.updateListener.of(upd => { if (upd.docChanged) setSqlText(upd.state.doc.toString()); }),
        EditorView.theme({
          "&": { background: T.surface, color: T.text, fontSize: "12px" },
          ".cm-content": { fontFamily: T.mono, padding: "12px 14px" },
          ".cm-cursor": { borderLeftColor: T.accent },
        }),
      ],
    });
    cmViewRef.current = new EditorView({ state, parent: cmRef.current });
    return () => { cmViewRef.current?.destroy(); cmViewRef.current = null; };
  }, [queryOpen]);

  // Live re-run on SSE events when in query + live mode
  useEffect(() => {
    if (!isQuery || !liveSync) return;
    const es = new EventSource("/events");
    const handler = () => { if (sqlText) fetchCustom(sqlText); };
    es.addEventListener("note:changed", handler);
    es.addEventListener("table:changed", handler);
    return () => es.close();
  }, [isQuery, liveSync, sqlText]);

  const ghost = (label, active, onClick, title) => (
    <span onClick={onClick} title={title} style={{
      padding: "3px 9px", border: `1px solid ${active ? T.duck + "66" : T.border2}`,
      borderRadius: 5, cursor: "pointer", fontSize: 11, fontFamily: T.mono,
      color: active ? T.duck : T.muted, background: active ? T.duck + "11" : "transparent",
      userSelect: "none",
    }}>{label}</span>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T.bg }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px",
        borderBottom: `1px solid ${T.border}`, background: T.surface, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.duck, fontWeight: 600 }}>{name}.duckdb</span>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.muted }}>· {result.rowCount ?? result.rows.length} rows</span>
        <span style={{ color: T.border2, margin: "0 3px" }}>|</span>
        {ghost("⌘ Query", queryOpen, () => setQueryOpen(o => !o), "Toggle SQL query pane")}
        {ghost("≡ Table", dataView === "table", () => toggleDataView("table"), "Table view")}
        {ghost("⊞ Cards", dataView === "cards", () => toggleDataView("cards"), "Card view")}
        <span style={{ color: T.border2, margin: "0 3px" }}>|</span>
        {ghost("↓ Export", false, () => exportCsv(result), "Download as CSV")}
        <span style={{ flex: 1 }} />
        {isQuery && ghost(liveSync ? "⊙ Live" : "⊙ Lock", liveSync, toggleLive,
          liveSync ? "Re-runs on note changes. Click to lock." : "Locked. Click for live sync.")}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Query pane */}
        <div style={{
          width: queryOpen ? 300 : 0, overflow: "hidden", flexShrink: 0,
          borderRight: queryOpen ? `1px solid ${T.border}` : "none",
          background: T.surface, display: "flex", flexDirection: "column",
          transition: "width .2s ease",
        }}>
          <div style={{ padding: "7px 12px", fontSize: 10, color: T.muted, letterSpacing: ".07em",
            fontFamily: T.mono, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>
            SQL · QUERY
          </div>
          <div ref={cmRef} style={{ flex: 1, overflow: "auto" }} />
          <div style={{ padding: "8px 12px" }}>
            <span onClick={() => fetchCustom(cmViewRef.current?.state.doc.toString())} style={{
              display: "inline-block", padding: "4px 12px", background: T.surface2,
              border: `1px solid ${T.duck}44`, color: T.duck, borderRadius: 5,
              fontSize: 11, fontFamily: T.mono, cursor: "pointer",
            }}>▶ Run <span style={{ color: T.muted, marginLeft: 4 }}>⌘↵</span></span>
          </div>
        </div>

        {/* Data pane */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {error && <div style={{ padding: "10px 14px", color: T.red || "#f87171", fontFamily: T.mono, fontSize: 12 }}>{error}</div>}
          {loading && <div style={{ padding: "10px 14px", color: T.muted, fontFamily: T.mono, fontSize: 12 }}>Loading…</div>}
          {!loading && dataView === "table" && (
            <TableDataView result={result} T={T} onCellBlur={handleCellBlur} onAddRow={handleAddRow} />
          )}
          {!loading && dataView === "cards" && (
            <CardDataView result={result} T={T} onCellBlur={handleCellBlur} onAddRow={handleAddRow} />
          )}
        </div>
      </div>
    </div>
  );
}

function exportCsv({ columns, rows }) {
  if (!columns?.length) return;
  const header = columns.join(",");
  const body   = rows.map(r => columns.map(c => JSON.stringify(r[c] ?? "")).join(",")).join("\n");
  const blob   = new Blob([header + "\n" + body], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "export.csv"; a.click();
}

function TableDataView({ result, T, onCellBlur, onAddRow }) {
  const { columns, rows } = result;
  if (!columns?.length) return (
    <div style={{ padding: 20, color: T.muted, fontFamily: T.mono, fontSize: 12 }}>
      No data. Run a query or add rows.
    </div>
  );
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: T.mono }}>
      <thead>
        <tr>
          {columns.map(c => (
            <th key={c} style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 500,
              color: T.muted, letterSpacing: ".06em", textTransform: "uppercase",
              borderBottom: `1px solid ${T.border}`, background: T.surface, whiteSpace: "nowrap" }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={{ borderBottom: `1px solid ${T.border}` }}>
            {columns.map(c => (
              <td key={c} contentEditable suppressContentEditableWarning
                onBlur={e => onCellBlur(ri, c, e.currentTarget.textContent)}
                onFocus={e => e.currentTarget.style.background = T.surface2}
                onBlurCapture={e => e.currentTarget.style.background = "transparent"}
                style={{ padding: "7px 12px", color: T.textDim, outline: "none", whiteSpace: "nowrap" }}>
                {String(row[c] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={columns.length}>
            <button onClick={onAddRow} style={{
              padding: "8px 12px", color: T.muted, fontSize: 11, fontFamily: T.mono,
              cursor: "pointer", textAlign: "left", width: "100%", background: "transparent",
              border: "none", borderTop: `1px solid ${T.border}`,
            }}
            onMouseEnter={e => e.currentTarget.style.color = T.duck}
            onMouseLeave={e => e.currentTarget.style.color = T.muted}>
              + Add row
            </button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function CardDataView({ result, T, onCellBlur, onAddRow }) {
  const { columns, rows } = result;
  if (!columns?.length) return <div style={{ padding: 20, color: T.muted, fontFamily: T.mono, fontSize: 12 }}>No data.</div>;
  const titleCol  = columns[0];
  const otherCols = columns.slice(1);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 10, padding: 14 }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
          <div contentEditable suppressContentEditableWarning
            onBlur={e => onCellBlur(ri, titleCol, e.currentTarget.textContent)}
            style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6, outline: "none" }}>
            {String(row[titleCol] ?? "")}
          </div>
          {otherCols.map(c => (
            <div key={c} style={{ fontSize: 11, color: T.muted, marginBottom: 3, fontFamily: T.mono }}>
              {c}:{" "}
              <span contentEditable suppressContentEditableWarning
                onBlur={e => onCellBlur(ri, c, e.currentTarget.textContent)}
                style={{ color: T.textDim, outline: "none" }}>
                {String(row[c] ?? "")}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div onClick={onAddRow}
        onMouseEnter={e => e.currentTarget.style.color = T.duck}
        onMouseLeave={e => e.currentTarget.style.color = T.muted}
        style={{ border: `1px dashed ${T.border2}`, borderRadius: 8, display: "flex",
          alignItems: "center", justifyContent: "center", color: T.muted,
          cursor: "pointer", minHeight: 100, fontSize: 12, fontFamily: T.mono }}>
        + Add row
      </div>
    </div>
  );
}

// ── TableEmbed — inline in notes for ![[name.duckdb]]

export function TableEmbed({ name, T, onOpen }) {
  const [view,    setView]    = useState(() => localStorage.getItem(`ee-embed-view-${name}`) ?? "table");
  const [result,  setResult]  = useState({ columns: [], rows: [], rowCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/table/${enc(name)}`)
      .then(r => r.json())
      .then(res => { setResult(res); setLoading(false); })
      .catch(() => setLoading(false));
  }, [name]);

  function toggleView() {
    const next = view === "table" ? "chips" : "table";
    setView(next);
    localStorage.setItem(`ee-embed-view-${name}`, next);
  }

  const { columns, rows, rowCount } = result;

  return (
    <div style={{ margin: "12px 0", border: `1px solid ${T.border}`, borderRadius: 8,
      overflow: "hidden", background: T.surface }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
        borderBottom: `1px solid ${T.border}`, background: T.surface2 }}>
        <svg width="12" height="11" viewBox="0 0 24 22" fill="none" aria-hidden>
          <ellipse cx="13" cy="14" rx="9" ry="7" fill="#facc15"/>
          <circle cx="20" cy="7" r="4.5" fill="#facc15"/>
          <circle cx="21.5" cy="5.5" r="1" fill="#0d0d0d"/>
          <path d="M23.5 7.5 L26.5 8 L23.5 9Z" fill="#fb923c"/>
        </svg>
        <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 600, color: T.duck }}>{name}.duckdb</span>
        {!loading && <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>· {rowCount ?? rows.length} rows</span>}
        <span style={{ flex: 1 }} />
        <span onClick={toggleView} title="Toggle view" style={{
          fontSize: 10, color: T.muted, border: `1px solid ${T.border2}`, padding: "2px 7px",
          borderRadius: 4, cursor: "pointer", fontFamily: T.mono,
        }}>{view === "table" ? "⊞" : "≡"}</span>
        <span onClick={() => onOpen(name, "table")} style={{
          fontSize: 10, color: T.muted, border: `1px solid ${T.border2}`, padding: "2px 7px",
          borderRadius: 4, cursor: "pointer", fontFamily: T.mono, marginLeft: 3,
        }}>Open ↗</span>
      </div>
      {loading && <div style={{ padding: "10px 12px", color: T.muted, fontFamily: T.mono, fontSize: 11 }}>Loading…</div>}
      {!loading && view === "table" && columns.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: T.mono }}>
            <thead>
              <tr>
                {columns.map(c => (
                  <th key={c} style={{ padding: "5px 10px", textAlign: "left", fontSize: 9, fontWeight: 500,
                    color: T.muted, letterSpacing: ".06em", textTransform: "uppercase",
                    borderBottom: `1px solid ${T.border}`, background: T.surface, whiteSpace: "nowrap" }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row, ri) => (
                <tr key={ri} style={{ borderBottom: `1px solid ${T.border}` }}>
                  {columns.map(c => (
                    <td key={c} style={{ padding: "5px 10px", color: T.textDim, whiteSpace: "nowrap" }}>
                      {String(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && view === "chips" && rows.length > 0 && (
        <div style={{ padding: "8px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rows.map((row, ri) => {
            const vals = columns.slice(0, 2).map(c => String(row[c] ?? "")).join(" · ");
            const statusCol = columns.find(c => /status|state|stage/i.test(c));
            const dotColor  = statusCol ? statusColor(String(row[statusCol] ?? "")) : T.muted;
            return (
              <span key={ri} style={{ background: T.surface2, border: `1px solid ${T.border2}`,
                borderRadius: 12, padding: "3px 10px", fontSize: 11, fontFamily: T.mono, color: T.textDim }}>
                <span style={{ color: dotColor, fontSize: 8, marginRight: 4 }}>●</span>{vals}
              </span>
            );
          })}
        </div>
      )}
      {!loading && !columns.length && (
        <div style={{ padding: "10px 12px", color: T.muted, fontFamily: T.mono, fontSize: 11 }}>Empty table</div>
      )}
    </div>
  );
}

function statusColor(val) {
  const v = val.toLowerCase();
  if (/offer|accepted|done|complet/.test(v)) return "#60a5fa";
  if (/interview|progress|review/.test(v))   return "#4ade80";
  if (/applied|pending|wait/.test(v))        return "#facc15";
  if (/reject|declin|cancel/.test(v))        return "#f87171";
  return "#5a5a5a";
}
