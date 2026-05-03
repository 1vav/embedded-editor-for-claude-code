// src/selection-formatter.js

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : "");
// Prevent user content from closing the <editor-selection> block prematurely.
const escBody = s => String(s ?? "").replace(/<\/editor-selection/gi, "‹/editor-selection");

export function formatSelectionAsText(sel) {
  if (!sel) return "";
  const lines = [];

  const safeAttr = s => String(s ?? "").replace(/["<>&]/g, "");
  lines.push(`<editor-selection type="${safeAttr(sel.type)}" file="${safeAttr(sel.file)}">`);

  if (sel.type === "markdown") {
    lines.push(`Selected text (lines ${sel.startLine ?? "?"}–${sel.endLine ?? "?"}, cols ${sel.startCol ?? "?"}–${sel.endCol ?? "?"}):`);
    lines.push("");
    const rawText = escBody(sel.selectedText ?? "");
    const text = rawText.length > 2000 ? rawText.slice(0, 2000) + "…" : rawText;
    for (const l of text.split("\n")) lines.push(`  "${l}"`);
    lines.push("");
    if (sel.headingPath?.length) lines.push(`Location: ${sel.headingPath.map(escBody).join(" > ")}`);
    if (sel.contextBefore) lines.push(`Before: "${escBody(sel.contextBefore)}"`);
    if (sel.contextAfter) lines.push(`After: "${escBody(sel.contextAfter)}"`);
    if (sel.totalLines != null) lines.push(`Document: ${sel.totalLines} lines (position ~${sel.positionPct ?? "?"}%)`);
    if (sel.frontmatter && Object.keys(sel.frontmatter).length > 0) {
      const fm = Object.entries(sel.frontmatter)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.map(escBody).join(", ")}]` : escBody(v)}`)
        .join(", ");
      lines.push(`Frontmatter: ${fm}`);
    }

  } else if (sel.type === "excalidraw") {
    const els = (sel.selectedElements || []).slice(0, 20);
    lines.push(`${els.length} shape${els.length !== 1 ? "s" : ""} selected:`);
    lines.push("");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const label = el.text ? ` "${escBody(el.text)}"` : "";
      lines.push(`${i + 1}. ${cap(el.type)}${label} at (${Math.round(el.x)},${Math.round(el.y)}) ${Math.round(el.width)}×${Math.round(el.height)}px`);
      for (const b of (el.boundElements || [])) {
        const arrowLabel = b.arrowLabel ? ` "${escBody(b.arrowLabel)}"` : "";
        const target = b.connectedElementText ? ` "${escBody(b.connectedElementText)}"` : "";
        const arrow = b.direction === "out" ? "→" : "←";
        lines.push(`   ${arrow} arrow${arrowLabel} ${arrow}${target}`);
      }
      if (el.frameName) lines.push(`   Inside frame: "${escBody(el.frameName)}"`);
    }
    if ((sel.selectedElements || []).length > 20)
      lines.push(`   … and ${sel.selectedElements.length - 20} more`);
    lines.push("");
    lines.push(`Scene: ${sel.totalElements} elements total`);

  } else if (sel.type === "tldraw") {
    const shapes = (sel.selectedShapes || []).slice(0, 20);
    lines.push(`${shapes.length} shape${shapes.length !== 1 ? "s" : ""} selected:`);
    lines.push("");
    for (let i = 0; i < shapes.length; i++) {
      const sh = shapes[i];
      const subtype = sh.geo ? ` (${sh.geo})` : "";
      const label = sh.text ? ` "${escBody(sh.text)}"` : "";
      lines.push(`${i + 1}. ${cap(sh.type)}${subtype}${label} at (${Math.round(sh.x)},${Math.round(sh.y)}) ${Math.round(sh.width)}×${Math.round(sh.height)}px`);
      for (const a of (sh.connectedArrows || [])) {
        const arrowLabel = a.arrowLabel ? ` "${escBody(a.arrowLabel)}"` : "";
        const other = a.otherEndText ? ` "${escBody(a.otherEndText)}"` : "";
        const arrow = a.direction === "out" ? "→" : "←";
        lines.push(`   ${arrow} arrow${arrowLabel} ${arrow}${other}`);
      }
      if (sh.parentFrameName) lines.push(`   Parent frame: "${escBody(sh.parentFrameName)}"`);
    }
    if ((sel.selectedShapes || []).length > 20)
      lines.push(`   … and ${sel.selectedShapes.length - 20} more`);
    lines.push("");
    lines.push(`Canvas: ${sel.totalShapes} shapes total`);

  } else if (sel.type === "duckdb") {
    const rows = (sel.selectedRows || []).slice(0, 50);
    const rowNums = rows.map(r => r.rowIndex + 1).join(",");
    lines.push(`${rows.length} row${rows.length !== 1 ? "s" : ""} selected from table "${escBody(sel.tableName)}" (rows ${rowNums} of ${sel.totalRows}):`);
    lines.push("");
    const schema = (sel.schema || []).map(s => `${s.column} ${s.type}`).join(", ");
    lines.push(`Schema: ${schema}`);
    lines.push("");
    for (const row of rows) {
      const vals = Object.entries(row.data)
        .map(([k, v]) => `${k}=${v === null || v === undefined ? "NULL" : escBody(String(v))}`)
        .join("  ");
      lines.push(`Row ${row.rowIndex + 1}: ${vals}`);
    }
    if ((sel.selectedRows || []).length > 50)
      lines.push(`… and ${sel.selectedRows.length - 50} more rows`);
    if (sel.currentQuery) {
      lines.push("");
      lines.push(`Query: ${escBody(sel.currentQuery)}`);
    }
  }

  lines.push("</editor-selection>");
  return lines.join("\n");
}
