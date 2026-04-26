import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import DOMPurify from "dompurify";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Tldraw, getSnapshot, loadSnapshot, toRichText, createShapeId } from "@tldraw/tldraw";
import "tldraw/tldraw.css";
import MarkdownIt from "markdown-it";
import { TableView, TableEmbed } from "./DuckDBView.jsx";
import { PdfView } from "./PdfView.jsx";
import { CsvView } from "./CsvView.jsx";

// ─── CodeMirror ───────────────────────────────────────────────────────────────

import { EditorView, ViewPlugin, Decoration, WidgetType, lineNumbers, highlightActiveLine, keymap } from "@codemirror/view";
import { EditorState, Compartment, RangeSetBuilder, RangeSet } from "@codemirror/state";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, syntaxTree, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, startCompletion, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap } from "@codemirror/search";
// Bundled languages (always in main chunk)
import { markdown } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python }     from "@codemirror/lang-python";
import { json as jsonLang } from "@codemirror/lang-json";

// Language loader registry — bundled langs resolve synchronously, lazy ones split into chunks
const LANG_LOADERS = {
  js:   () => Promise.resolve(javascript()),
  mjs:  () => Promise.resolve(javascript()),
  cjs:  () => Promise.resolve(javascript()),
  jsx:  () => Promise.resolve(javascript({ jsx: true })),
  ts:   () => Promise.resolve(javascript({ typescript: true })),
  tsx:  () => Promise.resolve(javascript({ jsx: true, typescript: true })),
  py:   () => Promise.resolve(python()),
  json: () => Promise.resolve(jsonLang()),
  jsonc:() => Promise.resolve(jsonLang()),
  json5:() => Promise.resolve(jsonLang()),
  // Lazy — esbuild splits these into separate chunks
  css:  () => import("@codemirror/lang-css").then(m => m.css()),
  scss: () => import("@codemirror/lang-css").then(m => m.css()),
  less: () => import("@codemirror/lang-css").then(m => m.css()),
  html: () => import("@codemirror/lang-html").then(m => m.html()),
  htm:  () => import("@codemirror/lang-html").then(m => m.html()),
  xml:  () => import("@codemirror/lang-xml").then(m => m.xml()),
  xhtml:() => import("@codemirror/lang-xml").then(m => m.xml()),
  go:   () => import("@codemirror/lang-go").then(m => m.go()),
  rs:   () => import("@codemirror/lang-rust").then(m => m.rust()),
  java: () => import("@codemirror/lang-java").then(m => m.java()),
  c:    () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  cpp:  () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  cc:   () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  h:    () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  hpp:  () => import("@codemirror/lang-cpp").then(m => m.cpp()),
  sql:  () => import("@codemirror/lang-sql").then(m => m.sql()),
  md:   () => import("@codemirror/lang-markdown").then(m => m.markdown()),
  yaml: () => import("@codemirror/lang-yaml").then(m => m.yaml()),
  yml:  () => import("@codemirror/lang-yaml").then(m => m.yaml()),
  sh:   () => import("@codemirror/legacy-modes/mode/shell").then(m => import("@codemirror/language").then(l => l.StreamLanguage.define(m.shell))),
  bash: () => import("@codemirror/legacy-modes/mode/shell").then(m => import("@codemirror/language").then(l => l.StreamLanguage.define(m.shell))),
  zsh:  () => import("@codemirror/legacy-modes/mode/shell").then(m => import("@codemirror/language").then(l => l.StreamLanguage.define(m.shell))),
  toml: () => import("@codemirror/legacy-modes/mode/toml").then(m => import("@codemirror/language").then(l => l.StreamLanguage.define(m.toml))),
};

const langCache = new Map(); // extension → loaded extension (cached after first load)

function getLangExtension(filename) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (langCache.has(ext)) return Promise.resolve(langCache.get(ext));
  const loader = LANG_LOADERS[ext];
  if (!loader) return Promise.resolve(null);
  return loader().then(langExt => { langCache.set(ext, langExt); return langExt; }).catch(() => null);
}

function makeEditorTheme(T) {
  return EditorView.theme({
    "&":                       { height: "100%", background: T.bg, color: T.text },
    ".cm-scroller":            { fontFamily: T.mono, fontSize: "13px", lineHeight: "1.7", overflow: "auto" },
    ".cm-content":             { caretColor: T.accent, padding: "0 0 40px 0" },
    ".cm-gutters":             { background: T.surface, borderRight: `1px solid ${T.border}`, color: T.muted, minWidth: "3ch" },
    ".cm-lineNumbers .cm-gutterElement": { paddingRight: "12px", paddingLeft: "8px" },
    ".cm-foldGutter .cm-gutterElement": { paddingRight: "4px" },
    ".cm-activeLine":          { background: T.surface2 + "60" },
    ".cm-activeLineGutter":    { background: T.surface3 + "80" },
    ".cm-selectionBackground, ::selection": { background: T.accent + "30 !important" },
    ".cm-cursor":              { borderLeftColor: T.accent },
    ".cm-focused":             { outline: "none" },
    ".cm-matchingBracket":     { background: T.accent + "25", outline: `1px solid ${T.accent}60` },
    ".cm-searchMatch":         { background: T.orange + "40" },
    ".cm-searchMatch.cm-searchMatch-selected": { background: T.orange + "80" },
    ".cm-panels":              { background: T.surface, borderTop: `1px solid ${T.border}` },
    ".cm-panels input":        { background: T.surface2, border: `1px solid ${T.border2}`, color: T.text, borderRadius: 4, padding: "2px 6px", fontFamily: T.mono, fontSize: 11 },
    ".cm-panels button":       { background: T.surface3, border: `1px solid ${T.border2}`, color: T.textDim, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: T.mono, fontSize: 11 },
    ".cm-tooltip":             { background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 6, color: T.text },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { background: T.surface3 },
  }, { dark: T.isDark });
}

function makeNoteEditorTheme(T, S = NOTE_STYLES[0], C = null) {
  const N = C ? { ...T, ...C } : T;
  return EditorView.theme({
    "&":            { height: "100%", background: N.surface, color: N.text },
    ".cm-scroller": { fontFamily: S.noteFont, fontSize: S.fontSize, lineHeight: S.lineHeight, overflow: "auto" },
    ".cm-content":  { caretColor: N.accent, padding: "28px 32px 60px", maxWidth: S.maxWidth, margin: "0 auto", boxSizing: "content-box", fontFamily: S.noteFont },
    ".cm-line":     { padding: "0" },
    ".cm-activeLine":   { background: N.surface2 + "40" },
    ".cm-selectionBackground, ::selection": { background: N.accent + "30 !important" },
    ".cm-cursor":   { borderLeftColor: N.accent },
    ".cm-focused":  { outline: "none" },
    ".cm-panels":   { background: N.surface, borderTop: `1px solid ${N.border}` },
    ".cm-panels input":  { background: N.surface2, border: `1px solid ${N.border2}`, color: N.text, borderRadius: 4, padding: "2px 6px", fontFamily: T.mono, fontSize: 11 },
    ".cm-panels button": { background: N.surface3, border: `1px solid ${N.border2}`, color: N.textDim, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: T.mono, fontSize: 11 },
    // Live preview decoration styles
    ".cm-md-hidden":   { fontSize: "0", lineHeight: "0" },
    ".cm-md-h1":       { fontSize: "1.4em", fontWeight: "700" },
    ".cm-md-h2":       { fontSize: "1.15em", fontWeight: "700" },
    ".cm-md-h3":       { fontSize: "1em", fontWeight: "700", opacity: "0.8" },
    ".cm-md-h1-line":  { paddingTop: "28px", paddingBottom: "6px" },
    ".cm-md-h2-line":  { paddingTop: "20px", paddingBottom: "5px" },
    ".cm-md-h3-line":  { paddingTop: "14px", paddingBottom: "4px" },
    ".cm-md-bold":     { fontWeight: "bold" },
    ".cm-md-italic":   { fontStyle: "italic" },
    ".cm-md-strike":   { textDecoration: "line-through" },
    ".cm-md-code":     { fontFamily: T.mono, background: N.surface2 + "aa", borderRadius: "3px", padding: "0 3px", fontSize: "0.88em" },
    ".cm-md-link":     { color: N.blue },
    ".cm-md-wikilink": { color: N.blue, cursor: "pointer" },
    ".cm-md-hr":       { display: "block", borderTop: `1px solid ${N.border}`, margin: "0.5em 0", height: "0", width: "100%" },
    // Slash-command autocomplete popup
    ".cm-tooltip":                                    { background: N.surface, border: `1px solid ${N.border2}`, borderRadius: "8px", boxShadow: "0 8px 28px rgba(0,0,0,.45)", overflow: "hidden", padding: "3px 0" },
    ".cm-tooltip-autocomplete ul":                    { fontFamily: T.mono, margin: 0, padding: 0, listStyle: "none" },
    ".cm-tooltip-autocomplete ul li":                 { padding: "6px 14px", display: "flex", alignItems: "baseline", gap: "10px", cursor: "pointer" },
    ".cm-tooltip-autocomplete ul li[aria-selected]":  { background: N.surface3 },
    ".cm-completionLabel":                            { flex: "1", color: N.text, fontSize: "12px" },
    ".cm-completionDetail":                           { color: N.muted, fontSize: "11px", fontStyle: "normal", flexShrink: 0 },
  }, { dark: N.isDark });
}

// ─── CM6 Markdown Live Preview ────────────────────────────────────────────────

class HRWidget extends WidgetType {
  toDOM() {
    const d = document.createElement("div");
    d.className = "cm-md-hr";
    d.setAttribute("aria-hidden", "true");
    return d;
  }
  eq() { return true; }
  ignoreEvent() { return true; }
}
const HR_WIDGET = new HRWidget();

const HIDDEN = Decoration.mark({ class: "cm-md-hidden" });

function buildMarkdownDecorations(view) {
  const { state } = view;
  const cursorHead = state.selection.main.head;
  const cursorLine = state.doc.lineAt(cursorHead).number;
  const onCursorLine = (from, to) => {
    const lineA = state.doc.lineAt(from).number;
    const lineB = state.doc.lineAt(Math.max(from, to - 1)).number;
    // Only suppress single-line nodes on the cursor line — multi-line containers must
    // still be descended so their children on non-cursor lines get decorated.
    return lineA === lineB && lineA === cursorLine;
  };
  // All marks go into one builder (marks can overlap). HR widget replaces go into a second.
  const markDecs = [];
  const hrDecs = [];
  const lineDecs = [];
  const vFrom = view.visibleRanges[0]?.from ?? 0;
  const vTo   = view.visibleRanges[view.visibleRanges.length - 1]?.to ?? state.doc.length;

  syntaxTree(state).iterate({
    from: vFrom, to: vTo,
    enter(node) {
      const { from, to, name } = node;
      if (onCursorLine(from, to)) return false;
      switch (name) {
        case "FencedCode": case "CodeBlock": case "HTMLBlock": return false;
        case "ATXHeading1":
          markDecs.push({ from, to, dec: Decoration.mark({ class: "cm-md-h1" }) });
          lineDecs.push({ from: state.doc.lineAt(from).from, dec: Decoration.line({ class: "cm-md-h1-line" }) });
          break;
        case "ATXHeading2":
          markDecs.push({ from, to, dec: Decoration.mark({ class: "cm-md-h2" }) });
          lineDecs.push({ from: state.doc.lineAt(from).from, dec: Decoration.line({ class: "cm-md-h2-line" }) });
          break;
        case "ATXHeading3": case "ATXHeading4": case "ATXHeading5": case "ATXHeading6":
          markDecs.push({ from, to, dec: Decoration.mark({ class: "cm-md-h3" }) });
          lineDecs.push({ from: state.doc.lineAt(from).from, dec: Decoration.line({ class: "cm-md-h3-line" }) });
          break;
        case "HeaderMark": {
          const extra = state.doc.sliceString(to, to + 1) === " " ? 1 : 0;
          markDecs.push({ from, to: to + extra, dec: HIDDEN }); break;
        }
        case "StrongEmphasis": markDecs.push({ from, to, dec: Decoration.mark({ class: "cm-md-bold" }) }); break;
        case "Emphasis":       markDecs.push({ from, to, dec: Decoration.mark({ class: "cm-md-italic" }) }); break;
        case "Strikethrough":  markDecs.push({ from, to, dec: Decoration.mark({ class: "cm-md-strike" }) }); break;
        case "EmphasisMark": case "StrikethroughMark":
          markDecs.push({ from, to, dec: HIDDEN }); break;
        case "InlineCode": markDecs.push({ from, to, dec: Decoration.mark({ class: "cm-md-code" }) }); break;
        case "CodeMark":   markDecs.push({ from, to, dec: HIDDEN }); break;
        case "Link": case "Image": markDecs.push({ from, to, dec: Decoration.mark({ class: "cm-md-link" }) }); break;
        case "LinkMark": case "URL": case "LinkTitle":
          markDecs.push({ from, to, dec: HIDDEN }); break;
        case "HorizontalRule":
          hrDecs.push({ from, to, dec: Decoration.replace({ widget: HR_WIDGET }) }); break;
      }
    },
  });

  // Wikilinks via regex (not in lezer-markdown AST)
  const text = state.doc.sliceString(vFrom, vTo);
  const wlRe = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let wm;
  while ((wm = wlRe.exec(text)) !== null) {
    const wFrom = vFrom + wm.index, wTo = wFrom + wm[0].length;
    if (onCursorLine(wFrom, wTo)) continue;
    const wlName = wm[1]; const label = wm[2];
    markDecs.push({ from: wFrom, to: wTo, dec: Decoration.mark({ class: "cm-md-wikilink" }) });
    markDecs.push({ from: wFrom, to: wFrom + 2, dec: HIDDEN });                             // [[
    if (label) markDecs.push({ from: wFrom + 2, to: wFrom + 2 + wlName.length + 1, dec: HIDDEN }); // name|
    markDecs.push({ from: wTo - 2, to: wTo, dec: HIDDEN });                                 // ]]
  }

  const byPos = (a, b) => a.from !== b.from ? a.from - b.from : a.to - b.to;
  markDecs.sort(byPos);

  const mb = new RangeSetBuilder();
  for (const { from, to, dec } of markDecs) mb.add(from, to, dec);
  const sets = [mb.finish()];

  if (hrDecs.length > 0) {
    hrDecs.sort(byPos);
    const hb = new RangeSetBuilder();
    for (const { from, to, dec } of hrDecs) hb.add(from, to, dec);
    sets.push(hb.finish());
  }

  if (lineDecs.length > 0) {
    lineDecs.sort((a, b) => a.from - b.from);
    const lb = new RangeSetBuilder();
    for (const { from, dec } of lineDecs) lb.add(from, from, dec);
    sets.push(lb.finish());
  }

  return sets.length === 1 ? sets[0] : RangeSet.join(sets);
}

