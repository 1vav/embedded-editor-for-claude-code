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
  groups.push(...parseListItemGroups(state));
  groups.push(...parseSectionGroups(state));
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

function parseListItemGroups(state) {
  const groups = [];
  const docLen = state.doc.length;

  syntaxTree(state).iterate({
    enter(node) {
      const isBullet  = node.name === "BulletList";
      const isOrdered = node.name === "OrderedList";
      if (!isBullet && !isOrdered) return;

      const items = [];
      let child = node.node.firstChild;
      while (child) {
        if (child.name === "ListItem") {
          const from = state.doc.lineAt(child.from).from;
          const lineEnd = state.doc.lineAt(child.to).to;
          const to = lineEnd + 1 <= docLen ? lineEnd + 1 : lineEnd;
          items.push({ from, to });
        }
        child = child.nextSibling;
      }

      if (items.length >= 2) {
        groups.push({ type: "listItems", blocks: items, ordered: isOrdered });
      }
      // Do NOT return false — recurse into list items to find nested lists
    },
  });

  return groups;
}

function parseSectionGroups(state) {
  const docLen = state.doc.length;

  // 1. Collect all ATX headings in document order.
  const headings = [];
  syntaxTree(state).iterate({
    enter(node) {
      const m = node.name.match(/^ATXHeading([1-6])$/);
      if (!m) return;
      headings.push({
        level: parseInt(m[1]),
        from: state.doc.lineAt(node.from).from,
      });
    },
  });

  if (headings.length < 2) return [];

  // 2. Compute section `to` for each heading:
  //    section.to = start of next heading with level <= this heading's level, or EOF.
  const sections = headings.map((h, i) => {
    const next = headings.slice(i + 1).find(h2 => h2.level <= h.level);
    const to = next ? next.from : docLen;
    return { from: h.from, to, level: h.level };
  });

  // 3. Group same-level sibling sections.
  //    Two sections at the same level are siblings iff one ends exactly where the other begins
  //    (i.e. s[j].to === s[k].from for some j,k at same level). We scan per-level.
  const levels = [...new Set(sections.map(s => s.level))];
  const siblingGroups = [];
  for (const level of levels) {
    const levelSections = sections.filter(s => s.level === level);
    // Within the same level, group consecutive sections where s[i].to === s[i+1].from
    let current = [levelSections[0]];
    for (let i = 1; i < levelSections.length; i++) {
      const prev = levelSections[i - 1];
      const curr = levelSections[i];
      if (curr.from === prev.to) {
        current.push(curr);
      } else {
        if (current.length >= 2) siblingGroups.push(current);
        current = [curr];
      }
    }
    if (current.length >= 2) siblingGroups.push(current);
  }

  // 4. Convert to BlockGroup format.
  //    For non-last blocks, s.to = next_heading.from (a line start), so
  //    doc.slice(s.from, s.to) already includes the trailing \n.
  //    For the last block, s.to = docLen, so doc.slice(s.from, docLen) also includes
  //    any trailing \n.
  return siblingGroups.map(group => {
    const blocks = group.map(s => ({ from: s.from, to: s.to }));
    return { type: "sections", blocks };
  });
}

export function makeDragReorderPlugin() {
  // placeholder — implemented in Task 7
  return [];  // empty extension
}
