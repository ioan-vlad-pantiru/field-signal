import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_FIELD_IRREGULAR, DEMO_FIELD_RECT, polygonArea } from "./geometry.ts";
import { coverage, estimateHours, planFieldWork, poseAt, sampleWork } from "./path-planner.ts";

const OPTIONS = { workingWidthM: 6, headlandLaps: 2 };

describe("planFieldWork on a 400 m × 250 m rectangle", () => {
  const plan = planFieldWork(DEMO_FIELD_RECT, OPTIONS);

  it("is a 10 ha field with a 12 m headland", () => {
    assert.equal(polygonArea(DEMO_FIELD_RECT), 100_000);
    assert.equal(plan.headlandWidthM, 12);
  });

  it("drives one pass per 6 m strip of the interior", () => {
    // Interior is 250 − 2 × 12 = 226 m tall → ceil(226 / 6) = 38 passes, each 400 − 24 = 376 m.
    assert.equal(plan.passes.length, 38);
    for (const pass of plan.passes) assert.ok(Math.abs(pass.length - 376) < 1e-6);
  });

  it("alternates direction (boustrophedon) and steps at most one working width", () => {
    for (let i = 1; i < plan.passes.length; i++) {
      const a = plan.passes[i - 1];
      const b = plan.passes[i];
      assert.notEqual(Math.sign(a.end[0] - a.start[0]), Math.sign(b.end[0] - b.start[0]));
      assert.ok(Math.abs(b.start[1] - a.start[1]) <= 6 + 1e-6);
    }
  });

  it("works the headland last with two laps", () => {
    assert.equal(plan.headlandLaps.length, 2);
    assert.ok(plan.path[plan.path.length - 1].working);
  });

  it("covers at least 98% of the field", () => {
    const c = coverage(plan);
    assert.ok(c >= 0.98, `coverage ${c}`);
  });

  it("adds up distances and gives a plausible working time", () => {
    assert.ok(Math.abs(plan.workingDistanceM + plan.turnDistanceM - plan.totalDistanceM) < 1e-6);
    // 38 × 376 m of passes plus two headland laps of roughly 1.2–1.3 km each.
    assert.ok(plan.workingDistanceM > 38 * 376 + 2000 && plan.workingDistanceM < 38 * 376 + 2800);
    const hours = estimateHours(plan);
    assert.ok(hours > 1 && hours < 3, `hours ${hours}`);
  });

  it("finds the tractor along the path", () => {
    const start = poseAt(plan, 0);
    assert.deepEqual([start.x, start.y], [plan.path[0].x, plan.path[0].y]);
    assert.ok(poseAt(plan, 100).working);
    assert.equal(poseAt(plan, plan.totalDistanceM + 50).x, plan.path[plan.path.length - 1].x);
  });

  it("places work samples in path order", () => {
    const samples = sampleWork(plan, 5, [-1.5, 1.5]);
    assert.ok(samples.length > 1000);
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i].d >= samples[i - 1].d);
  });
});

describe("planFieldWork on an irregular (notched, slanted) field", () => {
  const plan = planFieldWork(DEMO_FIELD_IRREGULAR, OPTIONS);

  it("has a sensible pass count for its size", () => {
    // Interior is about 250 − 24 = 226 m tall → 38 lines; the notch splits some lines in two.
    assert.ok(plan.passes.length >= 38 && plan.passes.length <= 60, `passes ${plan.passes.length}`);
    for (const pass of plan.passes) assert.ok(pass.length >= 1);
  });

  it("covers at least 95% of the field", () => {
    const c = coverage(plan);
    assert.ok(c >= 0.95, `coverage ${c}`);
  });

  it("mostly sweeps back and forth", () => {
    let reversals = 0;
    for (let i = 1; i < plan.passes.length; i++) {
      const a = plan.passes[i - 1];
      const b = plan.passes[i];
      if (Math.sign(a.end[0] - a.start[0]) !== Math.sign(b.end[0] - b.start[0])) reversals++;
    }
    assert.ok(reversals >= (plan.passes.length - 1) * 0.8, `reversals ${reversals}/${plan.passes.length}`);
  });
});

describe("planFieldWork input checks", () => {
  it("rejects a field smaller than its headland", () => {
    assert.throws(() => planFieldWork([[0, 0], [20, 0], [20, 20], [0, 20]], OPTIONS));
  });
  it("rejects a zero working width", () => {
    assert.throws(() => planFieldWork(DEMO_FIELD_RECT, { workingWidthM: 0, headlandLaps: 1 }));
  });
});
