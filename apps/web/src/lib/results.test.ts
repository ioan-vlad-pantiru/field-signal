import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Indicator, SeasonOutcome, Status, Strategy } from "./contracts.ts";
import { indicatorShift, placeShifts, poorSeasons, rankStrategies, replayYears, verdict } from "./results.ts";

function outcomes(statuses: Status[], from = 2001): SeasonOutcome[] {
  return statuses.map((status, i) => ({
    year: from + i,
    crop: "maize",
    status,
    reasons: [],
    evidence_level: "medium",
  }));
}

function strategy(id: string, total: number, statuses: Status[], isCurrent = false): Strategy {
  return {
    id,
    name: { en: id, ro: id },
    is_current: isCurrent,
    sequence: ["maize", "wheat"],
    score: { total, yield_stability: 0, water: 0, soil_health: 0, low_risk: 0 },
    score_range: { low: total, mid: total, high: total },
    confidence: "medium",
    replay: outcomes(statuses),
    explanation: { why: { en: "", ro: "" }, evidence: [], benefits: [], gaps: [], risks: [], generated_by: "template" },
  };
}

function indicator(id: string, values: (number | null)[], from = 2001): Indicator {
  const source = { dataset: "d", product: "p", resolution: "r", period: "x", is_nasa: true };
  return {
    id,
    label: { en: id, ro: id },
    description: { en: "", ro: "" },
    unit: "days",
    higher_is_worse: true,
    source,
    series: values.map((value, i) => ({ year: from + i, value })),
  };
}

describe("poorSeasons", () => {
  it("counts only bad seasons", () => {
    assert.equal(poorSeasons(strategy("a", 50, ["bad", "watch", "good", "bad", "no_data"])), 2);
  });
});

describe("rankStrategies", () => {
  it("puts the best score first and keeps ties in order", () => {
    const ranked = rankStrategies([strategy("a", 40, []), strategy("b", 80, []), strategy("c", 40, [])]);
    assert.deepEqual(
      ranked.map((s) => s.id),
      ["b", "a", "c"],
    );
  });
});

describe("replayYears", () => {
  it("joins the years of every rotation, oldest first", () => {
    const a = strategy("a", 1, ["good", "good"]);
    const b = { ...strategy("b", 1, []), replay: outcomes(["good"], 2005) };
    assert.deepEqual(replayYears([b, a]), [2001, 2002, 2005]);
  });
});

describe("verdict", () => {
  it("says keep when the current rotation scores best", () => {
    const v = verdict([strategy("now", 90, ["bad"], true), strategy("x", 50, [])]);
    assert.equal(v.kind, "keep");
    assert.equal(v.best.id, "now");
  });

  it("compares poor seasons of the best rotation with the current one", () => {
    const v = verdict([
      strategy("now", 49, ["bad", "bad", "bad", "good"], true),
      strategy("dry", 88, ["bad", "good", "good", "good"]),
      strategy("soy", 60, ["bad", "bad", "good", "good"]),
    ]);
    assert.equal(v.kind, "fewer");
    assert.equal(v.best.id, "dry");
    assert.equal(v.bestPoor, 1);
    assert.equal(v.currentPoor, 3);
  });

  it("does not claim fewer poor seasons when the best fit had as many or more", () => {
    assert.equal(verdict([strategy("now", 40, ["bad"], true), strategy("x", 60, ["bad"])]).kind, "same");
    assert.equal(verdict([strategy("now", 40, ["good"], true), strategy("x", 60, ["bad"])]).kind, "more");
  });
});

describe("indicatorShift", () => {
  it("compares the last five years with data against the first ten", () => {
    const values = [...Array(10).fill(10), 99, 99, null, 99, ...Array(5).fill(20)];
    const shift = indicatorShift(indicator("hot", values));
    assert.ok(shift);
    assert.deepEqual(shift.early, { start: 2001, end: 2010, mean: 10 });
    assert.deepEqual(shift.recent, { start: 2015, end: 2019, mean: 20 });
    assert.equal(shift.direction, "up");
    assert.equal(shift.relative, 1);
  });

  it("needs fifteen years with data so the periods never overlap", () => {
    assert.equal(indicatorShift(indicator("short", [...Array(14).fill(1), null, null])), null);
  });

  it("calls a small change steady", () => {
    const shift = indicatorShift(indicator("flat", [...Array(10).fill(100), ...Array(5).fill(103)]));
    assert.equal(shift?.direction, "steady");
  });
});

describe("placeShifts", () => {
  it("keeps at most three, largest change first, and skips short series", () => {
    const series = (late: number) => [...Array(10).fill(10), ...Array(5).fill(late)];
    const shifts = placeShifts([
      indicator("small", series(11)),
      indicator("short", [1, 2, 3]),
      indicator("big", series(30)),
      indicator("drop", series(2)),
      indicator("mid", series(15)),
    ]);
    assert.deepEqual(
      shifts.map((s) => s.indicator.id),
      ["big", "drop", "mid"],
    );
  });
});
