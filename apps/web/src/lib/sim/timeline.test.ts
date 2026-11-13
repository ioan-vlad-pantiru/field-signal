import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTimeline, snapshotTimes, stateAt } from "./timeline.ts";

describe("buildTimeline", () => {
  it("plays sow → grow → harvest for every crop in order", () => {
    const tl = buildTimeline(["maize", "wheat", "maize"]);
    const work = tl.phases.filter((p) => p.kind !== "bare").map((p) => `${p.crop}:${p.kind}`);
    assert.deepEqual(work, [
      "maize:sow",
      "maize:grow",
      "maize:harvest",
      "wheat:sow",
      "wheat:grow",
      "wheat:harvest",
      "maize:sow",
      "maize:grow",
      "maize:harvest",
    ]);
  });

  it("shows the long bare gap from a wheat harvest to spring maize", () => {
    const tl = buildTimeline(["maize", "wheat", "maize"]);
    // Maize harvested Oct → wheat sown Oct: no gap. Wheat harvested Jul → maize sown Apr: 9 months.
    assert.deepEqual(
      tl.bareGaps.map((g) => g.months),
      [0, 9],
    );
  });

  it("keeps phases contiguous and stateAt finds them", () => {
    const tl = buildTimeline(["sunflower", "pea", "wheat", "cover_vetch"]);
    for (let i = 1; i < tl.phases.length; i++) {
      const prev = tl.phases[i - 1];
      assert.ok(Math.abs(prev.start + prev.duration - tl.phases[i].start) < 1e-9);
    }
    assert.equal(stateAt(tl, tl.phases[3].start + 0.5).phaseIndex, 3);
    assert.equal(stateAt(tl, tl.duration + 10).phaseIndex, tl.phases.length - 1);
    assert.equal(snapshotTimes(tl).length, 3 * 4);
  });
});