const markdownLivePreview = ViewPlugin.fromClass(class {
  constructor(view) {
    this.tree = syntaxTree(view.state);
    this.decorations = buildMarkdownDecorations(view);
  }
  update(update) {
    const tree = syntaxTree(update.state);
    if (update.docChanged || update.selectionSet || update.viewportChanged || tree !== this.tree) {
      this.tree = tree;
      this.decorations = buildMarkdownDecorations(update.view);
    }
  }
}, { decorations: v => v.decorations });

// ─── Markdown ─────────────────────────────────────────────────────────────────

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

// Per-file scroll position cache — persists across tab switches and diagram opens
const noteScrollCache = new Map();
md.enable("strikethrough");  // ~~strikethrough~~ (enabled explicitly; noop if already on)
const _fence = md.renderer.rules.fence.bind(md.renderer);
md.renderer.rules.fence = (tokens, idx, options, env, self) =>
  `<div class="code-block">${_fence(tokens, idx, options, env, self)}<button class="copy-btn">copy</button></div>`;

// External links: open in new tab, show URL in title, add visual indicator.
const _linkOpen = md.renderer.rules.link_open
  || ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const href = tokens[idx].attrGet("href") || "";
  if (/^https?:\/\//.test(href)) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel",    "noopener noreferrer");
    tokens[idx].attrSet("title",  href);
    tokens[idx].attrSet("data-external", "true");
  }
  return _linkOpen(tokens, idx, opts, env, self);
};

// Split raw markdown on ![[name.excalidraw]] and ![[name.tldraw]] embed markers.
// Returns [{type:"text",text}, {type:"diagram",name}, {type:"tldraw",name}, ...]
// Skips matches that fall inside fenced code blocks (``` ... ```) or inline code spans (` ... `).
function parseSegments(raw) {
  const codeRanges = [];
  const fenceRe = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;
  for (const fm of raw.matchAll(fenceRe)) codeRanges.push([fm.index, fm.index + fm[0].length]);
  const inlineRe = /`[^`\n]+`/g;
  for (const im of raw.matchAll(inlineRe)) codeRanges.push([im.index, im.index + im[0].length]);
  const inCode = (i) => codeRanges.some(([s, e]) => i >= s && i < e);

  // Collect all embed matches then sort by position
  const matches = [];
  const excRe = /!\[\[([^\]]+\.excalidraw)\]\]/gi;
  const tlRe  = /!\[\[([^\]]+\.tldraw)\]\]/gi;
  for (const m of raw.matchAll(excRe)) if (!inCode(m.index)) matches.push({ index: m.index, len: m[0].length, type: "diagram", name: m[1].replace(/\.excalidraw$/i, "").trim() });
  for (const m of raw.matchAll(tlRe))  if (!inCode(m.index)) matches.push({ index: m.index, len: m[0].length, type: "tldraw",  name: m[1].replace(/\.tldraw$/i, "").trim() });
  const dbRe = /!\[\[([^\]]+\.duckdb)\]\]/gi;
  for (const m of raw.matchAll(dbRe)) {
    if (!inCode(m.index)) matches.push({
      index: m.index, len: m[0].length, type: "duckdb",
      name: m[1].replace(/\.duckdb$/i, "").trim()
    });
  }
  matches.sort((a, b) => a.index - b.index);

  const segs = [];
  let last = 0;
  for (const hit of matches) {
    if (hit.index > last) segs.push({ type: "text", text: raw.slice(last, hit.index) });
    segs.push({ type: hit.type, name: hit.name });
    last = hit.index + hit.len;
  }
  if (last < raw.length) segs.push({ type: "text", text: raw.slice(last) });
  return segs.length ? segs : [{ type: "text", text: raw }];
}

// Convert [[name|label]] and [[name]] to annotated <a> tags, then run markdown-it.
// Skips replacements inside inline code spans or fenced code blocks.
function renderMd(text) {
  const codeRanges = [];
  const fenceRe = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;
  for (const fm of text.matchAll(fenceRe)) codeRanges.push([fm.index, fm.index + fm[0].length]);
  const inlineRe = /`[^`\n]+`/g;
  for (const im of text.matchAll(inlineRe)) codeRanges.push([im.index, im.index + im[0].length]);
  const inCode = (i) => codeRanges.some(([s, e]) => i >= s && i < e);

  const replace = (re, fn) => {
    let out = "", last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      out += text.slice(last, m.index);
      out += inCode(m.index) ? m[0] : fn(...m.slice(1));
      last = m.index + m[0].length;
    }
    return out + text.slice(last);
  };

  const pre = replace(
    /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
    (n, d) => `<a data-wl="${esc(n.trim())}" href="#">${d.trim()}</a>`
  );
  text = pre;
  const pre2 = replace(
    /\[\[([^\]]+)\]\]/g,
    (n) => `<a data-wl="${esc(n.trim())}" href="#">${n.trim()}</a>`
  );
  return DOMPurify.sanitize(md.render(pre2), { ADD_ATTR: ["data-wl", "data-external", "target", "rel"] });
}

function esc(s) { return String(s).replace(/"/g, "&quot;"); }

// Returns { fm: Object|null, body: string } where body has the frontmatter block removed.
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w][\w-]*):\s*(.*)/);
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["']|["']$/g, "");
    if (v === "true")  { fm[kv[1]] = true;  continue; }
    if (v === "false") { fm[kv[1]] = false; continue; }
    const n = Number(v);
    if (v !== "" && !isNaN(n)) { fm[kv[1]] = n; continue; }
    if (v.startsWith("[") && v.endsWith("]")) {
      fm[kv[1]] = v.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    fm[kv[1]] = v;
  }
  return { fm: Object.keys(fm).length ? fm : null, body: text.slice(m[0].length) };
}

