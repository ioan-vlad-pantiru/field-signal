import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FarmRematch, Parcel } from "./contracts.ts";
import { applyRematch, soilFlags, type FieldGroup } from "./farm.ts";
import { fieldAreaHa, fieldRings } from "./geo.ts";

function parcel(id: number, soil: Parcel["soil"] = null): Parcel {
  return {
    id,
    area_ha: 1,
    boundary: [
      { lat: 46.3, lon: 23.7 },
      { lat: 46.3, lon: 23.71 },
      { lat: 46.31, lon: 23.71 },
    ],
    soil,
  } as Parcel;
}

describe("applyRematch", () => {
  const fields: FieldGroup[] = [
    { id: "a", name: "A", parcel_ids: [1, 2] },
    { id: "b", name: "B", parcel_ids: [3] },
  ];

  it("swaps parcels for their new ids and keeps fields", () => {
    const result: FarmRematch = {
      parcels: [parcel(10), parcel(20), parcel(3)],
      mapping: { 1: [10], 2: [20], 3: [3] },
    };
    const next = applyRematch({ parcels: [parcel(1), parcel(2), parcel(3)], fields }, result);
    assert.deepEqual(next.fields.map((f) => f.parcel_ids), [[10, 20], [3]]);
    assert.deepEqual(next.parcels.map((p) => p.id).sort((a, b) => a - b), [3, 10, 20]);
    assert.equal(next.changed, 2);
    assert.equal(next.missing, 0);
  });

  it("keeps parcels with no match and gives a shared new parcel to the first field only", () => {
    const result: FarmRematch = { parcels: [parcel(10)], mapping: { 1: [10], 3: [10] } };
    const next = applyRematch({ parcels: [parcel(1), parcel(2), parcel(3)], fields }, result);
    assert.deepEqual(next.fields.map((f) => f.parcel_ids), [[10, 2]]);
    assert.equal(next.missing, 1);
    assert.ok(next.parcels.some((p) => p.id === 2));
  });
});

describe("soilFlags", () => {
  it("flags a parcel with much more clay than the farm", () => {
    const soil = (clay: number) => ({ clay_pct: clay, soc_g_per_kg: 20, ph_h2o: 7, sand_pct: 20 });
    const flags = soilFlags([parcel(1, soil(30)), parcel(2, soil(31)), parcel(3, soil(45))]);
    assert.deepEqual(flags, [{ parcelId: 3, kind: "clay_high" }]);
  });
});

describe("field with several parts", () => {
  it("counts every part's area", () => {
    const square = (lon: number) => [
      { lat: 46.3, lon },
      { lat: 46.3, lon: lon + 0.001 },
      { lat: 46.301, lon: lon + 0.001 },
      { lat: 46.301, lon },
    ];
    const one = { boundary: square(23.7) };
    const two = { boundary: square(23.7), parts: [square(23.75)] };
    assert.equal(fieldRings(two).length, 2);
    assert.ok(Math.abs(fieldAreaHa(two) - 2 * fieldAreaHa(one)) < 1e-6);
  });
});
