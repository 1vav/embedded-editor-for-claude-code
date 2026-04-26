// DragReorder.js — drag-to-reorder blocks in the CM6 note editor.
// Three exports:
//   parseBlocks(state) → BlockGroup[]
//   makeDragReorderPlugin() → Extension
// Internal:
//   startDrag / onDragMove / onDragEnd (module-level, not exported)

import { ViewPlugin as _ViewPlugin, Decoration as _Decoration, WidgetType as _WidgetType } from "@codemirror/view";
import { RangeSetBuilder as _RangeSetBuilder } from "@codemirror/state";
import { syntaxTree as _syntaxTree } from "@codemirror/language";

// ── Types (JSDoc only, no TypeScript) ────────────────────────────────────────
// BlockGroup: { type: string, blocks: Block[], ordered?: boolean }
// Block: { from: number, to: number }

// ── Module-level drag state ───────────────────────────────────────────────────
let _activeDrag = null;
// activeDrag shape when non-null:
// { view, groups, groupIdx, fromBlockIdx, insertBeforeIdx, lineEl }

// ── Exports ───────────────────────────────────────────────────────────────────

export function parseBlocks(_state) {
  // placeholder — implemented in Tasks 2–4
  return [];
}

export function makeDragReorderPlugin() {
  // placeholder — implemented in Task 7
  return [];  // empty extension
}
