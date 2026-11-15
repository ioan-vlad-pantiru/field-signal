import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissAfterDrag } from "./sheet-drag.ts";

test("a tap or a small nudge never closes the sheet", () => {
  assert.equal(dismissAfterDrag(0, 0, 600), false);
  assert.equal(dismissAfterDrag(8, 2, 600), false);
  assert.equal(dismissAfterDrag(-200, 0, 600), false);
});

test("a fast flick down closes it", () => {
  assert.equal(dismissAfterDrag(30, 0.9, 600), true);
});

test("a slow pull closes past a third of the sheet, capped at 140px", () => {
  assert.equal(dismissAfterDrag(100, 0.1, 600), false);
  assert.equal(dismissAfterDrag(140, 0.1, 600), true);
  assert.equal(dismissAfterDrag(70, 0.1, 180), true);
  assert.equal(dismissAfterDrag(55, 0.1, 120), false);
});
