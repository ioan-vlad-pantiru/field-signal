import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { byField } from "../../../lib/results.ts";

// A farm under 75 ha may send several rows for one field (optimizer plan §10): they stay together, in order.
describe("byField", () => {
  it("keeps a split field's rows together, fields in first-seen order", () => {
    const rows = [
      { field_id: "f1", area_ha: 20 },
      { field_id: "f2", area_ha: 8 },
      { field_id: "f1", area_ha: 16.6 },
    ];
    assert.deepEqual(byField(rows), [rows[0], rows[2], rows[1]]);
    assert.deepEqual(rows.map((r) => r.area_ha), [20, 8, 16.6], "input not mutated");
  });
});

type Tree = { [key: string]: string | Tree };

function strings(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : strings(value, `${prefix}${key}.`),
  );
}

function farmPlan(locale: string): [string, string][] {
  const url = new URL(`../../../../messages/${locale}.json`, import.meta.url);
  return strings((JSON.parse(readFileSync(url, "utf8")) as { Optimizer: Tree }).Optimizer);
}

// Binding wording (optimizer plan §3.10): never "compliant", "optimal" only for a proven optimum.
describe("Farm plan strings", () => {
  for (const locale of ["en", "ro"]) {
    it(`${locale}: no compliance claim, "optimal" only in bestOptimal`, () => {
      for (const [key, text] of farmPlan(locale)) {
        assert.doesNotMatch(text, /complian|conform/i, key);
        if (key !== "bestOptimal") assert.doesNotMatch(text, /optim/i, key);
      }
    });
  }

  // Splitting only strictly below 75 ha (optimizer plan §10.6): only perFieldHint may mention it, and only
  // beside the threshold, so a large farm is never promised a split.
  for (const locale of ["en", "ro"]) {
    it(`${locale}: splitting is mentioned only with the 75 ha threshold`, () => {
      for (const [key, text] of farmPlan(locale)) {
        if (key === "perFieldHint") assert.match(text, /75 ha/, key);
        else assert.doesNotMatch(text, /split|împăr/i, key);
      }
    });
  }

  it("en and ro have the same keys", () => {
    assert.deepEqual(
      farmPlan("en").map(([key]) => key),
      farmPlan("ro").map(([key]) => key),
    );
  });
});
