import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocate,
  alternatives,
  assessPath,
  assessRow,
  buildBrief,
  rankCandidates,
  templateSummary,
  type BriefFacts,
  type CountryCode,
  type RowAssessment,
  type StockRow,
  type StocksScenario,
  type SupplyForecast,
} from "./stocks.ts";

function row(id: string, stock_t: number, monthly_use_t: number, incoming_t: number): StockRow {
  return { id, name: { ro: id, en: id }, stock_t, monthly_use_t, incoming_t };
}

function forecast(
  ingredient: string,
  country: CountryCode,
  [low, mid, high]: [number, number, number],
  confidence: SupplyForecast["confidence"],
): SupplyForecast {
  return { ingredient, country, volume_t: { low, mid, high }, confidence, history: [] };
}

const S: StocksScenario = {
  mock: true,
  as_of: "2026-11-15",
  marketing_year: "2026/27",
  window: { ro: "dec. 2026 – iun. 2027", en: "Dec 2026 – Jun 2027" },
  scenario: { ro: "Scenariu de test.", en: "Test scenario." },
  paths: {
    A: {
      name: { ro: "Calea A", en: "Path A" },
      rows: [
        row("maize", 7500, 12000, 2500), // 25 days, red, shortfall 26 000
        row("wheat", 12000, 6000, 3000), // 75 days, ok
        row("soy_meal", 2400, 5400, 900), // 18.3 days, red, shortfall 12 900
        row("pea", 2000, 600, 400), // 120 days, ok
      ],
    },
    B: { name: { ro: "Calea B", en: "Path B" }, rows: [] },
  },
  forecasts: [
    forecast("maize", "UA", [7700, 14000, 20300], "low"),
    forecast("maize", "HU", [5600, 8000, 10400], "medium"),
    forecast("maize", "SK", [2550, 3000, 3450], "high"),
    forecast("maize", "FR", [4250, 5000, 5750], "high"),
    forecast("maize", "PL", [3830, 4500, 5180], "high"),
    forecast("soy_meal", "HU", [840, 1200, 1560], "medium"),
    forecast("soy_meal", "BR", [15300, 18000, 20700], "high"),
  ],
};

const byId = (id: string): RowAssessment => assessPath(S, "A").find((a) => a.row.id === id)!;

describe("assessRow", () => {
  it("applies the 30 and 60 day thresholds", () => {
    const red = assessRow(row("x", 199, 300, 100));
    assert.equal(red.cover_days, 29.9);
    assert.equal(red.status, "red");
    assert.equal(assessRow(row("x", 200, 300, 100)).status, "amber");
    assert.equal(assessRow(row("x", 500, 300, 100)).status, "ok");
  });

  it("computes the shortfall to 90 days of cover, never negative", () => {
    const maize = byId("maize");
    assert.equal(maize.daily_t, 400);
    assert.equal(maize.cover_days, 25);
    assert.equal(maize.shortfall_t, 26000);
    assert.equal(byId("pea").shortfall_t, 0);
  });

  it("sorts a path by cover days", () => {
    assert.deepEqual(
      assessPath(S, "A").map((a) => a.row.id),
      ["soy_meal", "maize", "wheat", "pea"],
    );
  });
});