function FrontmatterPanel({ fm, T }) {
  const [collapsed, setCollapsed] = React.useState(false);
  if (!fm) return null;

  function renderValue(v) {
    if (typeof v === "boolean") {
      return (
        <span style={{
          fontSize: 10, padding: "1px 7px", borderRadius: 10,
          background: v ? "#22c55e22" : T.surface2,
          color: v ? "#4ade80" : T.muted,
          border: `1px solid ${v ? "#4ade8044" : T.border2}`,
          fontFamily: T.mono,
        }}>{String(v)}</span>
      );
    }
    if (typeof v === "number") {
      return <span style={{ fontFamily: T.mono, color: T.text }}>{v}</span>;
    }
    if (Array.isArray(v)) {
      return (
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {v.map((item, i) => (
            <span key={i} style={{
              fontSize: 10, padding: "1px 7px", borderRadius: 10,
              background: T.surface2, color: T.textDim,
              border: `1px solid ${T.border2}`, fontFamily: T.mono,
            }}>{item}</span>
          ))}
        </span>
      );
    }
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d)) {
        return <span style={{ color: T.text, fontFamily: T.mono }}>{d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>;
      }
    }
    if (typeof v === "string" && /^https?:\/\//.test(v)) {
      return (
        <a href={v} target="_blank" rel="noopener noreferrer"
          style={{ color: T.accent, fontFamily: T.mono, fontSize: 12, textDecoration: "none" }}>
          {v.length > 50 ? v.slice(0, 50) + "…" : v}
        </a>
      );
    }
    return <span style={{ color: T.text, fontFamily: T.mono, fontSize: 12 }}>{String(v)}</span>;
  }

  return (
    <div style={{
      margin: "0 0 16px 0", border: `1px solid ${T.border}`,
      borderRadius: 6, overflow: "hidden", background: T.surface,
    }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 12px", cursor: "pointer",
          background: T.surface2, borderBottom: collapsed ? "none" : `1px solid ${T.border}`,
        }}
      >
        <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: T.muted, textTransform: "uppercase" }}>
          Properties
        </span>
        <span style={{ color: T.muted, fontSize: 10 }}>{collapsed ? "▸" : "▾"}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: "6px 0" }}>
          {Object.entries(fm).map(([k, v]) => (
            <div key={k} style={{
              display: "flex", alignItems: "flex-start", gap: 12,
              padding: "4px 12px",
            }}>
              <span style={{
                fontFamily: T.mono, fontSize: 11, color: T.muted,
                minWidth: 120, flexShrink: 0, paddingTop: 2,
              }}>{k}</span>
              <span style={{ flex: 1 }}>{renderValue(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const MONO      = "'JetBrains Mono','SF Mono','Cascadia Code',Menlo,monospace";
const NOTE_FONT = "ui-serif,Georgia,'Times New Roman',serif";

const NOTE_STYLES = [
  { id: "serif",    label: "Serif",    noteFont: NOTE_FONT,
    fontSize: "15px", lineHeight: "1.75", maxWidth: "720px", h1Border: true,  letterSpacing: null },
  { id: "sans",     label: "Sans",     noteFont: "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    fontSize: "15px", lineHeight: "1.65", maxWidth: "720px", h1Border: false, letterSpacing: null },
  { id: "literary", label: "Literary", noteFont: "'Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif",
    fontSize: "17px", lineHeight: "1.9",  maxWidth: "660px", h1Border: false, letterSpacing: "0.01em" },
  { id: "compact",  label: "Compact",  noteFont: "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    fontSize: "13px", lineHeight: "1.55", maxWidth: "800px", h1Border: true,  letterSpacing: null },
  { id: "mono",     label: "Mono",     noteFont: MONO,
    fontSize: "13px", lineHeight: "1.7",  maxWidth: "800px", h1Border: false, letterSpacing: null },
];

// null colors = follow the global app theme (DARK/LIGHT)
const NOTE_COLOR_PROFILES = [
  { id: "auto",   label: "Auto",   swatch: null, colors: null },
  { id: "sepia",  label: "Sepia",  swatch: "#c8a97e",
    colors: { bg: "#f8f1e4", surface: "#f2e8d5", surface2: "#e8dcc8", surface3: "#ddd0b8",
              text: "#3d2b1f", textDim: "#7a6250", muted: "#a08878", muted2: "#c8b09a",
              blue: "#8b5e3c", orange: "#c4651a", accent: "#9b7a4a",
              border: "#ddd0bd", border2: "#c8b89a", isDark: false } },
  { id: "paper",  label: "Paper",  swatch: "#1a1a1a",
    colors: { bg: "#ffffff", surface: "#f5f5f5", surface2: "#ebebeb", surface3: "#e0e0e0",
              text: "#0a0a0a", textDim: "#3a3a3a", muted: "#787878", muted2: "#c0c0c0",
              blue: "#0000cc", orange: "#880000", accent: "#000000",
              border: "#d8d8d8", border2: "#c0c0c0", isDark: false } },
  { id: "night",  label: "Night",  swatch: "#4a9eff",
    colors: { bg: "#0a0f1e", surface: "#101828", surface2: "#162034", surface3: "#1e2a40",
              text: "#c8d8f0", textDim: "#8090b0", muted: "#4a5a78", muted2: "#2a3550",
              blue: "#4a9eff", orange: "#ff9040", accent: "#4aefb0",
              border: "#1e2a40", border2: "#283850", isDark: true } },
  { id: "forest", label: "Forest", swatch: "#70b86a",
    colors: { bg: "#161c12", surface: "#1c2418", surface2: "#232c1e", surface3: "#2a3524",
              text: "#c4d8b0", textDim: "#8aaa78", muted: "#506840", muted2: "#304828",
              blue: "#70b86a", orange: "#c8a040", accent: "#90d870",
              border: "#2a3524", border2: "#384830", isDark: true } },
];

const DARK = {
  bg: "#0d0d0d", surface: "#141414", surface2: "#1a1a1a", surface3: "#212121",
  border: "#252525", border2: "#313131",
  text: "#e0e0e0", textDim: "#999", muted: "#5a5a5a", muted2: "#3a3a3a",
  accent: "#4ade80", blue: "#60a5fa", red: "#f87171", orange: "#fb923c",
  tldraw: "#a78bfa",
  duck: "#facc15",
  mono: MONO, noteFont: NOTE_FONT, isDark: true, excalidraw: "dark",
};

const LIGHT = {
  bg: "#f7f7f5", surface: "#ffffff", surface2: "#f0efec", surface3: "#e6e5e0",
  border: "#e2e1dd", border2: "#d0cfc9",
  text: "#1a1a18", textDim: "#55554f", muted: "#8a8a85", muted2: "#c8c7c2",
  accent: "#16a34a", blue: "#2563eb", red: "#dc2626", orange: "#c2410c",
  tldraw: "#7c3aed",
  duck: "#b45309",
  mono: MONO, noteFont: NOTE_FONT, isDark: false, excalidraw: "light",
};

const ThemeCtx = React.createContext(DARK);
const useT = () => React.useContext(ThemeCtx);

// ─── API ──────────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;
const j = (r) => r.json();

const api = {
  diagrams:  ()           => fetch("/api/diagrams").then(j),
  notes:     ()           => fetch("/api/notes").then(j),
  recent:    ()           => fetch("/api/recent").then(j),
  getDiag:   (n)          => fetch(`/api/diagram/${enc(n)}`).then(j),
  saveDiag:  (n, d)       => fetch(`/api/diagram/${enc(n)}`, { method: "PUT",   headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }),
  newDiag:   (n)          => fetch(`/api/diagram/${enc(n)}`, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "excalidraw", version: 2, title: n, elements: [], appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files: {} }) }),
  delDiag:   (n)          => fetch(`/api/diagram/${enc(n)}`, { method: "DELETE" }),
  getNote:   (n)          => fetch(`/api/note/${enc(n)}`).then(r => r.text()),
  saveNote:  (n, t)       => fetch(`/api/note/${enc(n)}`, { method: "PUT",   headers: { "Content-Type": "text/plain" }, body: t }),
  newNote:   (n)          => fetch(`/api/note/${enc(n)}`, { method: "POST",  headers: { "Content-Type": "text/plain" }, body: `# ${n}\n\n` }),
  delNote:   (n)          => fetch(`/api/note/${enc(n)}`, { method: "DELETE" }),
  rename:    (from, to, type) => fetch("/api/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from, to, type }) }).then(j),
  tldrawList: ()          => fetch("/api/tldraw").then(j),
  getTldraw:  (n)         => fetch(`/api/tldraw/${enc(n)}`).then(j),
  saveTldraw: (n, d)      => fetch(`/api/tldraw/${enc(n)}`, { method: "PUT",   headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }),
  newTldraw:  (n)         => fetch(`/api/tldraw/${enc(n)}`, { method: "POST",  headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }),
  delTldraw:  (n)         => fetch(`/api/tldraw/${enc(n)}`, { method: "DELETE" }),
  codeFiles: ()           => fetch("/api/code-files").then(j),
  getCode:   (n)          => fetch(`/api/code/${enc(n)}`).then(j),
  saveCode:  (n, text, crlf, bom) => fetch(`/api/code/${enc(n)}`, { method: "PUT",  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, crlf, bom }) }),
  newCode:   (n)          => fetch(`/api/code/${enc(n)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "", crlf: false, bom: false }) }),
  delCode:   (n)          => fetch(`/api/code/${enc(n)}`, { method: "DELETE" }),
  tables:    ()            => fetch("/api/tables").then(j),
  newTable:  (n, createdBy) => fetch(`/api/table/${enc(n)}`, { method: "POST", headers: { "Content-Type": "application/json", "Origin": location.origin }, body: JSON.stringify({ created_by: createdBy }) }),
  delTable:  (n)           => fetch(`/api/table/${enc(n)}`, { method: "DELETE", headers: { "Origin": location.origin } }),
  resolve:   (n)          => fetch(`/api/resolve/${enc(n)}`).then(j),
  backlinks: (n, type)    => fetch(`/api/backlinks/${enc(n)}?type=${type}`).then(j),
  history:   (n)          => fetch(`/api/history/${enc(n)}`).then(j),
  restore:   (n, ts)      => fetch(`/api/restore/${enc(n)}/${ts}`, { method: "POST" }),
  svgUrl:    (n)          => `/api/svg/${enc(n)}`,
  pngUrl:    (n)          => `/api/png/${enc(n)}`,
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useSSE(cb) {
  const [ok, setOk] = useState(false);
  const ref = useRef(cb); ref.current = cb;
  useEffect(() => {
    let es, t;
    const connect = () => {
      es = new EventSource("/events");
      es.onopen  = () => setOk(true);
      es.onerror = () => { setOk(false); es.close(); t = setTimeout(connect, 2500); };
      ["diagram:changed","diagram:deleted","note:changed","note:deleted","tldraw:changed","tldraw:deleted","code:changed","table:changed","table:deleted"]
        .forEach(ev => es.addEventListener(ev, e => ref.current(ev.split(":")[0], ev.split(":")[1], JSON.parse(e.data))));
    };
    connect();
    return () => { es?.close(); clearTimeout(t); };
  }, []);
  return ok;
}

function useDebounced(fn, ms) {
  const t = useRef(null);
  return useCallback((...a) => { clearTimeout(t.current); t.current = setTimeout(() => fn(...a), ms); }, [fn, ms]);
}

function useClickOutside(ref, fn) {
  const fnRef = useRef(fn); fnRef.current = fn;
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) fnRef.current(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []); // stable listener — never re-added
}

// Module-level constant so matchMedia is created only once, not on every render.
const _darkModeQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function useDarkMode() {
  const [dark, setDark] = useState(_darkModeQuery?.matches ?? false);
  useEffect(() => {
    if (!_darkModeQuery) return;
    const h = (e) => setDark(e.matches);
    _darkModeQuery.addEventListener("change", h);
    return () => _darkModeQuery.removeEventListener("change", h);
  }, []);
  return dark;
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Btn({ children, onClick, accent, small, disabled, title }) {
  const T = useT();
  const [h, sH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => sH(true)} onMouseLeave={() => sH(false)}
      disabled={disabled} title={title} style={{
        background: accent ? (h ? "#3ccf6e" : T.accent) : h ? T.surface3 : T.surface2,
        color: accent ? "#000" : h ? T.text : T.textDim,
        border: `1px solid ${accent ? "transparent" : T.border2}`,
        borderRadius: 5, padding: small ? "3px 8px" : "5px 12px",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? .4 : 1,
        fontFamily: T.mono, fontSize: small ? 10 : 12, fontWeight: accent ? 700 : 400,
        transition: "all .1s", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
      }}>
      {children}
    </button>
  );
}

function Ghost({ children, onClick, active, title, danger, pref }) {
  const T = useT();
  const [h, sH] = useState(false);
  // pref=true: preference/secondary controls — visually receded vs. mode buttons
  const bg    = pref
    ? (active ? T.surface2 : h ? T.surface : "transparent")
    : (active ? T.surface3 : h ? T.surface2 : "transparent");
  const bdr   = pref
    ? `1px solid ${active ? T.border : "transparent"}`
    : `1px solid ${active ? T.border2 : "transparent"}`;
  const color = danger ? T.red
    : pref  ? (active ? T.muted : h ? T.muted : T.muted2)
    : (active ? T.text : h ? T.textDim : T.muted);
  return (
    <button onClick={onClick} onMouseEnter={() => sH(true)} onMouseLeave={() => sH(false)} title={title} style={{
      background: bg, border: bdr, color,
      borderRadius: 5, padding: "3px 7px", cursor: "pointer",
      fontFamily: T.mono, fontSize: 12, transition: "all .1s",
      display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
    }}>
      {children}
    </button>
  );
}

// ─── Style Picker ─────────────────────────────────────────────────────────────

function StylePicker({ styleId, onChange }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const current = NOTE_STYLES.find(s => s.id === styleId) ?? NOTE_STYLES[0];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Ghost onClick={() => setOpen(o => !o)} active={open} title="Reading style" pref>
        Aa · {current.label}
      </Ghost>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 8,
          boxShadow: T.isDark ? "0 6px 24px rgba(0,0,0,.6)" : "0 6px 24px rgba(0,0,0,.15)",
          overflow: "hidden", zIndex: 200, minWidth: 180,
        }}>
          {NOTE_STYLES.map(s => {
            const active = s.id === styleId;
            return (
              <div key={s.id} onClick={() => { onChange(s.id); setOpen(false); }}
                style={{
                  padding: "9px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  background: active ? T.surface2 : "transparent",
                  borderBottom: `1px solid ${T.border}`,
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface3; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ fontFamily: s.noteFont, fontSize: 15, color: T.text, lineHeight: 1, flexShrink: 0, width: 18 }}>Aa</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: active ? T.text : T.textDim, fontWeight: active ? 700 : 400 }}>{s.label}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted, marginTop: 1 }}>{s.fontSize} · {s.lineHeight}lh</div>
                </div>
                {active && <span style={{ color: T.accent, fontSize: 11 }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Color Picker ─────────────────────────────────────────────────────────────

function ColorPicker({ colorId, onChange }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const current = NOTE_COLOR_PROFILES.find(p => p.id === colorId) ?? NOTE_COLOR_PROFILES[0];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Ghost onClick={() => setOpen(o => !o)} active={open} title="Color profile" pref>
        <span style={{
          display: "inline-block", width: 8, height: 8, borderRadius: "50%",
          background: current.swatch ?? (T.isDark ? "#555" : "#aaa"),
          border: `1px solid ${T.border2}`, flexShrink: 0,
        }} />
        {current.label}
      </Ghost>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 8,
          boxShadow: T.isDark ? "0 6px 24px rgba(0,0,0,.6)" : "0 6px 24px rgba(0,0,0,.15)",
          overflow: "hidden", zIndex: 200, minWidth: 160,
        }}>
          {NOTE_COLOR_PROFILES.map(p => {
            const active = p.id === colorId;
            return (
              <div key={p.id} onClick={() => { onChange(p.id); setOpen(false); }}
                style={{
                  padding: "9px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                  background: active ? T.surface2 : "transparent",
                  borderBottom: `1px solid ${T.border}`,
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface3; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  display: "inline-block", width: 12, height: 12, borderRadius: "50%", flexShrink: 0,
                  background: p.swatch ?? (T.isDark ? "#444" : "#ccc"),
                  border: `1px solid ${T.border2}`,
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: active ? T.text : T.textDim, fontWeight: active ? 700 : 400 }}>{p.label}</div>
                </div>
                {active && <span style={{ color: T.accent, fontSize: 11 }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── File Dropdown ────────────────────────────────────────────────────────────

function FileDropdown({ diagrams, tldrawFiles, notes, codeFiles, tableFiles, pdfFiles, csvFiles, recent, active, onOpen, onDelete, onClose }) {
  const T = useT();
  const [q,            setQ]            = useState("");
  const [filter,       setFilter]       = useState("all"); // all | drawings | notes | code | data
  const [openFolders, setOpenFolders] = useState(new Set()); // empty = all collapsed by default
  const ref = useRef();
  useClickOutside(ref, onClose);

  const toggleFolder = path => setOpenFolders(prev => {
    const next = new Set(prev);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });

  const allFiles = [
    ...diagrams.map(n => ({ name: n, type: "diagram" })),
    ...(tldrawFiles || []).map(n => ({ name: n, type: "tldraw" })),
    ...notes.map(n => ({ name: n, type: "note" })),
    ...(codeFiles || []).map(n => ({ name: n, type: "code" })),
    ...(tableFiles || []).map(n => ({ name: n, type: "table" })),
    ...(pdfFiles || []).map(n => ({ name: n, type: "pdf" })),
    ...(csvFiles || []).map(n => ({ name: n, type: "csv" })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const shown = allFiles.filter(f => {
    if (filter === "drawings" && f.type !== "diagram" && f.type !== "tldraw") return false;
    if (filter === "notes"    && f.type !== "note")    return false;
    if (filter === "code"     && f.type !== "code")    return false;
    if (filter === "data"     && f.type !== "table")   return false;
    if (filter === "pdf"      && f.type !== "pdf")     return false;
    if (filter === "csv"      && f.type !== "csv")     return false;
    return !q || f.name.toLowerCase().includes(q.toLowerCase());
  });

  const recentShown = recent.filter(r => {
    if (filter === "drawings" && r.type !== "diagram" && r.type !== "tldraw") return false;
    if (filter === "notes"    && r.type !== "note")    return false;
    if (filter === "code"     && r.type !== "code")    return false;
    if (filter === "data"     && r.type !== "table")   return false;
    if (filter === "pdf"      && r.type !== "pdf")     return false;
    if (filter === "csv"      && r.type !== "csv")     return false;
    return !q || r.name.toLowerCase().includes(q.toLowerCase());
  }).slice(0, 6);

  return (
    <div ref={ref} style={{
      position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
      width: 270, maxHeight: 420, background: T.surface,
      border: `1px solid ${T.border2}`, borderRadius: 8,
      boxShadow: "0 16px 48px rgba(0,0,0,.6)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Search */}
      <div style={{ padding: "8px 8px 4px", borderBottom: `1px solid ${T.border}` }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Escape" && onClose()}
          placeholder="filter files…" style={{
            width: "100%", boxSizing: "border-box",
            background: T.surface2, border: `1px solid ${T.border2}`,
            borderRadius: 5, color: T.text, fontFamily: T.mono, fontSize: 11,
            padding: "5px 8px", outline: "none",
          }} />
        <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
          {["all","drawings","notes","code","data","pdf","csv"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? T.surface3 : "transparent",
              border: `1px solid ${filter === f ? T.border2 : "transparent"}`,
              color: filter === f ? T.text : T.muted, borderRadius: 4,
              fontFamily: T.mono, fontSize: 9, padding: "2px 7px", cursor: "pointer",
              letterSpacing: ".04em",
            }}>{f}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Recent */}
        {recentShown.length > 0 && <>
          <DropSection label="RECENT">
            {recentShown.map(r => (
              <DropItem key={r.name + r.type} name={r.name} type={r.type}
                active={active?.name === r.name} sub={timeAgo(r.at)} title={r.name}
                onClick={() => { onOpen(r.name, r.type); onClose(); }}
                onDelete={() => onDelete(r.name, r.type)} />
            ))}
          </DropSection>
          {shown.length > 0 && <div style={{ height: 1, background: T.border, margin: "2px 0" }} />}
        </>}

        {/* All files */}
        {shown.length > 0 && (
          <DropSection label="FILES">
            {q ? shown.map(f => (
              <DropItem key={f.name + f.type} name={f.name} type={f.type}
                active={active?.name === f.name} title={f.name}
                onClick={() => { onOpen(f.name, f.type); onClose(); }}
                onDelete={() => onDelete(f.name, f.type)} />
            )) : (
              <FileTree node={buildFileTree(shown)} depth={0}
                openFolders={openFolders} toggleFolder={toggleFolder}
                active={active}
                onOpen={(name, type) => { onOpen(name, type); onClose(); }}
                onDelete={onDelete}
                pathPrefix="" />
            )}
          </DropSection>
        )}
        {shown.length === 0 && recentShown.length === 0 && (
          <div style={{ color: T.muted, fontFamily: T.mono, fontSize: 11, padding: "16px", textAlign: "center" }}>
            {q ? "no matches" : "no files yet"}
          </div>
        )}
      </div>
    </div>
  );
}

// Show beginning and end of long names so both the type and the unique part
// are visible. E.g. "Job Specific Re…Sachs.md" instead of "Job Specific Re…"
function midTruncate(s, max = 26) {
  if (s.length <= max) return s;
  const front = Math.ceil((max - 1) * 0.6);
  const back = max - 1 - front;
  return s.slice(0, front) + "…" + s.slice(-back);
}

function DropSection({ label, children }) {
  const T = useT();
  return (
    <div>
      <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: T.muted,
        letterSpacing: ".1em", padding: "8px 10px 3px" }}>{label}</div>
      {children}
    </div>
  );
}

function DropItem({ name, type, active, sub, onClick, onDelete, indent = 0, title }) {
  const T = useT();
  const [h, sH] = useState(false);
  const icon = type === "diagram" ? "⬡" : type === "tldraw" ? "◈" : type === "code" ? "</>" : (type === "table" || type === "pdf" || type === "csv") ? null : "¶";
  const iconColor = type === "diagram" ? T.accent : type === "tldraw" ? T.tldraw : type === "code" ? T.orange : type === "table" ? T.duck : type === "pdf" ? T.muted : type === "csv" ? T.muted : T.blue;
  return (
    <div onClick={onClick} onMouseEnter={() => sH(true)} onMouseLeave={() => sH(false)}
      title={title} style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: `5px 10px 5px ${10 + indent}px`,
        background: active ? T.surface3 : h ? T.surface2 : "transparent",
        borderLeft: `2px solid ${active ? T.accent : "transparent"}`,
        cursor: "pointer", transition: "background .08s", minWidth: 0,
      }}>
      {type === "table"
        ? <DuckBrandIcon size={10} />
        : type === "pdf"
          ? <span style={{ fontSize: 9, color: T.muted, flexShrink: 0, fontFamily: T.mono }}>PDF</span>
          : type === "csv"
            ? <span style={{ fontSize: 9, color: T.muted, flexShrink: 0, fontFamily: T.mono }}>CSV</span>
            : <span style={{ fontSize: 10, color: iconColor, flexShrink: 0 }}>{icon}</span>
      }
      <span style={{ flex: 1, minWidth: 0, fontFamily: T.mono, fontSize: 11,
        color: active ? T.text : T.textDim, whiteSpace: "nowrap" }}>{midTruncate(name)}</span>
      {sub && <span style={{ color: T.muted, fontSize: 9, fontFamily: T.mono, flexShrink: 0 }}>{sub}</span>}
      {h && <span onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{ color: T.red, fontSize: 11, lineHeight: 1, flexShrink: 0 }} title="delete">×</span>}
    </div>
  );
}

// ─── File tree ────────────────────────────────────────────────────────────────

function buildFileTree(files) {
  const root = { files: [], folders: {} };
  function add(node, file, remaining) {
    const slash = remaining.indexOf("/");
    if (slash === -1) {
      node.files.push({ name: remaining, fullPath: file.name, type: file.type });
    } else {
      const folder = remaining.slice(0, slash);
      const rest = remaining.slice(slash + 1);
      if (!node.folders[folder]) node.folders[folder] = { files: [], folders: {} };
      add(node.folders[folder], file, rest);
    }
  }
  for (const f of files) add(root, f, f.name);
  return root;
}

function FileTree({ node, depth, openFolders, toggleFolder, active, onOpen, onDelete, pathPrefix }) {
  const T = useT();
  const indent = depth * 12;
  return <>
    {Object.keys(node.folders).sort().map(folder => {
      const fullFolderPath = pathPrefix ? `${pathPrefix}/${folder}` : folder;
      const isOpen = openFolders.has(fullFolderPath);
      return (
        <div key={fullFolderPath}>
          <div onClick={() => toggleFolder(fullFolderPath)} style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: `3px 10px 3px ${10 + indent}px`,
            cursor: "pointer", userSelect: "none",
          }}>
            <span style={{
              fontSize: 7, color: T.muted, flexShrink: 0, lineHeight: 1,
              display: "inline-block", transition: "transform .12s",
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            }}>▶</span>
            <span style={{
              fontFamily: T.mono, fontSize: 10, color: T.muted, minWidth: 0,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{folder}/</span>
          </div>
          {isOpen && (
            <FileTree node={node.folders[folder]} depth={depth + 1}
              openFolders={openFolders} toggleFolder={toggleFolder}
              active={active} onOpen={onOpen} onDelete={onDelete}
              pathPrefix={fullFolderPath} />
          )}
        </div>
      );
    })}
    {node.files.map(f => (
      <DropItem key={f.fullPath + f.type} name={f.name} type={f.type}
        active={active?.name === f.fullPath} indent={indent} title={f.fullPath}
        onClick={() => onOpen(f.fullPath, f.type)}
        onDelete={() => onDelete(f.fullPath, f.type)} />
    ))}
  </>;
}

// ─── Brand logos ──────────────────────────────────────────────────────────────

// Official Markdown mark (solid variant) — dcurtis/markdown-mark
const MarkdownBrandIcon = ({ size = 13 }) => (
  <svg width={Math.round(size * 208 / 128)} height={size} viewBox="0 0 208 128" fill="currentColor" aria-label="Markdown">
    <path d="M193 128H15a15 15 0 0 1-15-15V15A15 15 0 0 1 15 0h178a15 15 0 0 1 15 15v98a15 15 0 0 1-15 15zM50 98V59l20 25 20-25v39h20V30H90L70 55 50 30H30v68zm134-34h-20V30h-20v34h-20l30 35z"/>
  </svg>
);

// Excalidraw brand — simplified diamond in Excalidraw's purple (#6965db)
const ExcalidrawBrandIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-label="Excalidraw">
    <rect width="20" height="20" rx="4" fill="#6965db"/>
    <path d="M10 4L16 10L10 16L4 10Z" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/>
    <path d="M6.5 10L9.5 7" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" opacity="0.55"/>
  </svg>
);

// Code editor icon — </> in a rounded square
const CodeBrandIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-label="Code editor">
    <rect width="20" height="20" rx="4" fill="#ea580c"/>
    <text x="10" y="14.5" textAnchor="middle" fill="#fff" fontSize="8.5" fontFamily="monospace" fontWeight="700">&lt;/&gt;</text>
  </svg>
);

// tldraw official favicon — tldraw/tldraw apps/dotcom/client/public/favicon.svg
const TldrawBrandIcon = ({ size = 13, isDark }) => (
  <svg width={size} height={size} viewBox="0 0 33 33" fill="none" aria-label="tldraw">
    <path d="M0.502 4.403C0.502 2.461 2.01 0.887 3.87 0.887H29.134C30.994 0.887 32.502 2.461 32.502 4.403V29.37C32.502 31.312 30.994 32.887 29.134 32.887H3.87C2.01 32.887 0.502 31.312 0.502 29.37V4.403Z"
      fill={isDark ? "#2a2a2a" : "#ffffff"} stroke={isDark ? "#555" : "#d0d0d0"} strokeWidth="0.8"/>
    <path d="M19.143 10.039C19.143 10.812 18.879 11.468 18.35 12.007C17.822 12.546 17.178 12.816 16.42 12.816C15.638 12.816 14.983 12.546 14.454 12.007C13.926 11.468 13.661 10.812 13.661 10.039C13.661 9.265 13.926 8.609 14.454 8.07C14.983 7.531 15.638 7.262 16.42 7.262C17.178 7.262 17.822 7.531 18.35 8.07C18.879 8.609 19.143 9.265 19.143 10.039ZM13.627 19.771C13.627 18.998 13.891 18.342 14.42 17.803C14.972 17.24 15.638 16.959 16.42 16.959C17.155 16.959 17.799 17.24 18.35 17.803C18.902 18.342 19.224 18.951 19.316 19.63C19.5 20.896 19.27 22.15 18.626 23.392C18.006 24.634 17.109 25.583 15.937 26.239C15.293 26.614 14.765 26.602 14.351 26.204C13.96 25.829 14.075 25.384 14.696 24.868C15.041 24.61 15.328 24.282 15.558 23.884C15.788 23.485 15.937 23.075 16.006 22.654C16.029 22.466 15.948 22.372 15.765 22.372C15.305 22.349 14.834 22.091 14.351 21.599C13.868 21.107 13.627 20.498 13.627 19.771Z"
      fill={isDark ? "#e0e0e0" : "#1a1a1a"}/>
  </svg>
);

const DuckBrandIcon = ({ size = 14 }) => (
  <svg width={size} height={Math.round(size * 0.93)} viewBox="0 0 24 22" fill="none" aria-label="duckdb">
    <ellipse cx="13" cy="14" rx="9" ry="7" fill="#facc15"/>
    <circle cx="20" cy="7" r="4.5" fill="#facc15"/>
    <circle cx="21.5" cy="5.5" r="1" fill="#0d0d0d"/>
    <path d="M23.5 7.5 L26.5 8 L23.5 9Z" fill="#fb923c"/>
    <ellipse cx="11" cy="13" rx="5" ry="3.5" fill="#facc1566" transform="rotate(-15 11 13)"/>
  </svg>
);

function BrandMark({ onHome }) {
  const T = useT();
  const dot = <span style={{ color: T.muted2, fontSize: 7, lineHeight: 1 }}>·</span>;
  return (
    <div onClick={onHome} title="Home"
      style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0,
        paddingRight: 8, borderRight: `1px solid ${T.border2}`,
        cursor: onHome ? "pointer" : "default", opacity: 1 }}>
      <span title="Markdown notes" style={{ display: "flex", color: T.text, opacity: 0.8 }}>
        <MarkdownBrandIcon size={13} />
      </span>
      {dot}
      <span title="Excalidraw diagrams" style={{ display: "flex" }}>
        <ExcalidrawBrandIcon size={14} />
      </span>
      {dot}
      <span title="tldraw diagrams" style={{ display: "flex" }}>
        <TldrawBrandIcon size={14} isDark={T.isDark} />
      </span>
      {dot}
      <span title="Code editor" style={{ display: "flex" }}>
        <CodeBrandIcon size={14} />
      </span>
      {dot}
      <span title="DuckDB tables" style={{ display: "flex" }}>
        <DuckBrandIcon size={14} />
      </span>
    </div>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────

function TopBar({ tabs, active, onSelect, onClose, onRename, onNew, onHome, connected,
  onExport, onHistory, diagrams, tldrawFiles, notes, codeFiles, tableFiles, pdfFiles, csvFiles, recent, onOpen, onDelete }) {
  const T = useT();
  const [dropOpen,  setDropOpen]  = useState(false);
  const [canLeft,   setCanLeft]   = useState(false);
  const [canRight,  setCanRight]  = useState(false);
  const tabsRef = useRef();

  // Recompute overflow arrows whenever tabs or container size change
  const updateOverflow = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    updateOverflow();
    const el = tabsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs, updateOverflow]);

  // Convert vertical wheel events to horizontal scroll on the tab strip
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const onWheel = (e) => {
      // If the gesture is primarily horizontal let the browser handle it
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
      updateOverflow();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [updateOverflow]);

  const scrollBy = (dir) => {
    tabsRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
    setTimeout(updateOverflow, 220);
  };

  // Shared style for the gradient-fade scroll arrow buttons
  const arrowBtn = (side) => ({
    position: "absolute", [side]: 0, top: 0, bottom: 0, zIndex: 10,
    display: "flex", alignItems: "center",
    background: side === "left"
      ? `linear-gradient(to right, ${T.bg} 55%, transparent)`
      : `linear-gradient(to left,  ${T.bg} 55%, transparent)`,
    border: "none", cursor: "pointer",
    color: T.textDim, fontSize: 14, lineHeight: 1,
    padding: side === "left" ? "0 12px 0 2px" : "0 2px 0 12px",
  });

  return (
    <div style={{ height: 40, background: T.bg, borderBottom: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", padding: "0 8px", gap: 4,
      flexShrink: 0, userSelect: "none", position: "relative",
    }}>
      <BrandMark onHome={onHome} />

      {/* File browser dropdown */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Ghost onClick={() => setDropOpen(o => !o)} active={dropOpen} title="Browse files">
          ≡ files {dropOpen ? "▴" : "▾"}
        </Ghost>
        {dropOpen && (
          <FileDropdown
            diagrams={diagrams} tldrawFiles={tldrawFiles} notes={notes} codeFiles={codeFiles} tableFiles={tableFiles} pdfFiles={pdfFiles} csvFiles={csvFiles}
            recent={recent} active={active}
            onOpen={(name, type) => { onOpen(name, type); }}
            onDelete={onDelete}
            onClose={() => setDropOpen(false)}
          />
        )}
      </div>

      <div style={{ width: 1, height: 14, background: T.border2, margin: "0 2px", flexShrink: 0 }} />

      {/* Scrollable tab strip — hidden scrollbar, gradient fade + arrow buttons on overflow */}
      <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", alignItems: "center" }}>
        {canLeft  && <button style={arrowBtn("left")}  onClick={() => scrollBy(-1)}>‹</button>}
        {canRight && <button style={arrowBtn("right")} onClick={() => scrollBy( 1)}>›</button>}
        <div ref={tabsRef} onScroll={updateOverflow}
          style={{ display: "flex", gap: 2, flex: 1, alignItems: "center",
            overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none" }}>
          {tabs.map(tab => (
            <FileTab key={tab.name + tab.type} tab={tab}
              active={active?.name === tab.name && active?.type === tab.type}
              onSelect={() => onSelect(tab)}
              onClose={() => onClose(tab)}
              onRename={(newName) => onRename(tab, newName)} />
          ))}
        </div>
      </div>

      {/* New-tab button — outside scroll area so it's always reachable */}
      <Ghost onClick={onNew} title="New file (⌘N)">＋</Ghost>

      {/* Right actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
        {active?.type === "diagram" && <>
          <Ghost onClick={onExport} title="Export">↑</Ghost>
          <Ghost onClick={onHistory} title="Version history — click to browse and restore past versions">⟳</Ghost>
        </>}
        <div style={{ width: 1, height: 14, background: T.border2, margin: "0 3px" }} />
        <div title={connected ? "Live sync on" : "Reconnecting…"} style={{
          width: 7, height: 7, borderRadius: "50%",
          background: connected ? T.accent : T.muted,
          boxShadow: connected ? `0 0 5px ${T.accent}88` : "none",
          transition: "all .4s",
        }} />
      </div>
    </div>
  );
}

function FileTab({ tab, active, onSelect, onClose, onRename }) {
  const T = useT();
  const [h,        sH]        = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameVal,  setNameVal]  = useState(tab.name);
  const tabRef   = useRef();
  const inputRef = useRef();

  // Scroll this tab into view whenever it becomes active
  useEffect(() => {
    if (active) tabRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [active]);

  const startRename = (e) => { e.stopPropagation(); setNameVal(tab.name); setRenaming(true); };
  useEffect(() => { if (renaming) inputRef.current?.select(); }, [renaming]);

  const commitRename = () => {
    const n = nameVal.trim();
    if (n && n !== tab.name) onRename(n); else setRenaming(false);
  };

  const icon = tab.type === "diagram" ? "⬡" : tab.type === "tldraw" ? "◈" : tab.type === "code" ? "</>" : "¶";
  const iconColor = tab.type === "diagram" ? T.accent : tab.type === "tldraw" ? T.tldraw : tab.type === "code" ? T.orange : T.blue;
  const short = tab.name.includes("/") ? tab.name.split("/").pop() : tab.name;

  return (
    <div ref={tabRef} onClick={onSelect} onMouseEnter={() => sH(true)} onMouseLeave={() => sH(false)}
      style={{
        display: "flex", alignItems: "center", gap: 4, padding: "3px 6px 3px 8px",
        borderRadius: 5, flexShrink: 0, maxWidth: 160,
        background: active ? T.surface2 : h ? T.surface : "transparent",
        border: `1px solid ${active ? T.border2 : "transparent"}`,
        cursor: "pointer", transition: "all .1s",
      }}>
      <span style={{ fontSize: 9, color: iconColor, flexShrink: 0 }}>{icon}</span>
      {renaming ? (
        <input ref={inputRef} value={nameVal}
          onChange={e => setNameVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
          onBlur={commitRename}
          onClick={e => e.stopPropagation()}
          style={{ background: T.surface3, border: `1px solid ${T.blue}`, borderRadius: 3,
            color: T.text, fontFamily: T.mono, fontSize: 11, padding: "1px 4px",
            outline: "none", width: `${Math.max(nameVal.length, 4)}ch`,
          }} />
      ) : (
        <span onDoubleClick={startRename}
          style={{ fontFamily: T.mono, fontSize: 11, color: active ? T.text : T.muted,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title="double-click to rename">
          {short}
        </span>
      )}
      <span onClick={e => { e.stopPropagation(); onClose(); }}
        style={{ color: T.muted2, fontSize: 11, lineHeight: 1, padding: "0 1px",
          transition: "color .1s", ...(h ? { color: T.red } : {}) }}>×</span>
    </div>
  );
}

// ─── Diagram Editor ───────────────────────────────────────────────────────────

function DiagramEditor({ name, onUserSave, onNavigate }) {
  const T = useT();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState(null);
  const dataRef = useRef(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    api.getDiag(name).then(d => {
      if (!d || !Array.isArray(d.elements)) {
        setErr(`"${name}" doesn't look like a diagram — is it a note?`);
        setLoading(false);
        return;
      }
      setData(d); dataRef.current = d; setLoading(false);
    }).catch(e => { setErr(e.message); setLoading(false); });
  }, [name]);

  const doSave = useCallback(async (elements, appState, files) => {
    if (!dataRef.current) return;
    const updated = { ...dataRef.current, elements, appState, files };
    dataRef.current = updated;
    await api.saveDiag(name, updated);
    onUserSave?.(name, "diagram");
  }, [name, onUserSave]);

  const debouncedSave = useDebounced(doSave, 900);

  // Handle Excalidraw element link clicks via the official onLinkOpen prop
  // (window.open interception doesn't work — preview pane blocks non-localhost URLs
  //  at the sandbox level before JS can intercept)
  const handleLinkOpen = useCallback((element, event) => {
    const url = element.link;
    if (typeof url === "string" && /^\[\[.+\]\]$/.test(url)) {
      event.preventDefault();
      onNavigate?.(url.slice(2, -2), "auto");
    }
    // otherwise let it fall through (Excalidraw will open in new tab)
  }, [onNavigate]);

  if (loading) return (
    <div style={{ flex: 1, background: T.isDark ? "#121212" : "#f0efec",
      display: "flex", alignItems: "center",
      justifyContent: "center", fontFamily: T.mono, fontSize: 12, color: T.muted }}>
      loading {name}…
    </div>
  );

  if (err) return (
    <div style={{ flex: 1, background: T.bg, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
      <div style={{ color: T.red, fontFamily: T.mono, fontSize: 13 }}>⚠ {err}</div>
      <div style={{ color: T.muted, fontFamily: T.mono, fontSize: 11 }}>
        Close this tab and reopen from the ≡ files menu.
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex" }}>
      {/* Image drag-drop is handled natively by Excalidraw; files are persisted via onChange → doSave */}
      <Excalidraw key={name}
        theme={T.excalidraw}
        initialData={{ elements: data?.elements || [], appState: { ...data?.appState, collaborators: [] }, files: data?.files ?? {} }}
        onChange={debouncedSave}
        onLinkOpen={handleLinkOpen} />
    </div>
  );
}

// ─── tldraw Editor ───────────────────────────────────────────────────────────

function TldrawEditor({ name, onUserSave }) {
  const T = useT();
  const [savedSnap, setSavedSnap] = useState(undefined);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getTldraw(name).then(data => {
      setSavedSnap(data && Object.keys(data).length > 0 ? data : null);
      setLoading(false);
    }).catch(() => { setSavedSnap(null); setLoading(false); });
  }, [name]);

  const handleMount = useCallback((editor) => {
    if (savedSnap) {
      try {
        if (savedSnap.seed) {
          // Seed format: array of simple shape descriptors, no schema/index management
          editor.createShapes(savedSnap.seed.map(s => ({
            id: createShapeId(),
            type: s.type,
            x: s.x ?? 0,
            y: s.y ?? 0,
            props: {
              ...s.props,
              ...(s.text !== undefined ? { richText: toRichText(s.text) } : {}),
            },
          })));
        } else {
          // Native tldraw snapshot from getSnapshot — use the standalone loadSnapshot function
          loadSnapshot(editor.store, savedSnap);
        }
        editor.zoomToFit({ animation: { duration: 0 } });
      } catch (e) {
        console.warn("tldraw load failed:", e);
      }
    }
    let timer;
    const dispose = editor.store.listen(() => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const snap = getSnapshot(editor.store);
        await api.saveTldraw(name, snap);
        onUserSave?.(name, "tldraw");
      }, 900);
    }, { scope: "document", source: "user" });
    return () => { dispose(); clearTimeout(timer); };
  }, [name, savedSnap, onUserSave]);

  if (loading) return (
    <div style={{ flex: 1, background: T.isDark ? "#1d1d1d" : "#f8f8f6",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: T.mono, fontSize: 12, color: T.muted }}>
      loading {name}…
    </div>
  );

  return (
    <div style={{ flex: 1, position: "relative" }}>
      {/* Image drag-drop handled natively by tldraw; assets persisted via store.listen → getSnapshot → saveTldraw */}
      {/* Known limitation: images are stored as dataURLs inside the tldraw snapshot JSON. Large images (≳3–4 MB
          decoded) may push the snapshot over the server's 5 MB readBody limit and be rejected. No workaround
          without raising the limit in src/viewer-server.js readBody(). */}
      <Tldraw
        key={name}
        onMount={handleMount}
        inferDarkMode
        autoFocus
      />
    </div>
  );
}

