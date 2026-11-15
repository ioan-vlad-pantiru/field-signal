import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Indicator, SeasonOutcome, Status, Strategy } from "./contracts.ts";
import { firstSentence, indicatorShift, mainRisk, placeShifts, poorSeasons, rankStrategies, replayYears, ruleStatus, verdict } from "./results.ts";

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

describe("ruleStatus", () => {
  it("a waived rule whose value breaks the limit is below the size threshold, not within", () => {
    assert.equal(ruleStatus({ id: "max_crop_share", limit_pct: 75, value_pct: 100, passed: true }), "belowThreshold");
    assert.equal(ruleStatus({ id: "legume_share", limit_pct: 2, value_pct: 0, passed: true }), "belowThreshold");
    assert.equal(ruleStatus({ id: "max_crop_share", limit_pct: 75, value_pct: 60, passed: true }), "within");
    assert.equal(ruleStatus({ id: "legume_share", limit_pct: 2, value_pct: 5, passed: true }), "within");
    assert.equal(ruleStatus({ id: "max_two_crops_share", limit_pct: 95, value_pct: 100, passed: false }), "outside");
  });
});

describe("mainRisk", () => {
  const reason = (code: string) => ({ code, label: { en: code, ro: code } });
  function withReasons(rows: [Status, string[]][], isCurrent = true): Strategy {
    const s = strategy("cur", 50, rows.map(([status]) => status), isCurrent);
    s.replay = s.replay.map((o, i) => ({ ...o, reasons: rows[i][1].map(reason) }));
    return s;
  }

  it("names the reason seen in most weak seasons of the current rotation", () => {
    const current = withReasons([
      ["bad", ["heat", "dry"]],
      ["watch", ["dry"]],
      ["good", ["dry", "dry"]],
      ["bad", ["frost"]],
    ]);
    const other = withReasons([["bad", ["frost"]], ["bad", ["frost"]]], false);
    assert.deepEqual(mainRisk([other, current]), { code: "dry", label: { en: "dry", ro: "dry" }, seasons: 2 });
  });

  it("prefers a weather cause over the model's yield index", () => {
    const current = withReasons([["bad", ["model_yield_index", "heat"]], ["bad", ["model_yield_index"]]]);
    assert.equal(mainRisk([current])?.code, "heat");
    assert.equal(mainRisk([withReasons([["bad", ["model_yield_index"]]])])?.code, "model_yield_index");
  });

  it("breaks ties by the reason seen first", () => {
    const current = withReasons([["bad", ["heat"]], ["bad", ["frost"]]]);
    assert.equal(mainRisk([current])?.code, "heat");
  });

  it("is null when no weak season has a reason", () => {
    assert.equal(mainRisk([withReasons([["good", ["heat"]], ["bad", []]])]), null);
    assert.equal(mainRisk([]), null);
  });

  it("falls back to the first rotation when none is current", () => {
    const first = withReasons([["bad", ["wet"]]], false);
    assert.equal(mainRisk([first])?.code, "wet");
  });
});

describe("firstSentence", () => {
  it("keeps the first sentence only", () => {
    assert.equal(firstSentence("Fewer dry summers. Wheat also helps the soil."), "Fewer dry summers.");
  });
  it("returns the whole text when there is no full stop", () => {
    assert.equal(firstSentence("  No stop here "), "No stop here");
  });
  it("does not cut inside numbers", () => {
    assert.equal(firstSentence("Yield rose 4.5 t/ha. Then fell."), "Yield rose 4.5 t/ha.");
  });
});
