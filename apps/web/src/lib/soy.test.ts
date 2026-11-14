import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEAL_YIELD, coverage, parseTonnes, roundPct, scaleToAdoption } from "./soy.ts";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

describe("scaleToAdoption", () => {
  it("rescales linearly from the scenario's share", () => {
    const r = scaleToAdoption({ low: 100, mid: 200, high: 300 }, 10, 25);
    assert.deepEqual(r, { low: 250, mid: 500, high: 750 });
  });
  it("is zero when the scenario share is zero", () => {
    assert.deepEqual(scaleToAdoption({ low: 1, mid: 2, high: 3 }, 0, 25), { low: 0, mid: 0, high: 0 });
  });
});

describe("coverage", () => {
  const beans = { low: 1000, mid: 2000, high: 3000 };

  it("compares beans with beans", () => {
    const c = coverage(beans, 10_000, "beans")!;
    close(c.low, 10);
    close(c.mid, 20);
    close(c.high, 30);
  });

  it("converts beans to meal with the crushing yield, low with low and high with high", () => {
    const c = coverage(beans, 10_000, "meal")!;
    close(c.low, 1000 * MEAL_YIELD.low * 100 / 10_000);
    close(c.mid, 2000 * 0.79 / 100);
    close(c.high, 3000 * 0.8 / 100);
    assert.ok(c.low < coverage(beans, 10_000, "beans")!.low);
  });

  it("can exceed 100% when local soy is more than the purchase", () => {
    close(coverage(beans, 1000, "beans")!.high, 300);
  });

  it("is null without a purchase", () => {
    assert.equal(coverage(beans, null, "beans"), null);
    assert.equal(coverage(beans, 0, "beans"), null);
    assert.equal(coverage(beans, -5, "meal"), null);
    assert.equal(coverage(beans, Number.NaN, "beans"), null);
  });
});

describe("parseTonnes", () => {
  it("reads plain numbers, spaces and a decimal comma", () => {
    assert.equal(parseTonnes("12000"), 12000);
    assert.equal(parseTonnes("12 500"), 12500);
    assert.equal(parseTonnes("1250,5"), 1250.5);
  });
  it("rejects empty, zero and nonsense", () => {
    assert.equal(parseTonnes(""), null);
    assert.equal(parseTonnes("0"), null);
    assert.equal(parseTonnes("abc"), null);
    assert.equal(parseTonnes("-3"), null);
  });
});

describe("roundPct", () => {
  it("keeps one decimal below 1%", () => {
    assert.equal(roundPct(0.34), 0.3);
    assert.equal(roundPct(12.6), 13);
    assert.equal(roundPct(0), 0);
  });
});