// ─── Note View ────────────────────────────────────────────────────────────────

function DiagramEmbed({ name, onOpen }) {
  const T = useT();
  const [h, sH] = useState(false);
  return (
    <div onClick={() => onOpen(name, "diagram")}
      onMouseEnter={() => sH(true)} onMouseLeave={() => sH(false)}
      style={{ margin: "16px 0", cursor: "pointer", borderRadius: 8, overflow: "hidden",
        border: `1px solid ${h ? T.accent : T.border2}`, transition: "border-color .15s" }}>
      <img src={api.pngUrl(name)} alt={name} style={{ width: "100%", display: "block" }} />
      <div style={{ padding: "6px 10px", background: T.surface2, fontFamily: T.mono,
        fontSize: 10, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: T.accent }}>⬡</span> {name}
        <span style={{ marginLeft: "auto", color: T.blue }}>open →</span>
      </div>
    </div>
  );
}

function TldrawEmbed({ name, onOpen }) {
  const T = useT();
  const [h, sH] = useState(false);
  return (
    <div onClick={() => onOpen(name, "tldraw")}
      onMouseEnter={() => sH(true)} onMouseLeave={() => sH(false)}
      style={{ margin: "16px 0", cursor: "pointer", borderRadius: 8, overflow: "hidden",
        border: `1px solid ${h ? T.tldraw : T.border2}`, transition: "border-color .15s" }}>
      <div style={{ height: 80, background: T.surface2, display: "flex", alignItems: "center",
        justifyContent: "center", color: T.tldraw, fontSize: 28 }}>◈</div>
      <div style={{ padding: "6px 10px", background: T.surface2, fontFamily: T.mono,
        fontSize: 10, color: T.muted, display: "flex", alignItems: "center", gap: 6,
        borderTop: `1px solid ${T.border}` }}>
        <span style={{ color: T.tldraw }}>◈</span> {name}
        <span style={{ marginLeft: "auto", color: T.blue }}>open →</span>
      </div>
    </div>
  );
}

