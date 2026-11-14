import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FarmPlan, LatLon, Parcel } from "./contracts.ts";
import {
  cropFromDeclared,
  cropFromHistory,
  csvFileName,
  declarationCsv,
  fieldCentroid,
  fieldLastCrop,
  nextSeason,
  toPlanField,
  type PlanInputField,
} from "./farm-plan.ts";

function square(lon: number, lat: number, size = 0.01): [LatLon, LatLon, LatLon, ...LatLon[]] {
  return [
    { lat, lon },
    { lat, lon: lon + size },
    { lat: lat + size, lon: lon + size },
    { lat: lat + size, lon },
  ];
}

function parcel(id: number, area: number, lon = 23.7, history: Parcel["crop_history"] = []): Parcel {
  return { id, boundary: square(lon, 46.3), area_ha: area, land_use: "TA", crop_history: history } as Parcel;
}

describe("crop mapping", () => {
  it("maps EUCROPMAP names, latest year with at least half the parcel", () => {
    const history = [
      { year: 2021, crop: "maize", share: 0.9 },
      { year: 2022, crop: "common_wheat", share: 0.8 },
      { year: 2023, crop: "sunflower", share: 0.3 },
    ];
    assert.equal(cropFromHistory({ crop_history: history }), "wheat");
    assert.equal(cropFromHistory({ crop_history: [{ year: 2022, crop: "dry_pulses", share: 0.6 }] }), "pea");
    assert.equal(cropFromHistory({ crop_history: [{ year: 2022, crop: "durum_wheat", share: 0.6 }] }), "wheat");
    assert.equal(cropFromHistory({ crop_history: [{ year: 2022, crop: "grassland", share: 0.9 }] }), null);
    assert.equal(cropFromHistory({ crop_history: [{ year: 2022, crop: null, share: 0.9 }] }), null);
    assert.equal(cropFromHistory({}), null);
  });

  it("reads Romanian declared names with or without diacritics", () => {
    assert.equal(cropFromDeclared("Porumb boabe"), "maize");
    assert.equal(cropFromDeclared("Grâu de toamnă"), "wheat");
    assert.equal(cropFromDeclared("grau"), "wheat");
    assert.equal(cropFromDeclared("Orz"), "barley");
    assert.equal(cropFromDeclared("Floarea-soarelui"), "sunflower");
    assert.equal(cropFromDeclared("SOIA"), "soybean");
    assert.equal(cropFromDeclared("Mazăre boabe"), "pea");
    assert.equal(cropFromDeclared("Lucernă"), null);
    assert.equal(cropFromDeclared(""), null);
  });

  it("lets the declared crop win, and takes the crop with the most area across parcels", () => {
    const maize = [{ year: 2024, crop: "maize", share: 0.9 }];
    const parcels = [parcel(1, 2, 23.7, maize), parcel(2, 3, 23.72, maize), parcel(3, 4, 23.74, maize)];
    assert.equal(fieldLastCrop(parcels, {}), "maize");
    // 2 + 3 ha declared wheat beat 4 ha mapped maize
    assert.equal(fieldLastCrop(parcels, { 1: "Grâu", 2: "grâu de toamnă" }), "wheat");
    assert.equal(fieldLastCrop([parcel(9, 1)], {}), null);
  });
});

describe("fieldCentroid", () => {
  it("is the centre of one square", () => {
    assert.deepEqual(fieldCentroid([{ boundary: square(23.7, 46.3), area_ha: 1 }]), { lat: 46.305, lon: 23.705 });
  });

  it("weights parcels by area and rounds to 5 decimals", () => {
    const c = fieldCentroid([
      { boundary: square(23.7, 46.3), area_ha: 3 },
      { boundary: square(23.8, 46.3), area_ha: 1 },
    ]);
    assert.deepEqual(c, { lat: 46.305, lon: 23.73 });
  });
});

describe("toPlanField", () => {
  it("sums area and keeps a valid rotation", () => {
    const field: PlanInputField = {
      id: "a",
      name: "La drum",
      parcels: [parcel(1, 2.5), parcel(2, 1.25, 23.71)],
      currentRotation: ["maize", "wheat"],
    };
    const plan = toPlanField(field, { 1: "Soia" });
    assert.equal(plan.area_ha, 3.75);
    assert.deepEqual(plan.current_rotation, ["maize", "wheat"]);
    assert.equal(plan.last_crop, "soybean");
    assert.equal(toPlanField({ ...field, currentRotation: ["maize"] }, {}).current_rotation, null);
  });
});

describe("nextSeason", () => {
  it("moves to next year from September", () => {
    assert.equal(nextSeason(new Date(2026, 7, 31)), 2026);
    assert.equal(nextSeason(new Date(2026, 8, 1)), 2027);
    assert.equal(nextSeason(new Date(2026, 0, 15)), 2026);
  });
});

describe("declarationCsv", () => {
  const plan: FarmPlan = {
    mock: true,
    years: [2027, 2028],
    fields: [
      {
        field_id: "a",
        strategy_name: { ro: "x", en: "x" },
        sequence: ["maize", "wheat"],
        crops: ["maize", "wheat"],
        score: 80,
      },
      {
        field_id: "b",
        strategy_name: { ro: "y", en: "y" },
        sequence: ["sunflower", "pea"],
        crops: ["pea", "sunflower"],
        score: 70,
      },
    ],
    totals: [],
    checks: [],
    caveats: [],
  };
  const fields: PlanInputField[] = [
    { id: "a", name: "La drum", parcels: [parcel(11, 2.5), parcel(12, 1.125)], currentRotation: null },
    { id: "b", name: 'Vale; "mare"', parcels: [parcel(13, 4)], currentRotation: null },
  ];

  it("writes a BOM, a header and one row per parcel, semicolon-separated", () => {
    const csv = declarationCsv(plan, fields, 2028);
    assert.ok(csv.startsWith("﻿"));
    const lines = csv.slice(1).trimEnd().split("\r\n");
    assert.deepEqual(lines, [
      "ID parcelă APIA;Solă;Suprafață (ha);Cultura 2028",
      "11;La drum;2,5;Grâu",
      "12;La drum;1,125;Grâu",
      '13;"Vale; ""mare""";4;Floarea-soarelui',
    ]);
  });

  it("leaves the crop empty for a year outside the plan", () => {
    const csv = declarationCsv(plan, fields, 2031);
    assert.match(csv, /\r\n11;La drum;2,5;\r\n/);
  });

  it("names the file after the farm", () => {
    assert.equal(csvFileName("Ferma Ștefănești", 2027), "ferma-stefanesti-apia-2027.csv");
    assert.equal(csvFileName("  ", 2027), "ferma-apia-2027.csv");
  });
});
