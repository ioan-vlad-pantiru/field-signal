/**
 * Season timeline for the simulator: for each crop of a rotation, bare soil → sow → grow →
 * harvest, on a month calendar so bare-field periods show at their real length. Typical sowing and
 * harvest months for Transylvania (Alba county); illustrative, a farmer's own dates will differ.
 *
 * Season = harvest year (contracts convention): winter wheat sown in October is the next year's
 * season. Pure module, no DOM.
 */

import type { Crop } from "../contracts.ts";

export interface CropCalendar {
  /** Sowing month, 1–12. */
  sow: number;
  /** Harvest (or, for cover crops, termination) month, 1–12, in the season year. */
  harvest: number;
  /** Sown in the autumn before the season year. */
  autumnSown: boolean;
}

export const CROP_CALENDAR: Record<Crop, CropCalendar | null> = {
  maize: { sow: 4, harvest: 10, autumnSown: false },
  sunflower: { sow: 4, harvest: 9, autumnSown: false },
  soybean: { sow: 5, harvest: 9, autumnSown: false },
  pea: { sow: 3, harvest: 7, autumnSown: false },
  wheat: { sow: 10, harvest: 7, autumnSown: true },
  barley: { sow: 10, harvest: 6, autumnSown: true },
  cover_mustard: { sow: 8, harvest: 3, autumnSown: true },
  cover_phacelia: { sow: 8, harvest: 3, autumnSown: true },
  cover_vetch: { sow: 9, harvest: 4, autumnSown: true },
  fallow: null,
};

export const isCoverCrop = (crop: Crop) => crop.startsWith("cover_");

export type PhaseKind = "bare" | "sow" | "grow" | "harvest" | "fallow";

export interface Phase {
  kind: PhaseKind;
  /** Index into the rotation sequence; for `bare`, the crop that comes next. */
  cropIndex: number;
  crop: Crop;
  /** Animation start and length, seconds at 1×. */
  start: number;
  duration: number;
  /** Calendar months since January of the year before the first season (0 = Jan, year 0). */
  monthStart: number;
  monthEnd: number;
}

export interface Timeline {
  sequence: readonly Crop[];
  phases: Phase[];
  /** Total length in seconds at 1×. */
  duration: number;
  /** Months of bare soil between crops, one entry per gap, for the summary. */
  bareGaps: { afterCrop: Crop | null; beforeCrop: Crop; months: number }[];
}

/** Animation pacing at 1×. Field passes are fixed-length; calendar stretches scale with months. */
export const PACING = {
  sowSec: 18,
  harvestSec: 12,
  growSecPerMonth: 1.1,
  bareSecPerMonth: 0.9,
  minBareSec: 1.2,
  introMonths: 1,
} as const;

export function buildTimeline(sequence: readonly Crop[]): Timeline {
  const phases: Phase[] = [];
  const bareGaps: Timeline["bareGaps"] = [];
  let t = 0;
  // Month cursor: the last month the field was occupied.
  let cursor: number | null = null;
  const push = (p: Omit<Phase, "start">) => {
    phases.push({ ...p, start: t });
    t += p.duration;
  };

  sequence.forEach((crop, i) => {
    // Season year i + 1; months counted from January of year 0.
    const seasonYearStart = (i + 1) * 12;
    const cal = CROP_CALENDAR[crop];
    if (!cal) {
      const start = cursor ?? seasonYearStart;
      const end = Math.max(start, seasonYearStart + 11);
      push({ kind: "fallow", cropIndex: i, crop, duration: Math.max(PACING.minBareSec, (end - start) * PACING.bareSecPerMonth), monthStart: start, monthEnd: end });
      cursor = end;
      return;
    }
    const harvest = seasonYearStart + cal.harvest - 1;
    let sow = (cal.autumnSown ? seasonYearStart - 12 : seasonYearStart) + cal.sow - 1;
    const intro = cursor === null;
    if (cursor !== null && sow < cursor) sow = cursor; // previous crop still on the field
    const bareFrom = cursor ?? sow - PACING.introMonths;
    const bareMonths = sow - bareFrom;
    if (!intro) bareGaps.push({ afterCrop: sequence[i - 1] ?? null, beforeCrop: crop, months: bareMonths });
    if (bareMonths > 0 || intro) {
      push({
        kind: "bare",
        cropIndex: i,
        crop,
        duration: Math.max(PACING.minBareSec, bareMonths * PACING.bareSecPerMonth),
        monthStart: bareFrom,
        monthEnd: sow,
      });
    }
    push({ kind: "sow", cropIndex: i, crop, duration: PACING.sowSec, monthStart: sow, monthEnd: sow });
    push({ kind: "grow", cropIndex: i, crop, duration: Math.max(2, (harvest - sow) * PACING.growSecPerMonth), monthStart: sow, monthEnd: harvest });
    push({ kind: "harvest", cropIndex: i, crop, duration: PACING.harvestSec, monthStart: harvest, monthEnd: harvest });
    cursor = harvest;
  });

  // A short bare stretch at the end so the last harvest is visible before the loop restarts.
  if (cursor !== null) {
    const last = sequence.length - 1;
    push({ kind: "bare", cropIndex: last, crop: sequence[last], duration: 2, monthStart: cursor, monthEnd: cursor + 2 });
  }

  return { sequence, phases, duration: t, bareGaps };
}

export interface TimelineState {
  phase: Phase;
  phaseIndex: number;
  /** 0–1 through the current phase. */
  progress: number;
  /** Interpolated calendar month (fractional), same origin as `Phase.monthStart`. */
  month: number;
}

export function stateAt(timeline: Timeline, time: number): TimelineState {
  const t = Math.max(0, Math.min(time, timeline.duration));
  let index = timeline.phases.findIndex((p) => t < p.start + p.duration);
  if (index === -1) index = timeline.phases.length - 1;
  const phase = timeline.phases[index];
  const progress = phase.duration > 0 ? Math.min(1, Math.max(0, (t - phase.start) / phase.duration)) : 1;
  return { phase, phaseIndex: index, progress, month: phase.monthStart + (phase.monthEnd - phase.monthStart) * progress };
}

/** Year (1-based, counted from the first season's year minus one) and month (1–12). */
export function calendarOf(month: number): { year: number; month: number } {
  const m = Math.floor(month);
  return { year: Math.floor(m / 12), month: (m % 12) + 1 };
}

/**
 * Start times of "snapshot" moments for reduced motion and the step buttons: right after sowing,
 * at full growth, and after harvest, for each crop.
 */
export function snapshotTimes(timeline: Timeline): number[] {
  const out: number[] = [];
  for (const p of timeline.phases) {
    if (p.kind === "sow" || p.kind === "grow" || p.kind === "harvest" || p.kind === "fallow") out.push(p.start + p.duration);
  }
  return out.map((t) => Math.min(t, timeline.duration - 1e-3));
}