// ─── Slash commands ───────────────────────────────────────────────────────────


// CM6 completion source that handles /diagram, /canvas, /note, /link commands.
// When a file is created with a description, fires a "slash-prompt" CustomEvent
// so the App-level PromptBar can pre-fill and auto-copy the Claude instruction.
function makeSlashSource() {
  const ALL_CMDS = ["diagram", "canvas", "note", "table", "query", "link"];
  const CMD_DETAIL = {
    diagram: "embed Excalidraw diagram",
    canvas:  "embed tldraw canvas",
    note:    "create & link a note",
    table:   "create DuckDB table",
    query:   "create DuckDB query view",
    link:    "link to existing file",
  };

  // Text-insert commands — insert Markdown syntax without creating files.
  const TEXT_CMDS = [
    { label: "heading1",  aliases: ["h1"],                    detail: "# Heading 1",    info: "Insert an H1 heading",        template: "# ",        cursorOffset: 2  },
    { label: "heading2",  aliases: ["h2"],                    detail: "## Heading 2",   info: "Insert an H2 heading",        template: "## ",       cursorOffset: 3  },
    { label: "heading3",  aliases: ["h3"],                    detail: "### Heading 3",  info: "Insert an H3 heading",        template: "### ",      cursorOffset: 4  },
    { label: "bullet",    aliases: ["ul", "list"],            detail: "- item",         info: "Insert a bullet list item",   template: "- ",        cursorOffset: 2  },
    { label: "todo",      aliases: ["task", "checkbox"],      detail: "- [ ] task",     info: "Insert a task checkbox",      template: "- [ ] ",    cursorOffset: 6  },
    { label: "callout",   aliases: ["quote", "blockquote"],   detail: "> blockquote",   info: "Insert a blockquote",         template: "> ",        cursorOffset: 2  },
    { label: "divider",   aliases: ["hr", "rule", "separator"], detail: "---",          info: "Insert a horizontal divider", template: "\n---\n",   cursorOffset: 5  },
    { label: "codeblock", aliases: ["code", "fence"],         detail: "```code```",     info: "Insert a fenced code block",  template: "```\n\n```", cursorOffset: 4 },
    { label: "bold",      aliases: ["b", "strong"],           detail: "**bold**",       info: "Insert bold text",            template: "****",      cursorOffset: 2  },
    { label: "italic",    aliases: ["i", "em"],               detail: "*italic*",       info: "Insert italic text",          template: "**",        cursorOffset: 1  },
  ];

  function applyTextCmd(view, completion, from, to) {
    view.dispatch({
      changes: { from, to, insert: completion.template },
      selection: { anchor: from + completion.cursorOffset },
    });
  }

  return async function slashSource(context) {
    const line = context.state.doc.lineAt(context.pos);
    const lineText = context.state.doc.sliceString(line.from, context.pos);
    // Match "/" followed by any word chars, then optionally a space + description.
    // Using [\w]* (not the alternation) so partial typing like /di, /dia also matches.
    const m = lineText.match(/^\/([\w]*)(\s+(.*))?$/);
    if (!m) return null;
    const cmdTyped = m[1].toLowerCase();          // "" | "d" | "di" | "diagram" | …
    const hasSpace = m[2] !== undefined;           // user pressed space after command
    const desc     = (m[3] || "").trim();

    // Still typing the command word — show matching commands as prefix completions
    if (!hasSpace) {
      const matchingFile = ALL_CMDS.filter(c => c.startsWith(cmdTyped));
      // For text commands, match against label and all aliases.
      const seenTextLabels = new Set();
      const matchingText = TEXT_CMDS.filter(c => {
        const labels = [c.label, ...(c.aliases ?? [])];
        return labels.some(l => l.startsWith(cmdTyped));
      }).filter(c => {
        if (seenTextLabels.has(c.label)) return false;
        seenTextLabels.add(c.label);
        return true;
      });
      if (matchingFile.length === 0 && matchingText.length === 0) return null;
      return {
        from: line.from, filter: false,
        options: [
          ...matchingFile.map((c, i) => ({
            label:  `/${c}`,
            detail: CMD_DETAIL[c],
            boost:  ALL_CMDS.length - i,
          })),
          ...matchingText.map((c, i) => ({
            label:  `/${c.label}`,
            detail: c.detail,
            info:   c.info,
            boost:  -(i + 1),
            apply:  (view, completion, from, to) => applyTextCmd(view, { ...c }, from, to),
            template: c.template,
            cursorOffset: c.cursorOffset,
          })),
        ],
      };
    }

    // Confirm the command is a known full word
    const cmd = ALL_CMDS.find(c => c === cmdTyped);
    if (!cmd) return null;


    // /link — show searchable list of all existing files
    if (cmd === "link") {
      const [diagrams, notes, tldraws, tables] = await Promise.all([
        api.diagrams().catch(() => []),
        api.notes().catch(() => []),
        api.tldrawList().catch(() => []),
        api.tables().catch(() => []),
      ]);
      const allOpts = [
        ...diagrams.map(n => ({ label: n, detail: "⬡ diagram", ftype: "diagram" })),
        ...notes.map(n =>    ({ label: n, detail: "¶ note",    ftype: "note"    })),
        ...tldraws.map(n =>  ({ label: n, detail: "◈ canvas",  ftype: "tldraw"  })),
        ...tables.map(n =>   ({ label: n, detail: "⬡ table",   ftype: "duckdb"  })),
      ];
      const opts = desc
        ? allOpts.filter(o => o.label.toLowerCase().includes(desc.toLowerCase()))
        : allOpts;
      return {
        from: line.from, filter: false,
        options: opts.map(o => ({
          label: o.label, detail: o.detail,
          apply(view, _, from) {
            const lineEnd = view.state.doc.lineAt(from).to;
            const insert  = o.ftype === "duckdb"  ? `![[${o.label}.duckdb]]`
                          : o.ftype === "diagram" ? `![[${o.label}.excalidraw]]`
                          : o.ftype === "tldraw"  ? `![[${o.label}.tldraw]]`
                          : `[[${o.label}]]`;
            view.dispatch({ changes: { from, to: lineEnd, insert }, selection: { anchor: from + insert.length } });
          },
        })),
      };
    }

    // /diagram, /canvas, /note — show a single "create" option
    const descPreview = desc ? (desc.length > 48 ? desc.slice(0, 48) + "…" : desc) : `empty ${cmd}`;
    return {
      from: line.from, filter: false,
      options: [{
        label:  desc ? `↵ ${descPreview}` : `create new ${cmd}`,
        detail: cmd === "diagram" ? "⬡ excalidraw" : cmd === "canvas" ? "◈ tldraw" : "¶ note",
        async apply(view, _, from) {
          // Auto-generate a short unique name — the description is the Claude prompt, not the filename
          const id   = Date.now().toString(36);          // e.g. "m5j3k2"
          const name = cmd === "table" ? `table-${id}`
                     : cmd === "query" ? `query-${id}`
                     : `${cmd}-${id}`;
          const lineEnd = view.state.doc.lineAt(from).to;
          let insert, claudePrompt;
          try {
            if (cmd === "diagram") {
              await api.newDiag(name);
              insert = `![[${name}.excalidraw]]`;
              if (desc) claudePrompt = `${desc}\n\nDiagram file: [[${name}.excalidraw]] (already created). Use the write_diagram MCP tool to populate it.`;
            } else if (cmd === "canvas") {
              await api.newTldraw(name);
              insert = `![[${name}.tldraw]]`;
              // tldraw is browser-only — no Claude prompt needed
            } else if (cmd === "note") {
              await api.newNote(name);
              insert = `[[${name}]]`;
              if (desc) claudePrompt = `${desc}\n\nNote file: [[${name}]] (already created). Use the write_note MCP tool to populate it.`;
            } else if (cmd === "table") {
              await api.newTable(name, "table");
              insert = `![[${name}.duckdb]]`;
              if (desc) claudePrompt = `${desc}\n\nTable file: [[${name}.duckdb]] (already created). Use create_table to define the schema (provide the table name and a CREATE TABLE SQL statement), then write_rows to populate it.`;
            } else if (cmd === "query") {
              await api.newTable(name, "query");
              insert = `![[${name}.duckdb]]`;
              if (desc) claudePrompt = `${desc}\n\nQuery file: [[${name}.duckdb]] (already created). Use query_table to scan files relative to this table's directory (supports read_csv('./glob'), read_json('./glob')) and save results as rows.`;
            }
          } catch (e) {
            console.error("[slash-cmd] create failed:", e);
            return;
          }
          view.dispatch({ changes: { from, to: lineEnd, insert }, selection: { anchor: from + insert.length } });
          if (claudePrompt) {
            document.dispatchEvent(new CustomEvent("slash-prompt", { detail: claudePrompt }));
          }
        },
      }],
    };
  };
}


