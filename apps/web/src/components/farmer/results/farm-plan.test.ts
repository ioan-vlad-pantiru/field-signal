import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

type Tree = { [key: string]: string | Tree };

function strings(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : strings(value, `${prefix}${key}.`),
  );
}

function farmPlan(locale: string): [string, string][] {
  const url = new URL(`../../../../messages/${locale}.json`, import.meta.url);
  return strings((JSON.parse(readFileSync(url, "utf8")) as { FarmPlan: Tree }).FarmPlan);
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

  it("en and ro have the same keys", () => {
    assert.deepEqual(
      farmPlan("en").map(([key]) => key),
      farmPlan("ro").map(([key]) => key),
    );
  });
});
