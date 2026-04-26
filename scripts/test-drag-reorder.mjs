// Unit tests for DragReorder.parseBlocks using Node 18+ built-in test runner.
// Run: node scripts/test-drag-reorder.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { parseBlocks } from "../src/viewer/DragReorder.js";

function makeState(doc) {
  return EditorState.create({ doc, extensions: [markdown()] });
}

test("empty doc returns no groups", () => {
  const groups = parseBlocks(makeState(""));
  assert.deepEqual(groups, []);
});
