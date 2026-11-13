/**
 * What the field looks like at a given animation time: where the drill is, which crop is up,
 * how grown and how ripe it is. One pure function shared by the 3D scene and the 2D fallback, so
 * both always tell the same story.
 */

import type { Crop } from "../contracts.ts";
import { centroid } from "./geometry.ts";
import { poseAt, type FieldWorkPlan, type Pose } from "./path-planner.ts";
import { stateAt, type PhaseKind, type Timeline } from "./timeline.ts";

/** Larger than any path distance: "everything up to here". */
export const ALL = 1e9;
/** Smaller than any path distance: "nothing yet". */
export const NONE = -1;

export type Implement = "drill" | "header" | "none";

export interface SceneState {
  kind: PhaseKind;
  /** Crop shown on the field (for a bare stretch right after harvest, the crop just harvested). */
  crop: Crop;
  cropIndex: number;
  /** Path distance the drill has reached this season (ALL once sowing is done, NONE before). */
  sowD: number;
  /** Path distance the harvester has reached (ALL once harvested, NONE before). */
  harvestD: number;
  /** 0–1 plant size. */
  growth: number;
  /** 0–1 how far the crop has turned to its ripe colour. */
  ripe: number;
  /** True while the soil is bare (no crop, no stubble). */
  bare: boolean;
  tractor: Pose & { implement: Implement; d: number };
  /** Progress through the current phase, 0–1. */
  progress: number;
  month: number;
  phaseIndex: number;
}

export function sceneStateAt(timeline: Timeline, plan: FieldWorkPlan, time: number): SceneState {
  const s = stateAt(timeline, time);
  const { phase, progress } = s;
  const total = plan.totalDistanceM;
  const parked = { ...parkingPose(plan), working: false, implement: "none" as Implement, d: 0 };
  const base = { kind: phase.kind, progress, month: s.month, phaseIndex: s.phaseIndex };

  switch (phase.kind) {
    case "sow": {
      const d = ease(progress) * total;
      return {
        ...base,
        crop: phase.crop,
        cropIndex: phase.cropIndex,
        sowD: d,
        harvestD: NONE,
        growth: 0.06,
        ripe: 0,
        bare: false,
        tractor: { ...poseAt(plan, d), implement: "drill", d },
      };
    }
    case "grow":
      return {
        ...base,
        crop: phase.crop,
        cropIndex: phase.cropIndex,
        sowD: ALL,
        harvestD: NONE,
        growth: 0.06 + 0.94 * smooth(progress),
        ripe: Math.max(0, (progress - 0.72) / 0.28),
        bare: false,
        tractor: parked,
      };
    case "harvest": {
      const d = ease(progress) * total;
      return {
        ...base,
        crop: phase.crop,
        cropIndex: phase.cropIndex,
        sowD: ALL,
        harvestD: d,
        growth: 1,
        ripe: 1,
        bare: false,
        tractor: { ...poseAt(plan, d), implement: "header", d },
      };
    }
    case "fallow":
    case "bare": {
      // Keep the stubble of the crop just harvested for the first part of the gap, then till it in.
      const prev = timeline.phases[s.phaseIndex - 1];
      if (prev && prev.kind === "harvest" && progress < 0.3) {
        return {
          ...base,
          crop: prev.crop,
          cropIndex: prev.cropIndex,
          sowD: ALL,
          harvestD: ALL,
          growth: 1,
          ripe: 1,
          bare: false,
          tractor: parked,
        };
      }
      return {
        ...base,
        crop: phase.crop,
        cropIndex: phase.cropIndex,
        sowD: NONE,
        harvestD: NONE,
        growth: 0,
        ripe: 0,
        bare: true,
        tractor: parked,
      };
    }
  }
}

/** Where the tractor waits between field operations: just outside the corner nearest the start. */
export function parkingPose(plan: FieldWorkPlan): Pose {
  const start = poseAt(plan, 0);
  const c = centroid(plan.outline);
  let corner = plan.outline[0];
  let best = Infinity;
  for (const v of plan.outline) {
    const d = Math.hypot(v[0] - start.x, v[1] - start.y);
    if (d < best) {
      best = d;
      corner = v;
    }
  }
  const away = Math.atan2(corner[1] - c[1], corner[0] - c[0]);
  const x = corner[0] + Math.cos(away) * 14;
  const y = corner[1] + Math.sin(away) * 14;
  return { x, y, heading: Math.atan2(start.y - y, start.x - x), working: false };
}

/** Sine in-out: the tractor pulls away and slows down, instead of starting at full time-lapse speed. */
function ease(t: number) {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}
