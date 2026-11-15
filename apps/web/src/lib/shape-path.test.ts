import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shapePath } from "./shape-path.ts";

describe("shapePath", () => {
  it("is empty without a polygon", () => {
    assert.equal(shapePath([[{ lat: 46, lon: 23 }]]), "");
  });
  it("fits a square into the box, north up", () => {
    const d = shapePath([[{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }]], 10, 1);
    assert.equal(d, "M1 9L9 9L9 1L1 1Z");
  });
  it("draws every piece of a field", () => {
    const ring = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 0 }];
    const far = ring.map((p) => ({ lat: p.lat, lon: p.lon + 3 }));
    assert.equal(shapePath([ring, far]).split("Z").filter(Boolean).length, 2);
  });
});
