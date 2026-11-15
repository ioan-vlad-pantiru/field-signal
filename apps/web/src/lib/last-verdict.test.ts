import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_REMEMBERED, parseVerdicts, withVerdict, type LastVerdict } from "./last-verdict.ts";

const v = (at: string): LastVerdict => ({ kind: "fewer", best: ["maize", "wheat"], bestPoor: 2, currentPoor: 5, at });

describe("parseVerdicts", () => {
  it("returns an empty map for nothing or garbage", () => {
    assert.deepEqual(parseVerdicts(null), {});
    assert.deepEqual(parseVerdicts("not json"), {});
    assert.deepEqual(parseVerdicts("[1,2]"), {});
  });
  it("keeps valid entries and drops malformed ones", () => {
    const raw = JSON.stringify({ a: v("2026-11-15"), b: { kind: "nope" }, c: { ...v("x"), best: [1] } });
    assert.deepEqual(Object.keys(parseVerdicts(raw)), ["a"]);
  });
});

describe("withVerdict", () => {
  it("replaces a field's entry and moves it last", () => {
    const next = withVerdict({ a: v("1"), b: v("2") }, "a", v("3"));
    assert.deepEqual(Object.keys(next), ["b", "a"]);
    assert.equal(next.a.at, "3");
  });
  it("forgets the oldest past the limit", () => {
    let all: Record<string, LastVerdict> = {};
    for (let i = 0; i < MAX_REMEMBERED + 3; i++) all = withVerdict(all, `f${i}`, v(String(i)));
    assert.equal(Object.keys(all).length, MAX_REMEMBERED);
    assert.equal(Object.keys(all)[0], "f3");
  });
});