function NoteView({ name, onNavigate, onUserSave }) {
  const T = useT();
  const [raw,       setRaw]       = useState("");
  const [loading,   setLoading]   = useState(true);
  const [mode,      setMode]      = useState("preview");
  const [blinks,    setBlinks]    = useState([]);
  const [showBL,    setShowBL]    = useState(false);
  const [dropPopup, setDropPopup] = useState(null);   // { file, x, y, pos }
  const [styleId,   setStyleId]   = useState(() => localStorage.getItem("ee-note-style") ?? "serif");
  const [colorId,   setColorId]   = useState(() => localStorage.getItem("ee-note-color") ?? "auto");
  const S = NOTE_STYLES.find(s => s.id === styleId) ?? NOTE_STYLES[0];
  const CP = NOTE_COLOR_PROFILES.find(p => p.id === colorId) ?? NOTE_COLOR_PROFILES[0];
  const C = CP.colors;
  const scrollRef      = useRef(null);  // preview scroll div
  const cmContainerRef = useRef(null);  // CM6 mount point
  const cmViewRef      = useRef(null);  // CM6 EditorView instance
  const noteThemeComp  = useRef(new Compartment());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getNote(name)
      .then(t  => { if (!cancelled) { setRaw(t); setLoading(false); } })
      .catch(e => { if (!cancelled) { console.error("note load failed:", e); setLoading(false); } });
    api.backlinks(name, "note")
      .then(bl => { if (!cancelled) setBlinks(bl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [name]);

  // Restore preview scroll after content loads
  useLayoutEffect(() => {
    if (!loading && scrollRef.current) {
      scrollRef.current.scrollTop = noteScrollCache.get(`${name}:preview`) ?? 0;
    }
  }, [name, loading]);

  // Save both scroll positions on unmount
  useEffect(() => {
    return () => {
      if (scrollRef.current) noteScrollCache.set(`${name}:preview`, scrollRef.current.scrollTop);
      if (cmViewRef.current) noteScrollCache.set(`${name}:edit`, cmViewRef.current.scrollDOM.scrollTop);
    };
  }, [name]);

  const doSave = useCallback(async (text) => {
    await api.saveNote(name, text);
    onUserSave?.(name, "note");
  }, [name, onUserSave]);

  const debouncedSave = useDebounced(doSave, 800);
  const debouncedSaveRef = useRef(debouncedSave);
  useEffect(() => { debouncedSaveRef.current = debouncedSave; }, [debouncedSave]);

  // Stable ref so the CM6 domEventHandlers closure can reach React state without stale captures
  const setDropPopupRef = useRef(setDropPopup);

  // Mount CM6 note editor once per note load; keep it alive across mode switches (hidden in preview)
  useEffect(() => {
    if (loading || !cmContainerRef.current) return;
    const slashExt = EditorView.updateListener.of(update => {
      if (!update.docChanged) return;
      // Re-trigger completion on every keystroke when the cursor line starts with "/"
      // (space after the command word would otherwise close the popup)
      const pos  = update.state.selection.main.head;
      const line = update.state.doc.lineAt(pos);
      const lineText = update.state.doc.sliceString(line.from, pos);
      if (/^\/\w/.test(lineText)) {
        startCompletion(update.view);
      }
    });
    const view = new EditorView({
      state: EditorState.create({
        doc: raw,  // capture initial content at mount time
        extensions: [
          markdown(),
          history(),
          keymap.of([...completionKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          markdownLivePreview,
          autocompletion({
            override: [makeSlashSource()],
            activateOnTyping: true,   // handles re-triggering as user types d,i,a,g…
            closeOnBlur: false,
            maxRenderedOptions: 12,
          }),
          // "/" is not a word char so activateOnTyping won't fire for it.
          // slashExt is defined above useEffect to avoid inline-function scope issues.
          slashExt,
          noteThemeComp.current.of(makeNoteEditorTheme(T, S, C)),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            const newText = update.state.doc.toString();
            setRaw(newText);
            debouncedSaveRef.current(newText);
          }),
          // Handle image file drops inside CM6 so it keeps its own drag-cursor behaviour.
          // dragover: set dropEffect but don't return true — CM6 continues and shows its cursor.
          // drop: intercept only image files; return true to suppress CM6's text-insert behaviour.
          EditorView.domEventHandlers({
            dragover(e) {
              if ([...(e.dataTransfer?.types ?? [])].includes("Files"))
                e.dataTransfer.dropEffect = "copy";
            },
            drop(e, view) {
              const file = [...(e.dataTransfer?.files ?? [])].find(f => f.type.startsWith("image/"));
              if (!file) return false;
              e.preventDefault();
              const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.doc.length;
              setDropPopupRef.current({ file, x: e.clientX, y: e.clientY, pos });
              return true;
            },
          }),
        ],
      }),
      parent: cmContainerRef.current,
    });
    cmViewRef.current = view;
    view.scrollDOM.scrollTop = noteScrollCache.get(`${name}:edit`) ?? 0;
    return () => { view.destroy(); cmViewRef.current = null; };
  }, [loading, name]); // `raw` and `mode` intentionally omitted — captured once at mount

  // Live-update note editor theme without recreating
  useEffect(() => {
    if (!cmViewRef.current) return;
    cmViewRef.current.dispatch({ effects: noteThemeComp.current.reconfigure(makeNoteEditorTheme(T, S, C)) });
  }, [T, S, C]);

  const switchMode = useCallback((newMode) => {
    if (newMode === mode) return;
    // Save current scroll + percentage. Both panes always have layout (visibility, not display:none)
    // so scrollHeight is always correct and scrollTop can be set even on the inactive pane.
    if (mode === "preview" && scrollRef.current) {
      const el = scrollRef.current;
      noteScrollCache.set(`${name}:preview`, el.scrollTop);
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) noteScrollCache.set(`${name}:pct`, el.scrollTop / max);
    }
    if (mode === "edit" && cmViewRef.current) {
      const el = cmViewRef.current.scrollDOM;
      noteScrollCache.set(`${name}:edit`, el.scrollTop);
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) noteScrollCache.set(`${name}:pct`, el.scrollTop / max);
    }
    // Restore target scroll synchronously before visibility flips — no rAF needed
    const pct = noteScrollCache.get(`${name}:pct`);
    if (newMode === "preview" && scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = pct != null
        ? Math.round(pct * Math.max(0, el.scrollHeight - el.clientHeight))
        : (noteScrollCache.get(`${name}:preview`) ?? 0);
    }
    if (newMode === "edit" && cmViewRef.current) {
      const el = cmViewRef.current.scrollDOM;
      el.scrollTop = pct != null
        ? Math.round(pct * Math.max(0, el.scrollHeight - el.clientHeight))
        : (noteScrollCache.get(`${name}:edit`) ?? 0);
    }
    setMode(newMode);
  }, [mode, name]);

  const handleClick = useCallback((e) => {
    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
      const pre = copyBtn.closest(".code-block")?.querySelector("pre");
      const text = pre?.textContent ?? "";
      const orig = copyBtn.textContent;
      const confirm = () => { copyBtn.textContent = "copied!"; setTimeout(() => { copyBtn.textContent = orig; }, 1500); };
      const fallback = () => {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        confirm();
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(confirm, fallback);
      } else {
        fallback();
      }
      return;
    }
    // External links — let the browser open them (target=_blank set by renderer)
    const extLink = e.target.closest("a[data-external]");
    if (extLink) return;  // don't preventDefault — browser handles it
    const wl = e.target.closest("[data-wl]");
    if (wl) { e.preventDefault(); onNavigate(wl.dataset.wl, "auto"); }
  }, [onNavigate]);

  const handleDropChoice = useCallback(async (choice) => {
    if (!dropPopup || !cmViewRef.current) return;
    const { file, pos } = dropPopup;
    setDropPopup(null);
    const view = cmViewRef.current;
    let mdSnippet;
    if (choice === "copy") {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const resp = await fetch("/api/asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, data: base64 }),
      });
      if (!resp.ok) { console.error("asset upload failed", await resp.text()); return; }
      const { path } = await resp.json();
      mdSnippet = `![${file.name}](${path})`;
    } else {
      mdSnippet = `![${file.name}](${file.name})`;
    }
    view.dispatch({ changes: { from: pos, insert: mdSnippet + "\n" } });
  }, [dropPopup]);

  const { fm: noteFm, body: rawBody } = useMemo(() => parseFrontmatter(raw), [raw]);
  const segs       = useMemo(() => parseSegments(rawBody), [rawBody]);
  const noteStyles = useMemo(() => makeNoteStyles(T, S, C), [T, S, C]);
  const N = C ? { ...T, ...C } : T;

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      background: T.bg, fontFamily: T.mono, fontSize: 12, color: T.muted }}>loading {name}…</div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: N.bg }}>
      {/* Note toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 14px",
        borderBottom: `1px solid ${T.border}`, flexShrink: 0, background: T.bg }}>
        <Ghost onClick={() => switchMode("preview")} active={mode === "preview"} small>preview</Ghost>
        <Ghost onClick={() => switchMode("edit")} active={mode === "edit"} small>edit</Ghost>
        <div style={{ flex: 1 }} />
        <StylePicker styleId={styleId} onChange={(id) => {
          setStyleId(id);
          localStorage.setItem("ee-note-style", id);
        }} />
        <ColorPicker colorId={colorId} onChange={(id) => {
          setColorId(id);
          localStorage.setItem("ee-note-color", id);
        }} />
        <div style={{ flex: 1 }} />
        {blinks.length > 0 && (
          <Ghost onClick={() => setShowBL(b => !b)} active={showBL} title="Backlinks">
            ← {blinks.length} link{blinks.length !== 1 ? "s" : ""}
          </Ghost>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Relative wrapper so both panes can be absolutely stacked.
            visibility:hidden (not display:none) keeps layout intact so scrollHeight
            and scrollTop work correctly even when the pane is not active. */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <div ref={cmContainerRef} style={{
            position: "absolute", inset: 0, overflow: "hidden",
            visibility: mode === "edit" ? "visible" : "hidden",
            pointerEvents: mode === "edit" ? "auto" : "none",
          }} />
          <div ref={scrollRef} style={{
            position: "absolute", inset: 0, overflow: "auto",
            visibility: mode === "preview" ? "visible" : "hidden",
            pointerEvents: mode === "preview" ? "auto" : "none",
          }}>
            <div onClick={handleClick} style={{ padding: "28px 32px", maxWidth: 720, margin: "0 auto" }}>
              <style>{noteStyles}</style>
              <FrontmatterPanel fm={noteFm} T={N} />
              {segs.map((seg) =>
                seg.type === "diagram" ? <DiagramEmbed key={`diagram:${seg.name}`} name={seg.name} onOpen={onNavigate} />
                : seg.type === "tldraw" ? <TldrawEmbed key={`tldraw:${seg.name}`} name={seg.name} onOpen={onNavigate} />
                : seg.type === "duckdb" ? <TableEmbed key={`duckdb:${seg.name}`} name={seg.name} T={N} onOpen={onNavigate} />
                : <div key={`text:${seg.text?.slice(0, 40)}`} className="note-body" dangerouslySetInnerHTML={{ __html: renderMd(seg.text) }} />
              )}
            </div>
          </div>
        </div>

        {/* Backlinks panel */}
        {showBL && (
          <div style={{ width: 200, borderLeft: `1px solid ${T.border}`, background: T.surface,
            overflow: "auto", flexShrink: 0 }}>
            <div style={{ padding: "10px 12px", fontFamily: T.mono, fontSize: 9,
              fontWeight: 700, color: T.muted, letterSpacing: ".1em",
              borderBottom: `1px solid ${T.border}` }}>BACKLINKS</div>
            {blinks.map(b => (
              <div key={b.name + b.type} onClick={() => onNavigate(b.name, b.type)}
                style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${T.border}`,
                  fontFamily: T.mono, fontSize: 11 }}>
                <span style={{ color: b.type === "diagram" ? T.accent : T.blue, marginRight: 5 }}>
                  {b.type === "diagram" ? "⬡" : "¶"}
                </span>
                <span style={{ color: T.textDim }}>{b.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {dropPopup && createPortal(
        <div style={{
          position: "fixed", left: dropPopup.x, top: dropPopup.y, zIndex: 9999,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
          boxShadow: "0 4px 16px rgba(0,0,0,.4)", padding: "10px 14px",
          fontFamily: T.mono, fontSize: 12, color: T.fg,
          display: "flex", flexDirection: "column", gap: 6, minWidth: 180,
        }}>
          <div style={{ color: T.muted, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Drop &quot;{dropPopup.file.name}&quot;
          </div>
          <button onClick={() => handleDropChoice("copy")}
            style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 4,
              padding: "4px 10px", cursor: "pointer", fontFamily: T.mono, fontSize: 12, textAlign: "left" }}>
            Copy to workspace
          </button>
          <button onClick={() => handleDropChoice("link")}
            style={{ background: "transparent", color: T.fg, border: `1px solid ${T.border}`,
              borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontFamily: T.mono, fontSize: 12, textAlign: "left" }}>
            Link in place
          </button>
          <button onClick={() => setDropPopup(null)}
            style={{ background: "transparent", color: T.muted, border: "none",
              cursor: "pointer", fontFamily: T.mono, fontSize: 11, textAlign: "right", padding: "2px 0 0" }}>
            cancel
          </button>
        </div>,
        document.body
      )}

    </div>
  );
}

// ─── Code Editor ──────────────────────────────────────────────────────────────

function CodeEditor({ name, onUserSave }) {
  const T = useT();
  const containerRef = useRef(null);
  const viewRef      = useRef(null);
  const themeComp    = useRef(new Compartment());
  const metaRef      = useRef(null); // always-current meta for the save callback
  const [meta,    setMeta]    = useState(null);   // {text,crlf,bom} | {binary:true} | null
  const [loading, setLoading] = useState(true);

  // Keep metaRef in sync
  useEffect(() => { metaRef.current = meta; }, [meta]);

  // Load file
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getCode(name).then(data => {
      if (!cancelled) { setMeta(data); metaRef.current = data; setLoading(false); }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name]);

  const doSave = useCallback(async (text) => {
    const m = metaRef.current;
    await api.saveCode(name, text, m?.crlf ?? false, m?.bom ?? false);
    onUserSave?.(name, "code");
  }, [name, onUserSave]);

  const debouncedSave = useDebounced(doSave, 800);
  const debouncedSaveRef = useRef(debouncedSave);
  useEffect(() => { debouncedSaveRef.current = debouncedSave; }, [debouncedSave]);

  // Mount / destroy editor
  useEffect(() => {
    if (loading || !containerRef.current || meta?.binary) return;
    const text = meta?.text ?? "";

    let view;
    getLangExtension(name).then(langExt => {
      const extensions = [
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
        ]),
        themeComp.current.of(makeEditorTheme(T)),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return;
          const newText = update.state.doc.toString();
          setMeta(m => ({ ...m, text: newText }));
          debouncedSaveRef.current(newText);
        }),
        EditorView.lineWrapping,
      ];
      if (langExt) extensions.push(langExt);

      view = new EditorView({
        state: EditorState.create({ doc: text, extensions }),
        parent: containerRef.current,
      });
      viewRef.current = view;
    });

    return () => { view?.destroy(); viewRef.current = null; };
  }, [loading, name]); // recreate editor when file changes; theme updates below

  // Live-update theme when T changes without recreating the editor
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({ effects: themeComp.current.reconfigure(makeEditorTheme(T)) });
  }, [T]);

  if (loading) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      background: T.bg, fontFamily: T.mono, fontSize: 12, color: T.muted }}>loading…</div>
  );

  if (meta?.binary) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: T.bg, fontFamily: T.mono, fontSize: 12, color: T.muted, gap: 8 }}>
      <span style={{ fontSize: 28 }}>🗃</span>
      <span>Binary file — cannot display</span>
      <span style={{ color: T.muted, fontSize: 11 }}>{name}</span>
    </div>
  );

  const ext = name.split(".").pop()?.toUpperCase() ?? "";
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T.bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
        borderBottom: `1px solid ${T.border}`, flexShrink: 0, fontFamily: T.mono, fontSize: 11, color: T.muted }}>
        <span style={{ color: T.orange, fontWeight: 600 }}>{ext || "TXT"}</span>
        <span style={{ color: T.border2 }}>·</span>
        <span>{name}</span>
        {meta?.crlf && <span style={{ marginLeft: "auto", color: T.muted, fontSize: 10 }}>CRLF</span>}
        {meta?.bom  && <span style={{ marginLeft: meta?.crlf ? 6 : "auto", color: T.muted, fontSize: 10 }}>BOM</span>}
      </div>
      <div ref={containerRef} style={{ flex: 1, overflow: "hidden" }} />
    </div>
  );
}

// CSS for note body content — called with the current theme object
function makeNoteStyles(T, S = NOTE_STYLES[0], C = null) {
  const N = C ? { ...T, ...C } : T;
  return `
  .note-body { color: ${N.text}; font-family: ${S.noteFont}; font-size: ${S.fontSize}; line-height: ${S.lineHeight}; ${S.letterSpacing ? `letter-spacing: ${S.letterSpacing};` : ""} }
  .note-body h1,.note-body h2,.note-body h3 { font-family: ${S.noteFont}; color: ${N.text}; font-weight: 700; }
  .note-body h1 { font-size: 1.4em; margin: 1.33em 0 .29em; ${S.h1Border ? `border-bottom: 1px solid ${N.border}; padding-bottom: .4em;` : ""} }
  .note-body h2 { font-size: 1.15em; margin: 1.16em 0 .29em; }
  .note-body h3 { font-size: 1em; margin: .93em 0 .27em; opacity: 0.8; }
  .note-body p { margin: .8em 0; }
  .note-body a[data-wl] { color: ${N.blue}; text-decoration: none; border-bottom: 1px solid ${N.blue}44; cursor: pointer; }
  .note-body a[data-wl]:hover { border-bottom-color: ${N.blue}; }
  .note-body a { color: ${N.blue}; }
  .note-body a[data-external]::after { content: " ↗"; font-size: 0.75em; opacity: 0.6; vertical-align: super; }
  .note-body a[data-external]:hover { text-decoration: underline; }
  .note-body code { font-family: ${T.mono}; font-size: .85em; background: ${N.surface2}; padding: .15em .35em; border-radius: 3px; color: ${N.orange}; }
  .note-body pre { background: ${N.surface2}; border: 1px solid ${N.border}; border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 1em 0; }
  .note-body pre code { background: none; padding: 0; color: ${N.text}; font-size: 12px; }
  .note-body .code-block { position: relative; }
  .note-body .copy-btn { position: absolute; top: 8px; right: 8px; opacity: 0.35; transition: opacity .15s; background: ${N.surface3}; border: 1px solid ${N.border2}; color: ${N.textDim}; font-family: ${T.mono}; font-size: 10px; padding: 2px 8px; border-radius: 4px; cursor: pointer; }
  .note-body .code-block:hover .copy-btn, .note-body .copy-btn:focus { opacity: 1; }
  .note-body .copy-btn:hover { color: ${N.text}; border-color: ${N.muted}; }
  .note-body blockquote { border-left: 3px solid ${N.border2}; margin: 0; padding: .1em 0 .1em 1em; color: ${N.textDim}; }
  .note-body ul,.note-body ol { padding-left: 1.5em; margin: .5em 0; }
  .note-body li { margin: .3em 0; }
  .note-body table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  .note-body th,.note-body td { border: 1px solid ${N.border2}; padding: 6px 10px; font-size: 13px; }
  .note-body th { background: ${N.surface2}; font-family: ${T.mono}; font-size: 11px; }
  .note-body hr { border: none; border-top: 1px solid ${N.border}; margin: 1.5em 0; }
  .note-body img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 0.75em 0; }
  .note-body video { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 0.75em 0; }
  .note-body audio { width: 100%; margin: 0.75em 0; display: block; }
  .note-body del { color: ${N.muted}; }
  .note-body input[type="checkbox"] { margin-right: 5px; }
`;}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ recent, onNew, onOpen }) {
  const T = useT();
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", background: T.bg, fontFamily: T.mono, gap: 20, padding: 40 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ display: "flex", color: T.text, opacity: 0.75 }}><MarkdownBrandIcon size={28} /></span>
        <span style={{ color: T.muted2, fontSize: 10 }}>·</span>
        <span style={{ display: "flex" }}><ExcalidrawBrandIcon size={30} /></span>
        <span style={{ color: T.muted2, fontSize: 10 }}>·</span>
        <span style={{ display: "flex" }}><TldrawBrandIcon size={30} isDark={T.isDark} /></span>
        <span style={{ color: T.muted2, fontSize: 10 }}>·</span>
        <span style={{ display: "flex" }}><CodeBrandIcon size={30} /></span>
        <span style={{ color: T.muted2, fontSize: 10 }}>·</span>
        <span style={{ display: "flex", color: "#facc15" }}><DuckBrandIcon size={30} /></span>
      </div>
      <div style={{ color: T.text, fontSize: 14, fontWeight: 700 }}>Embedded Editor</div>
      <div style={{ color: T.muted, fontSize: 11 }}>diagrams · canvases · notes · tables · wikilinks</div>
      {recent.length > 0 && (
        <div style={{ width: "min(380px,100%)", marginTop: 4 }}>
          <div style={{ color: T.muted, fontSize: 9, letterSpacing: ".1em", fontWeight: 700, marginBottom: 6 }}>RECENT</div>
          {recent.slice(0, 5).map(r => (
            <div key={r.name + r.type} onClick={() => onOpen(r.name, r.type)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", marginBottom: 3,
                background: T.surface, borderRadius: 6, border: `1px solid ${T.border}`, cursor: "pointer" }}>
              <span style={{ color: r.type === "diagram" ? T.accent : r.type === "tldraw" ? T.tldraw : T.blue, fontSize: 10 }}>
                {r.type === "diagram" ? "⬡" : r.type === "tldraw" ? "◈" : r.type === "code" ? "</>" : "¶"}
              </span>
              <span style={{ flex: 1, color: T.text, fontSize: 12 }}>{r.name}</span>
              <span style={{ color: T.muted, fontSize: 10 }}>{timeAgo(r.at)}</span>
            </div>
          ))}
        </div>
      )}
      <Btn onClick={onNew} accent>＋ new</Btn>
      <div style={{ color: T.muted2, fontSize: 10 }}>or use ≡ files to browse, or ask claude</div>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, width = 300 }) {
  const T = useT();
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 10,
        padding: "18px 20px", width, maxWidth: "90vw",
        boxShadow: "0 24px 64px rgba(0,0,0,.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: ".1em" }}>{title}</span>
          <Ghost onClick={onClose}>×</Ghost>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function DeleteModal({ name, onClose, onConfirm }) {
  const T = useT();
  return (
    <Modal title="DELETE FILE" onClose={onClose} width={320}>
      <div style={{ fontFamily: T.mono }}>
        <div style={{ color: T.text, fontSize: 13, marginBottom: 16 }}>
          Delete <span style={{ color: T.red }}>{name}</span>? This cannot be undone.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Btn onClick={onClose}>cancel</Btn>
          <Btn onClick={onConfirm} accent>delete</Btn>
        </div>
      </div>
    </Modal>
  );
}

function NewModal({ onClose, onCreate }) {
  const T = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState("diagram");
  const [err,  setErr]  = useState("");
  const ref = useRef();
  useEffect(() => ref.current?.focus(), []);

  const go = async () => {
    const n = name.trim();
    if (!n) { setErr("name required"); return; }
    if (!/^[\w][\w.\- ]*$/.test(n)) { setErr("letters, numbers, hyphens only"); return; }
    if (type === "diagram") await api.newDiag(n);
    else if (type === "tldraw") await api.newTldraw(n);
    else await api.newNote(n);
    onCreate(n, type);
  };

  return (
    <Modal title="NEW FILE" onClose={onClose}>
      <div style={{ fontFamily: T.mono }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[["diagram","⬡ excalidraw",T.accent],["tldraw","◈ tldraw",T.tldraw],["note","¶ note",T.blue]].map(([t,label,col]) => (
            <button key={t} onClick={() => setType(t)} style={{
              flex: 1, padding: "7px 0",
              background: type === t ? col + "22" : T.surface2,
              border: `1px solid ${type === t ? col : T.border2}`,
              borderRadius: 6, color: type === t ? col : T.textDim,
              fontFamily: T.mono, fontSize: 11, cursor: "pointer", fontWeight: type === t ? 700 : 400,
            }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ color: T.muted, fontSize: 10, marginBottom: 5 }}>$ name</div>
        <input ref={ref} value={name}
          onChange={e => { setName(e.target.value); setErr(""); }}
          onKeyDown={e => { if (e.key === "Enter") go(); }}
          placeholder={type === "diagram" ? "my-diagram" : "my-note"}
          style={{ width: "100%", boxSizing: "border-box", background: T.surface2,
            border: `1px solid ${err ? T.red : T.border2}`, borderRadius: 5,
            color: T.text, fontFamily: T.mono, fontSize: 13, padding: "7px 10px", outline: "none" }} />
        {err && <div style={{ color: T.red, fontSize: 11, marginTop: 4 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Btn onClick={onClose}>cancel</Btn>
          <Btn onClick={go} accent>create</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ExportModal({ name, onClose }) {
  const T = useT();
  const [status, setStatus] = useState("");
  const dl = async (url, filename) => {
    setStatus("downloading…");
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.statusText);
      const blob = await r.blob();
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      URL.revokeObjectURL(a.href); setStatus("✓ saved"); setTimeout(() => setStatus(""), 2000);
    } catch (e) { setStatus("failed: " + e.message); }
  };
  return (
    <Modal title={`EXPORT · ${name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[["SVG","vector · scalable",T.blue,api.svgUrl(name),`${name}.svg`],
          ["PNG","raster · 2×",T.accent,api.pngUrl(name),`${name}.png`]].map(([l,s,_c,u,f]) => {
          return (
            <div key={l} onClick={() => dl(u,f)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "11px 14px", background: T.surface2, borderRadius: 7,
                border: `1px solid ${T.border}`, cursor: "pointer",
                transition: "border-color .1s",
              }}>
              <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700, color: T.text }}>{l}</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.muted }}>{s}</span>
            </div>
          );
        })}
        {status && <div style={{ textAlign: "center", fontFamily: T.mono, fontSize: 11, color: T.muted, marginTop: 4 }}>{status}</div>}
      </div>
    </Modal>
  );
}

