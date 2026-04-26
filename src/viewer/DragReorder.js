// DragReorder.js — drag-to-reorder blocks in the CM6 note editor.
// Three exports:
//   parseBlocks(state) → BlockGroup[]
//   makeDragReorderPlugin() → Extension
// Internal:
//   startDrag / onDragMove / onDragEnd (module-level, not exported)

import { ViewPlugin as _ViewPlugin, Decoration, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// ── Types (JSDoc only, no TypeScript) ────────────────────────────────────────
// BlockGroup: { type: string, blocks: Block[], ordered?: boolean }
// Block: { from: number, to: number }

// ── Module-level drag state ───────────────────────────────────────────────────
let activeDrag = null;
// activeDrag shape when non-null:
// { view, groups, groupIdx, fromBlockIdx, insertBeforeIdx, lineEl }

// buildReorderTransaction is implemented in Task 6.
// Declare here so the drag state machine can reference it without a no-undef error.
function buildReorderTransaction(_state, _group, _fromBlockIdx, _insertBeforeIdx) {
  return null; // placeholder — overridden in Task 6
}

// ── DragHandleWidget ──────────────────────────────────────────────────────────

class DragHandleWidget extends WidgetType {
  constructor(groupIdx, blockIdx) {
    super();
    this.groupIdx = groupIdx;
    this.blockIdx = blockIdx;
  }

  eq(other) {
    return other.groupIdx === this.groupIdx && other.blockIdx === this.blockIdx;
  }

  toDOM(view) {
    // Inner button (absolutely positioned into the left margin)
    const btn = document.createElement("span");
    btn.className = "ee-drag-handle-btn";
    btn.setAttribute("aria-hidden", "true");
    btn.textContent = "⠿";
    btn.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      startDrag(view, this.groupIdx, this.blockIdx, e);
    });

    // Outer wrapper: zero width, overflow visible so the btn floats left
    const outer = document.createElement("span");
    outer.className = "ee-drag-handle";
    outer.appendChild(btn);
    return outer;
  }

  ignoreEvent() { return true; }
}

// ── buildHandleDecorations ────────────────────────────────────────────────────

function _buildHandleDecorations(view) {
  const groups = parseBlocks(view.state);
  const builder = new RangeSetBuilder();

  // Collect (pos, widget) pairs then sort by pos before adding to builder.
  // RangeSetBuilder requires additions in ascending order.
  const entries = [];
  groups.forEach((group, groupIdx) => {
    group.blocks.forEach((block, blockIdx) => {
      entries.push({ pos: block.from, groupIdx, blockIdx });
    });
  });
  entries.sort((a, b) => a.pos - b.pos);

  for (const { pos, groupIdx, blockIdx } of entries) {
    builder.add(pos, pos, Decoration.widget({
      widget: new DragHandleWidget(groupIdx, blockIdx),
      side: -1,
    }));
  }

  return builder.finish();
}

// ── Drag state machine ────────────────────────────────────────────────────────

function startDrag(view, groupIdx, blockIdx, mouseEvent) {
  const groups = parseBlocks(view.state);
  const group = groups[groupIdx];
  if (!group || group.blocks.length < 2) return;

  // Create a floating insert-line indicator inside view.dom.
  const lineEl = document.createElement("div");
  lineEl.className = "ee-drag-line";
  view.dom.appendChild(lineEl);

  // Highlight the active handle button
  const handleBtn = mouseEvent.target.closest(".ee-drag-handle-btn");
  if (handleBtn) handleBtn.classList.add("ee-active");

  activeDrag = {
    view,
    groups,
    groupIdx,
    group,
    fromBlockIdx: blockIdx,
    insertBeforeIdx: blockIdx,  // "no-op" initial value
    lineEl,
    handleBtn,
  };

  document.addEventListener("mousemove", onDragMove, { capture: true });
  document.addEventListener("mouseup",   onDragEnd,   { capture: true });
  document.addEventListener("keydown",   onDragKeyDown, { capture: true });
}

function getInsertBefore(view, blocks, clientY) {
  // Convert clientY to document-coordinate Y within the CM editor.
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const relY = clientY - scrollRect.top + view.scrollDOM.scrollTop;

  for (let i = 0; i < blocks.length; i++) {
    const lb = view.lineBlockAt(blocks[i].from);
    // If mouse is in the top half of block i, insert before block i.
    if (relY < lb.top + lb.height / 2) return i;
  }
  return blocks.length; // insert after last block
}

function positionInsertLine(view, blocks, insertBefore) {
  const { lineEl } = activeDrag;
  let docY;
  if (insertBefore === 0) {
    docY = view.lineBlockAt(blocks[0].from).top;
  } else if (insertBefore >= blocks.length) {
    const lb = view.lineBlockAt(blocks[blocks.length - 1].from);
    docY = lb.top + lb.height;
  } else {
    docY = view.lineBlockAt(blocks[insertBefore].from).top;
  }
  const scrollOffset = view.scrollDOM.scrollTop;
  lineEl.style.top = `${docY - scrollOffset}px`;
  lineEl.style.display = "block";
}

function onDragMove(e) {
  if (!activeDrag) return;
  const { view, group } = activeDrag;
  const insertBefore = getInsertBefore(view, group.blocks, e.clientY);
  activeDrag.insertBeforeIdx = insertBefore;
  positionInsertLine(view, group.blocks, insertBefore);
}

function onDragEnd(_e) {
  if (!activeDrag) return;
  const { view, group, fromBlockIdx, insertBeforeIdx, lineEl, handleBtn } = activeDrag;

  // Cleanup
  lineEl.remove();
  if (handleBtn) handleBtn.classList.remove("ee-active");
  document.removeEventListener("mousemove", onDragMove,    { capture: true });
  document.removeEventListener("mouseup",   onDragEnd,     { capture: true });
  document.removeEventListener("keydown",   onDragKeyDown, { capture: true });
  activeDrag = null;

  // No-op if dropped in same position
  if (insertBeforeIdx === fromBlockIdx || insertBeforeIdx === fromBlockIdx + 1) return;

  const tx = buildReorderTransaction(view.state, group, fromBlockIdx, insertBeforeIdx);
  if (tx) view.dispatch(tx);
}

function onDragKeyDown(e) {
  if (e.key === "Escape" && activeDrag) {
    const { lineEl, handleBtn } = activeDrag;
    lineEl.remove();
    if (handleBtn) handleBtn.classList.remove("ee-active");
    document.removeEventListener("mousemove", onDragMove,    { capture: true });
    document.removeEventListener("mouseup",   onDragEnd,     { capture: true });
    document.removeEventListener("keydown",   onDragKeyDown, { capture: true });
    activeDrag = null;
  }
}

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
