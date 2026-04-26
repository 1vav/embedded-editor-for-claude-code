// DragReorder.js — drag-to-reorder blocks in the CM6 note editor.
// Three exports:
//   parseBlocks(state) → BlockGroup[]
//   makeDragReorderPlugin() → Extension
// Internal:
//   startDrag / onDragMove / onDragEnd (module-level, not exported)

import { ViewPlugin as _ViewPlugin, Decoration as _Decoration, WidgetType as _WidgetType } from "@codemirror/view";
import { RangeSetBuilder as _RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// ── Types (JSDoc only, no TypeScript) ────────────────────────────────────────
// BlockGroup: { type: string, blocks: Block[], ordered?: boolean }
// Block: { from: number, to: number }

// ── Module-level drag state ───────────────────────────────────────────────────
let _activeDrag = null;
// activeDrag shape when non-null:
// { view, groups, groupIdx, fromBlockIdx, insertBeforeIdx, lineEl }

// ── Exports ───────────────────────────────────────────────────────────────────

export function parseBlocks(state) {
  const groups = [];
  groups.push(...parseTableRowGroups(state));
  // listItems and sections added in later tasks
  return groups;
}

function parseTableRowGroups(state) {
  const groups = [];
  const docLen = state.doc.length;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;

      const bodyRows = [];
      let childCount = 0;
      let child = node.node.firstChild;

      while (child) {
        const name = child.name;
        if (name === "TableHeader" || name === "TableDelimiter") {
          // Dedicated header/delimiter types — always skip
          childCount++;
        } else if (name === "TableRow") {
          if (childCount === 0) {
            // First TableRow is header in lezer-markdown versions without TableHeader
            childCount++;
          } else {
            const rowText = state.doc.sliceString(child.from, child.to);
            const isDelimiter = /^[\s|:-]+$/.test(rowText);
            if (!isDelimiter) {
              const lineEnd = state.doc.lineAt(child.to).to;
              const to = lineEnd + 1 <= docLen ? lineEnd + 1 : lineEnd;
              bodyRows.push({ from: state.doc.lineAt(child.from).from, to });
            }
            childCount++;
          }
        } else {
          childCount++;
        }
        child = child.nextSibling;
      }

      if (bodyRows.length >= 2) {
        groups.push({ type: "tableRows", blocks: bodyRows });
      }

      return false; // don't recurse into Table
    },
  });

  return groups;
}

export function makeDragReorderPlugin() {
  // placeholder — implemented in Task 7
  return [];  // empty extension
}