// ─── History Panel ────────────────────────────────────────────────────────────

function HistoryPanel({ name, onClose, onRestored }) {
  const T = useT();
  const [snaps,   setSnaps]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [doing,   setDoing]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.history(name)
      .then(s  => { if (!cancelled) { setSnaps(s); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name]);

  const restore = async (ts) => {
    setDoing(ts);
    try {
      await api.restore(name, ts);
      onRestored(); onClose();
    } catch (e) {
      console.error("restore failed:", e);
    } finally {
      setDoing(null);
    }
  };

  return (
    <div style={{ width: 230, background: T.surface, borderLeft: `1px solid ${T.border}`,
      display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, color: T.muted, letterSpacing: ".1em" }}>VERSION HISTORY</div>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted, marginTop: 3 }}>click any version to restore it</div>
        </div>
        <Ghost onClick={onClose}>×</Ghost>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {loading && <div style={{ color: T.muted, fontFamily: T.mono, fontSize: 11, padding: 12 }}>loading…</div>}
        {!loading && snaps.length === 0 && (
          <div style={{ color: T.muted, fontFamily: T.mono, fontSize: 10, padding: "14px 12px", lineHeight: 1.6 }}>
            No saved versions yet.<br />
            Versions are saved automatically as you edit.
          </div>
        )}
        {snaps.map(s => (
          <div key={s.ts} onClick={() => restore(s.ts)}
            title={`Restore diagram to this version\n${new Date(s.ts).toLocaleString()}`}
            style={{ padding: "9px 12px", cursor: doing === s.ts ? "wait" : "pointer",
              borderBottom: `1px solid ${T.border}`,
              background: doing === s.ts ? T.surface2 : "transparent",
              display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.text }}>{timeAgo(s.ts)}</div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.muted, marginTop: 2 }}>
                {new Date(s.ts).toLocaleString([], { month: "short", day: "numeric",
                  hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 9, flexShrink: 0, marginLeft: 8,
              color: doing === s.ts ? T.orange : T.muted }}>
              {doing === s.ts ? "restoring…" : "↩ restore"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Prompt Bar ───────────────────────────────────────────────────────────────

function PromptBar({ active }) {
  const T = useT();
  const [val,   setVal]   = useState("");
  const [toast, setToast] = useState("");
  const inputRef = useRef(null);

  // Listen for slash-command "slash-prompt" events and pre-fill the bar.
  // The slash command has already written the text to clipboard; we just show it
  // so the user knows what was copied and can edit/re-copy if needed.
  useEffect(() => {
    const handler = (e) => {
      setVal(e.detail);
      setToast("copied — paste into claude ⌘V");
      setTimeout(() => setToast(""), 3500);
      inputRef.current?.focus();
    };
    document.addEventListener("slash-prompt", handler);
    return () => document.removeEventListener("slash-prompt", handler);
  }, []);

  const copy = () => {
    if (!val.trim()) return;
    const label = active.type === "diagram" ? `diagram "${active.name}"` : `note "${active.name}.md"`;
    const text  = val.trim().startsWith("Please ") ? val.trim()
                : `Update the ${label}: ${val.trim()}`;
    const done = () => { setVal(""); setToast("copied — paste into claude ⌘V"); setTimeout(() => setToast(""), 3000); };
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch { setToast("clipboard unavailable"); }
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  };

  return (
    <div style={{ height: 44, background: T.bg, borderTop: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", padding: "0 12px", gap: 8, flexShrink: 0 }}>
      <span style={{ color: T.accent, fontFamily: T.mono, fontSize: 13, flexShrink: 0 }}>$</span>
      <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") copy(); }}
        placeholder={`ask claude to update "${active.name}"…`}
        style={{ flex: 1, background: "transparent", border: "none", outline: "none",
          color: T.text, fontFamily: T.mono, fontSize: 12 }} />
      {toast
        ? <span style={{ color: T.accent, fontSize: 11, fontFamily: T.mono, flexShrink: 0 }}>{toast}</span>
        : val.trim() && <Btn onClick={copy} accent small>copy ⏎</Btn>
      }
    </div>
  );
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return "now"; if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s/60) + "m"; if (s < 86400) return Math.floor(s/3600) + "h";
  return Math.floor(s/86400) + "d";
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const isDark = useDarkMode();
  const [diagrams,    setDiagrams]    = useState([]);
  const [tldrawFiles, setTldrawFiles] = useState([]);
  const [notes,       setNotes]       = useState([]);
  const [codeFiles,   setCodeFiles]   = useState([]);
  const [tableFiles,  setTableFiles]  = useState([]);
  const [pdfFiles,    setPdfFiles]    = useState([]);
  const [csvFiles,    setCsvFiles]    = useState([]);
  const [recent,      setRecent]      = useState([]); // [{name, type, at}]
  const [tabs,      setTabs]      = useState(() => { try { return JSON.parse(localStorage.getItem("ee-tabs") ?? "[]"); } catch { return []; } });
  const [active,    setActive]    = useState(() => { try { return JSON.parse(localStorage.getItem("ee-active") ?? "null"); } catch { return null; } });

  useEffect(() => { try { localStorage.setItem("ee-tabs", JSON.stringify(tabs)); } catch {} }, [tabs]);
  useEffect(() => { try { localStorage.setItem("ee-active", JSON.stringify(active)); } catch {} }, [active]);
  const [showHist,  setShowHist]  = useState(false);
  const [showExp,   setShowExp]   = useState(false);
  const [showNew,   setShowNew]   = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // {name, type} | null

  const recentSaves = useRef(new Set());

  const refresh = useCallback(async () => {
    const [d, tl, n, c, r] = await Promise.all([api.diagrams(), api.tldrawList(), api.notes(), api.codeFiles(), api.recent()]);
    setDiagrams(d); setTldrawFiles(tl); setNotes(n); setCodeFiles(c); setRecent(r);
    api.tables().then(setTableFiles).catch(() => {});
    fetch("/api/pdfs").then(r => r.json()).then(setPdfFiles).catch(() => {});
    fetch("/api/csvs").then(r => r.json()).then(setCsvFiles).catch(() => {});
  }, []);

  // Lightweight variant — only refreshes the recent list (skips 3 glob scans).
  // Used on save events for existing files where the file lists don't change.
  const refreshRecent = useCallback(async () => {
    const r = await api.recent();
    setRecent(r);
  }, []);

  useEffect(() => { refresh(); }, []);

  const connected = useSSE(useCallback((kind, ev, data) => {
    const key = `${data.name}:${kind}`;
    if (!recentSaves.current.has(key)) {
      // Use the lightweight refresh when we know the file lists haven't changed:
      // "updated" means an existing file was saved — no new name added to any list.
      // "created", "deleted", "renamed", or unknown op all require a full refresh.
      if (data.op === "updated") refreshRecent();
      else refresh();
    }
    if (kind === "table") {
      // "changed" with op=updated is already handled by refreshRecent() in the generic branch above
      if (ev === "changed" && data?.op !== "updated") refresh();
      if (ev === "deleted") refresh();
    }
    if (ev === "deleted" || (kind === "code" && data.op === "deleted")) {
      const type = kind === "code" ? "code" : kind;
      setTabs(t => t.filter(x => !(x.name === data.name && x.type === type)));
      setActive(a => (a?.name === data.name && a?.type === type) ? null : a);
    }
  }, [refresh, refreshRecent]));

  const CODE_EXTS_CLIENT = new Set([
    "js","mjs","cjs","jsx","ts","tsx","py","go","rs","java","c","cpp","cc","cxx","h","hpp",
    "cs","php","swift","kt","kts","scala","css","scss","sass","less","html","htm","xml","xhtml",
    "sh","bash","zsh","fish","ps1","bat","cmd","yaml","yml","toml","ini","conf","sql","txt",
    "log","csv","tsv","graphql","gql","proto","tf","hcl","json","jsonc","json5",
  ]);

  const openFile = useCallback(async (rawName, type) => {
    let name = rawName;
    let resolved = type;

    if (!type || type === "auto") {
      // If the name has a known code extension, open directly as code
      const dotExt = rawName.split(".").pop()?.toLowerCase();
      if (dotExt && CODE_EXTS_CLIENT.has(dotExt)) {
        const match = codeFiles.find(f => f.toLowerCase() === rawName.toLowerCase());
        resolved = "code";
        name = match ?? rawName;
        const tab = { name, type: resolved };
        setTabs(t => t.find(x => x.name === name && x.type === resolved) ? t : [...t, tab]);
        setActive(tab);
        return;
      }
      const lo = rawName.toLowerCase();
      const noteMatch  = notes.find(n => n.toLowerCase() === lo);
      const diagMatch  = diagrams.find(d => d.toLowerCase() === lo);
      const tldrMatch  = tldrawFiles.find(t => t.toLowerCase() === lo);
      const tableMatch = tableFiles.find(t => t.toLowerCase() === lo);
      const pdfMatch   = pdfFiles.find(p => p.toLowerCase() === lo);
      const csvMatch   = csvFiles.find(p => p.toLowerCase() === lo);

      if      (tableMatch)                               { resolved = "table";   name = tableMatch; }
      else if (pdfMatch)                                 { resolved = "pdf";     name = pdfMatch; }
      else if (csvMatch)                                 { resolved = "csv";     name = csvMatch; }
      else if (noteMatch && !diagMatch && !tldrMatch)    { resolved = "note";    name = noteMatch; }
      else if (diagMatch && !noteMatch && !tldrMatch)    { resolved = "diagram"; name = diagMatch; }
      else if (tldrMatch && !noteMatch && !diagMatch)    { resolved = "tldraw";  name = tldrMatch; }
      else if (!noteMatch && !diagMatch && !tldrMatch) {
        try {
          const r = await api.resolve(rawName);
          if (r.type) { resolved = r.type; name = r.name; }
          else resolved = "diagram";
        } catch { resolved = "diagram"; }
      } else {
        // Ambiguous — prefer note > excalidraw > tldraw
        if (noteMatch) { resolved = "note"; name = noteMatch; }
        else if (diagMatch) { resolved = "diagram"; name = diagMatch; }
        else { resolved = "tldraw"; name = tldrMatch; }
      }
    }

    const tab = { name, type: resolved };
    setTabs(t => t.find(x => x.name === name && x.type === resolved) ? t : [...t, tab]);
    setActive(tab);
  }, [notes, diagrams, tldrawFiles, tableFiles, pdfFiles, csvFiles]);

  const closeTab = useCallback((tab) => {
    setTabs(prev => {
      const idx  = prev.findIndex(t => t.name === tab.name && t.type === tab.type);
      const next = prev.filter((_, i) => i !== idx);
      setActive(a => {
        if (a?.name !== tab.name || a?.type !== tab.type) return a;
        return next[Math.min(idx, next.length - 1)] ?? null;
      });
      return next;
    });
  }, []);

  const handleRename = useCallback(async (tab, newName) => {
    const result = await api.rename(tab.name, newName, tab.type);
    if (result.ok) {
      // Evict stale scroll cache entries for the old name
      noteScrollCache.delete(`${tab.name}:preview`);
      noteScrollCache.delete(`${tab.name}:edit`);
      setTabs(t => t.map(x => x.name === tab.name && x.type === tab.type ? { ...x, name: newName } : x));
      setActive(a => a?.name === tab.name && a?.type === tab.type ? { ...a, name: newName } : a);
      await refresh();
    }
  }, [refresh]);

  const handleDelete = useCallback((name, type) => {
    setDeleteTarget({ name, type });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { name, type } = deleteTarget;
    setDeleteTarget(null);
    if (type === "diagram") await api.delDiag(name);
    else if (type === "tldraw") await api.delTldraw(name);
    else if (type === "code") await api.delCode(name);
    else if (type === "table") await api.delTable(name);
    else await api.delNote(name);
    // Evict scroll cache entries for deleted note
    noteScrollCache.delete(`${name}:preview`);
    noteScrollCache.delete(`${name}:edit`);
    setTabs(t => t.filter(x => !(x.name === name && x.type === type)));
    setActive(a => (a?.name === name && a?.type === type) ? null : a);
    await refresh();
  }, [deleteTarget, refresh]);

  const handleCreate = useCallback(async (name, type) => {
    await refresh(); openFile(name, type); setShowNew(false);
  }, [refresh, openFile]);

  const handleUserSave = useCallback((name, type) => {
    const key = name + ":" + type;
    recentSaves.current.add(key);
    refreshRecent(); // saving an existing file never changes the file lists
    setTimeout(() => recentSaves.current.delete(key), 2500);
  }, [refreshRecent]);

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") { e.preventDefault(); setShowNew(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === "w") { e.preventDefault(); if (active) closeTab(active); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, closeTab]);

  const T = isDark ? DARK : LIGHT;

  return (
    <ThemeCtx.Provider value={T}>
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: T.bg }}>
      <TopBar
        tabs={tabs} active={active}
        onSelect={setActive} onClose={closeTab}
        onRename={handleRename} onNew={() => setShowNew(true)}
        onHome={() => setActive(null)}
        connected={connected}
        onExport={() => setShowExp(true)}
        onHistory={() => setShowHist(h => !h)}
        diagrams={diagrams} tldrawFiles={tldrawFiles} notes={notes} codeFiles={codeFiles} tableFiles={tableFiles} pdfFiles={pdfFiles} csvFiles={csvFiles} recent={recent}
        onOpen={openFile} onDelete={handleDelete}
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0 }}>
          {!active
            ? <EmptyState recent={recent} onNew={() => setShowNew(true)} onOpen={openFile} />
            : active.type === "diagram"
              ? <DiagramEditor key={active.name + ":diagram"} name={active.name} onUserSave={handleUserSave} onNavigate={openFile} />
              : active.type === "tldraw"
                ? <TldrawEditor key={active.name + ":tldraw"} name={active.name} onUserSave={handleUserSave} />
                : active.type === "code"
                  ? <CodeEditor key={active.name + ":code"} name={active.name} onUserSave={handleUserSave} />
                  : active.type === "table"
                    ? <TableView key={active.name + ":table"} name={active.name} T={T} />
                    : active.type === "pdf"
                      ? <PdfView key={active.name + ":pdf"} name={active.name} T={T} />
                      : active.type === "csv"
                        ? <CsvView key={active.name + ":csv"} name={active.name} T={T} />
                        : <NoteView key={active.name + ":note"} name={active.name} onNavigate={openFile} onUserSave={handleUserSave} />
          }
        </div>

        {showHist && active?.type === "diagram" && (
          <HistoryPanel name={active.name} onClose={() => setShowHist(false)} onRestored={refresh} />
        )}
      </div>

      {active && active.type !== "tldraw" && <PromptBar active={active} />}

      {showNew  && <NewModal onClose={() => setShowNew(false)} onCreate={handleCreate} />}
      {showExp  && active?.type === "diagram" && <ExportModal name={active.name} onClose={() => setShowExp(false)} />}
      {deleteTarget && <DeleteModal name={deleteTarget.name} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </div>
    </ThemeCtx.Provider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