describe("rankCandidates", () => {
  it("scores a candidate by the weighted formula", () => {
    const hu = rankCandidates(S, byId("maize")).find((c) => c.country === "HU")!;
    // coverage 8000/26000; reliability .5*65 + .5*100*(1 - 4800/16000); logistics 100*(1 - 1/48); friction 100 - 15
    assert.ok(Math.abs(hu.scores.coverage - 30.769) < 0.001);
    assert.equal(hu.scores.reliability, 67.5);
    assert.ok(Math.abs(hu.scores.logistics - 97.917) < 0.001);
    assert.equal(hu.scores.friction, 85);
    assert.equal(hu.scores.total, 64); // .35*30.77 + .25*67.5 + .2*97.92 + .2*85 = 64.2
  });

  it("ranks by total score", () => {
    const ranked = rankCandidates(S, byId("maize"));
    assert.deepEqual(
      ranked.map((c) => [c.country, c.scores.total]),
      [["PL", 67], ["FR", 66], ["SK", 65], ["HU", 64], ["UA", 52]],
    );
  });

  it("adds the bridge con when delivery is slower than the stock lasts", () => {
    const [br, hu] = rankCandidates(S, byId("soy_meal"));
    assert.equal(br.country, "BR");
    assert.ok(
      br.cons.some(
        (c) =>
          c.ro.startsWith("Livrarea (~35 de zile) ajunge după epuizarea stocului (~18 zile)") &&
          c.en.startsWith("Delivery (~35 days) arrives after the stock runs out (~18 days)"),
      ),
    );
    assert.ok(!hu.cons.some((c) => c.en.startsWith("Delivery")));
  });
});

describe("allocate", () => {
  it("splits an odd shortfall into whole tonnes that add up exactly", () => {
    const a = allocate(rankCandidates(S, byId("maize")), 105);
    assert.ok(a.lines.every((l) => Number.isInteger(l.tonnes)));
    assert.equal(a.lines.reduce((sum, l) => sum + l.tonnes, 0) + a.uncovered_t, 105);
    assert.equal(a.concentrated, false);
  });

  it("caps each country at half the shortfall in pass 1", () => {
    const { lines, uncovered_t } = allocate(rankCandidates(S, byId("maize")), 5000);
    assert.deepEqual(
      lines.map((l) => [l.country, l.tonnes]),
      [["PL", 2500], ["FR", 2500]],
    );
    assert.equal(uncovered_t, 0);
  });

  it("uses only the top MAX_LINES countries and reports what stays uncovered", () => {
    const a = allocate(rankCandidates(S, byId("maize")), 26000);
    assert.deepEqual(
      a.lines.map((l) => [l.country, l.tonnes]),
      [["PL", 3830], ["FR", 4250], ["SK", 2550], ["HU", 5600]],
    );
    assert.equal(a.uncovered_t, 26000 - 16230);
    assert.equal(a.concentrated, false);
  });

  it("tops up in pass 2 and flags concentration above half", () => {
    const a = allocate(rankCandidates(S, byId("soy_meal")), 12900);
    // pass 1: BR 6450, HU 840; pass 2: BR + 5610
    assert.deepEqual(
      a.lines.map((l) => [l.country, l.tonnes]),
      [["BR", 12060], ["HU", 840]],
    );
    assert.equal(a.uncovered_t, 0);
    assert.equal(a.concentrated, true);
  });
});

describe("alternatives", () => {
  it("suggests ok rows of the same group for red rows only", () => {
    assert.deepEqual(alternatives(S, "A", byId("maize")).map((a) => a.row.id), ["wheat"]);
    assert.deepEqual(alternatives(S, "A", byId("soy_meal")).map((a) => a.row.id), ["pea"]);
    assert.deepEqual(alternatives(S, "A", byId("wheat")), []);
  });
});

describe("templateSummary", () => {
  // Digit runs in the text, with group separators removed ("26.000", "26,000" -> "26000").
  function unknownNumbers(text: string, facts: BriefFacts): string[] {
    const allowed = new Set(JSON.stringify(facts).match(/\d+/g));
    const runs = text.replace(/(\d)[.,\s  ](?=\d{3}(?!\d))/g, "$1").match(/\d+/g) ?? [];
    return runs.filter((r) => !allowed.has(r));
  }

  for (const lang of ["ro", "en"] as const) {
    it(`uses only numbers from the facts (${lang})`, () => {
      const facts = buildBrief(S, "A", lang);
      const text = templateSummary(facts, lang);
      assert.deepEqual(unknownNumbers(text, facts), []);
      assert.ok(text.includes(lang === "ro" ? "38.900 t" : "38,900 t")); // grouped total shortfall
      assert.ok(text.endsWith(lang === "ro" ? "Cifrele sunt ilustrative." : "Figures are illustrative."));
    });
  }
});
