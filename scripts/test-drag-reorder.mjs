// Unit tests for DragReorder.parseBlocks using Node 18+ built-in test runner.
// Run: node scripts/test-drag-reorder.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { parseBlocks, buildReorderTransaction } from "../src/viewer/DragReorder.js";

function makeState(doc) {
  return EditorState.create({ doc, extensions: [markdownLanguage] });
}

test("empty doc returns no groups", () => {
  const groups = parseBlocks(makeState(""));
  assert.deepEqual(groups, []);
});

test("table with 3 body rows produces one tableRows group with 3 blocks", () => {
  const doc = `| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "tableRows");
  assert.equal(groups[0].blocks.length, 3);
  const texts = groups[0].blocks.map(b => doc.slice(b.from, b.to));
  assert.equal(texts[0], "| 1 | 2 |\n");
  assert.equal(texts[1], "| 3 | 4 |\n");
  assert.equal(texts[2], "| 5 | 6 |\n");
});

test("table with 1 body row produces no group", () => {
  const doc = `| A | B |\n| --- | --- |\n| 1 | 2 |\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.length, 0);
});

test("table with 0 body rows produces no group", () => {
  const doc = `| A | B |\n| --- | --- |\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.length, 0);
});

test("bullet list with 3 items produces one listItems group", () => {
  const doc = `- Alpha\n- Beta\n- Gamma\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].type, "listItems");
  assert.equal(groups[0].blocks.length, 3);
  assert.equal(groups[0].ordered, false);
  const texts = groups[0].blocks.map(b => doc.slice(b.from, b.to));
  assert.equal(texts[0], "- Alpha\n");
  assert.equal(texts[1], "- Beta\n");
  assert.equal(texts[2], "- Gamma\n");
});

test("ordered list with 2 items has ordered:true", () => {
  const doc = `1. First\n2. Second\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].ordered, true);
  assert.equal(groups[0].blocks.length, 2);
});

test("nested list: outer and inner are separate groups", () => {
  const doc = `- Outer A\n  - Inner 1\n  - Inner 2\n- Outer B\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.length, 2);
  const types = groups.map(g => g.type);
  assert.ok(types.every(t => t === "listItems"));
});

test("list with 1 item produces no group", () => {
  const doc = `- Only item\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.length, 0);
});

test("three H2 sections form one group of 3", () => {
  const doc = `## Alpha\nContent A\n## Beta\nContent B\n## Gamma\nContent C\n`;
  const groups = parseBlocks(makeState(doc));
  const sectionGroups = groups.filter(g => g.type === "sections");
  assert.equal(sectionGroups.length, 1);
  assert.equal(sectionGroups[0].blocks.length, 3);
  const texts = sectionGroups[0].blocks.map(b => doc.slice(b.from, b.to));
  assert.equal(texts[0], "## Alpha\nContent A\n");
  assert.equal(texts[1], "## Beta\nContent B\n");
  assert.equal(texts[2], "## Gamma\nContent C\n");
});

test("H2 containing H3 sub-sections: H2s and H3s are separate groups", () => {
  const doc = `## Ch1\n### S1.1\nA\n### S1.2\nB\n## Ch2\nC\n`;
  const groups = parseBlocks(makeState(doc));
  const sectionGroups = groups.filter(g => g.type === "sections");
  assert.equal(sectionGroups.length, 2);
  const h2g = sectionGroups.find(g => doc.slice(g.blocks[0].from, g.blocks[0].from + 3) === "## ");
  assert.ok(h2g);
  assert.equal(h2g.blocks.length, 2);
  const h3g = sectionGroups.find(g => doc.slice(g.blocks[0].from, g.blocks[0].from + 4) === "### ");
  assert.ok(h3g);
  assert.equal(h3g.blocks.length, 2);
});

test("single heading produces no section group", () => {
  const doc = `## Only\nContent\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.filter(g => g.type === "sections").length, 0);
});

test("H1 followed by H2: no sibling group formed", () => {
  const doc = `# Title\n## Sub\nContent\n`;
  const groups = parseBlocks(makeState(doc));
  assert.equal(groups.filter(g => g.type === "sections").length, 0);
});

test("reorderBlocks: move first item to last", () => {
  const doc = `- A\n- B\n- C\n`;
  const state = makeState(doc);
  const groups = parseBlocks(state);
  assert.equal(groups.length, 1);
  const group = groups[0];
  const tx = buildReorderTransaction(state, group, 0, 3); // move block 0 to after block 2
  assert.ok(tx);
  // Apply transaction manually
  const newDoc = tx.changes.apply(state.doc).toString();
  assert.equal(newDoc, `- B\n- C\n- A\n`);
});

test("reorderBlocks: move last item to first", () => {
  const doc = `- A\n- B\n- C\n`;
  const state = makeState(doc);
  const group = parseBlocks(state)[0];
  const tx = buildReorderTransaction(state, group, 2, 0); // move block 2 before block 0
  const newDoc = tx.changes.apply(state.doc).toString();
  assert.equal(newDoc, `- C\n- A\n- B\n`);
});

test("reorderBlocks: ordered list renumbers after reorder", () => {
  const doc = `1. First\n2. Second\n3. Third\n`;
  const state = makeState(doc);
  const group = parseBlocks(state)[0];
  const tx = buildReorderTransaction(state, group, 2, 0); // move "Third" to first
  const newDoc = tx.changes.apply(state.doc).toString();
  assert.equal(newDoc, `1. Third\n2. First\n3. Second\n`);
});

test("reorderBlocks: no-op returns null (same position)", () => {
  const doc = `- A\n- B\n`;
  const state = makeState(doc);
  const group = parseBlocks(state)[0];
  assert.equal(buildReorderTransaction(state, group, 0, 0), null);
  assert.equal(buildReorderTransaction(state, group, 0, 1), null);
});
