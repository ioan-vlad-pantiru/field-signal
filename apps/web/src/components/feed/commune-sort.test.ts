import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CropOutlook, QualityFlag, RiskLevel, Zone } from "@/lib/contracts";
import { sortRows, warningCount, type CommuneRow } from "./commune-sort.ts";

const CODES: QualityFlag["code"][] = ["aflatoxin_window", "fusarium_window", "harvest_rain"];

function outlook(score: number, area: number | null, flags: RiskLevel[] = []): CropOutlook {
  return {
    crop: "maize",
    area_ha: area,
    availability: { level: score > 60 ? "high" : score > 30 ? "medium" : "low", score, drivers: [] },
    quality: {
      level: flags.includes("high") ? "high" : flags.includes("medium") ? "medium" : "low",
      flags: flags.map((level, i) => ({
        code: CODES[i],
        label: { ro: "", en: "" },
        level,
        days_observed: 1,
        days_normal: 1,
        window: { ro: "", en: "" },
      })),
    },
    impact: { level: "low" },
    confidence: "medium",
    model_version: "test",
  } as CropOutlook;
}

function row(name: string, o: CropOutlook | undefined): CommuneRow {
  return { zone: { id: name, name, county: "AB", centroid: { lat: 0, lon: 0 }, crops: [] } satisfies Zone, outlook: o };
}

const names = (rows: CommuneRow[]) => rows.map((r) => r.zone.name);

describe("commune sorting", () => {
  const rows = [row("Cugir", outlook(70, 100)), row("Aiud", outlook(20, 900)), row("Blaj", undefined), row("Teiuș", outlook(40, 300))];

  it("puts the safest commune first and communes without data last", () => {
    assert.deepEqual(names(sortRows(rows, "risk", "asc", "ro")), ["Aiud", "Teiuș", "Cugir", "Blaj"]);
  });

  it("keeps communes without data last when the order is reversed", () => {
    assert.equal(names(sortRows(rows, "risk", "desc", "ro")).at(-1), "Blaj");
  });

  it("sorts by name in the page language", () => {
    assert.deepEqual(names(sortRows(rows, "name", "asc", "ro")), ["Aiud", "Blaj", "Cugir", "Teiuș"]);
  });

  it("counts only medium and high quality flags as warnings", () => {
    assert.equal(warningCount(outlook(10, 1, ["low", "medium", "high"])), 2);
  });
});
