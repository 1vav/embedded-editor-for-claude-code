// Unit tests for DragReorder.parseBlocks using Node 18+ built-in test runner.
// Run: node scripts/test-drag-reorder.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { parseBlocks } from "../src/viewer/DragReorder.js";

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
