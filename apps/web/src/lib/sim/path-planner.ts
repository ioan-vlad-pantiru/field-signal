/**
 * ILLUSTRATIVE field-work path for the 3D simulator: back-and-forth (boustrophedon) passes across
 * the field interior, U-turns in the headland, then laps around the edge to work the headland
 * last, as most farmers do. It shows a farmer roughly how a drill covers the field. It is not a
 * machine-control or guidance plan: no turning radius, slope, obstacles or overlap control.
 *
 * Pure function of the outline and the options; no DOM or three.js. Units are metres.
 */

import {
  bounds,
  distance,
  distanceToSegment,
  insetPolygon,
  pointInPolygon,
  polygonArea,
  scanline,
  type Polygon,
  type Vec2,
} from "./geometry.ts";

export interface PlannerOptions {
  /** Width worked in one pass, e.g. a 6 m seed drill. */
  workingWidthM: number;
  /** Laps around the edge; the headland is `headlandLaps × workingWidthM` wide. */
  headlandLaps: number;
}

export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = { workingWidthM: 6, headlandLaps: 2 };

export interface PathPoint {
  x: number;
  y: number;
  /** Distance driven from the start of the path to this point. */
  d: number;
  /** True when the implement is working on the way to this point (false on turns and transits). */
  working: boolean;
}

export interface Pass {
  start: Vec2;
  end: Vec2;
  length: number;
}

export interface FieldWorkPlan {
  outline: Polygon;
  /** The interior worked by straight passes (the outline inset by the headland width). */
  interior: Polygon;
  workingWidthM: number;
  headlandWidthM: number;
  /** Straight passes in the order driven. */
  passes: Pass[];
  /** Headland laps in the order driven (innermost first). Each is the lap's centre line. */
  headlandLaps: Polygon[];
  path: PathPoint[];
  fieldAreaM2: number;
  totalDistanceM: number;
  workingDistanceM: number;
  turnDistanceM: number;
}

/** Plans the path. Throws for a field too small to hold the headland. */
export function planFieldWork(outline: Polygon, options: PlannerOptions = DEFAULT_PLANNER_OPTIONS): FieldWorkPlan {
  const w = options.workingWidthM;
  if (!(w > 0)) throw new Error("workingWidthM must be positive");
  if (outline.length < 3) throw new Error("outline needs at least 3 points");
  const headlandWidthM = Math.max(0, Math.round(options.headlandLaps)) * w;
  const interior = headlandWidthM > 0 ? insetPolygon(outline, headlandWidthM) : outline;
  if (polygonArea(interior) < w * w) throw new Error("field too small for this headland");

  const passes = orderPasses(interiorSegments(interior, w));

  const builder = new PathBuilder();
  passes.forEach((pass, i) => {
    if (i === 0) builder.moveTo(pass.start);
    else builder.turnTo(passes[i - 1], pass, w);
    builder.lineTo(pass.end, true);
  });

  const headlandLaps: Polygon[] = [];
  for (let k = options.headlandLaps - 1; k >= 0; k--) {
    // Lap centre line: half a working width inside the outer edge of its strip.
    const lap = insetPolygon(outline, k * w + w / 2);
    const startIndex = nearestVertex(lap, builder.last());
    const ordered = [...lap.slice(startIndex), ...lap.slice(0, startIndex)];
    headlandLaps.push(ordered);
    builder.lineTo(ordered[0], false);
    for (let i = 1; i <= ordered.length; i++) builder.lineTo(ordered[i % ordered.length], true);
  }

  const path = builder.points;
  let workingDistanceM = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i].working) workingDistanceM += path[i].d - path[i - 1].d;
  }
  const totalDistanceM = path.length ? path[path.length - 1].d : 0;

  return {
    outline,
    interior,
    workingWidthM: w,
    headlandWidthM,
    passes,
    headlandLaps,
    path,
    fieldAreaM2: polygonArea(outline),
    totalDistanceM,
    workingDistanceM,
    turnDistanceM: totalDistanceM - workingDistanceM,
  };
}

/** Straight east-west segments, one working width apart, that cover the interior. */
function interiorSegments(interior: Polygon, w: number): { line: number; pass: Pass }[] {
  const { minY, maxY } = bounds(interior);
  const height = maxY - minY;
  const lines = Math.max(1, Math.ceil(height / w - 1e-6));
  const out: { line: number; pass: Pass }[] = [];
  for (let i = 0; i < lines; i++) {
    // Space passes w apart; the last one is pulled back inside so it overlaps rather than spills.
    const y = Math.min(minY + w / 2 + i * w, maxY - w / 2);
    const xs = scanline(interior, y);
    for (let j = 0; j + 1 < xs.length; j += 2) {
      const length = xs[j + 1] - xs[j];
      if (length < 1) continue;
      out.push({ line: i, pass: { start: [xs[j], y], end: [xs[j + 1], y], length } });
    }
  }
  return out;
}

/**
 * Orders segments greedily: keep sweeping to the neighbouring line while it overlaps the current
 * pass, otherwise jump to the nearest unworked segment. On an L-shaped field this finishes one
 * lobe before moving to the other, instead of crossing the notch on every pass.
 */
function orderPasses(segments: { line: number; pass: Pass }[]): Pass[] {
  if (segments.length === 0) return [];
  const remaining = [...segments];
  const ordered: Pass[] = [];
  let current = remaining.shift()!;
  ordered.push(current.pass);
  while (remaining.length) {
    const cur = current;
    const [cx0, cx1] = xRange(cur.pass);
    let nextIndex = remaining.findIndex((s) => {
      if (Math.abs(s.line - cur.line) !== 1) return false;
      const [x0, x1] = xRange(s.pass);
      return x0 < cx1 && x1 > cx0;
    });
    const here = cur.pass.end;
    if (nextIndex === -1) {
      let best = Infinity;
      remaining.forEach((s, i) => {
        const dd = Math.min(distance(here, s.pass.start), distance(here, s.pass.end));
        if (dd < best) {
          best = dd;
          nextIndex = i;
        }
      });
    }
    const next = remaining.splice(nextIndex, 1)[0];
    // Start each pass at the end nearer the tractor.
    const flip = distance(here, next.pass.end) < distance(here, next.pass.start);
    const pass: Pass = flip ? { start: next.pass.end, end: next.pass.start, length: next.pass.length } : next.pass;
    current = { line: next.line, pass };
    ordered.push(pass);
  }
  return ordered;
}

function xRange(p: Pass): [number, number] {
  return [Math.min(p.start[0], p.end[0]), Math.max(p.start[0], p.end[0])];
}

function nearestVertex(polygon: Polygon, p: Vec2): number {
  let best = 0;
  let bestD = Infinity;
  polygon.forEach((v, i) => {
    const dd = distance(v, p);
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  });
  return best;
}

class PathBuilder {
  points: PathPoint[] = [];

  last(): Vec2 {
    const p = this.points[this.points.length - 1];
    return p ? [p.x, p.y] : [0, 0];
  }

  moveTo(p: Vec2) {
    this.points.push({ x: p[0], y: p[1], d: 0, working: false });
  }

  lineTo(p: Vec2, working: boolean) {
    const prev = this.points[this.points.length - 1];
    if (!prev) return this.moveTo(p);
    const step = Math.hypot(p[0] - prev.x, p[1] - prev.y);
    if (step < 1e-6) return;
    this.points.push({ x: p[0], y: p[1], d: prev.d + step, working });
  }

  /** A headland turn: a smooth U (cubic Bézier) out past the end of one pass and into the next. */
  turnTo(from: Pass, to: Pass, w: number) {
    const outDir = unit(from.start, from.end);
    const inDir = unit(to.start, to.end);
    const gap = distance(from.end, to.start);
    const reach = Math.max(w * 0.75, gap * 0.35);
    const p0 = from.end;
    const p1: Vec2 = [p0[0] + outDir[0] * reach, p0[1] + outDir[1] * reach];
    const p3 = to.start;
    const p2: Vec2 = [p3[0] - inDir[0] * reach, p3[1] - inDir[1] * reach];
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
      const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
      this.lineTo([x, y], false);
    }
  }
}

function unit(a: Vec2, b: Vec2): Vec2 {
  const len = distance(a, b) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}

export interface Pose {
  x: number;
  y: number;
  /** Heading in radians, counter-clockwise from east. */
  heading: number;
  working: boolean;
}

/** Where the tractor is after driving `d` metres along the path. */
export function poseAt(plan: FieldWorkPlan, d: number): Pose {
  const path = plan.path;
  if (path.length === 0) return { x: 0, y: 0, heading: 0, working: false };
  if (path.length === 1 || d <= 0) {
    const b = path[Math.min(1, path.length - 1)];
    return { x: path[0].x, y: path[0].y, heading: Math.atan2(b.y - path[0].y, b.x - path[0].x), working: false };
  }
  const last = path[path.length - 1];
  if (d >= last.d) {
    const prev = path[path.length - 2];
    return { x: last.x, y: last.y, heading: Math.atan2(last.y - prev.y, last.x - prev.x), working: false };
  }
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const t = (d - a.d) / (b.d - a.d || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.y - a.y, b.x - a.x), working: b.working };
}

export interface WorkSample {
  x: number;
  y: number;
  /** Path distance at which the implement reaches this spot. */
  d: number;
}

/**
 * Points along every working stretch of the path, `spacingM` apart, repeated at each lateral
 * offset (e.g. seed rows across the drill). Used to place plants that appear as the drill passes.
 */
export function sampleWork(plan: FieldWorkPlan, spacingM: number, lateralOffsetsM: number[] = [0]): WorkSample[] {
  const out: WorkSample[] = [];
  const path = plan.path;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!b.working) continue;
    const len = b.d - a.d;
    const dx = (b.x - a.x) / len;
    const dy = (b.y - a.y) / len;
    // Normal to the left of the direction of travel.
    const nx = -dy;
    const ny = dx;
    for (let s = spacingM / 2; s < len; s += spacingM) {
      for (const off of lateralOffsetsM) {
        const x = a.x + dx * s + nx * off;
        const y = a.y + dy * s + ny * off;
        if (pointInPolygon([x, y], plan.outline)) out.push({ x, y, d: a.d + s });
      }
    }
  }
  return out;
}

/**
 * Share of the field (0–1) within half a working width of a working stretch, sampled on a grid.
 * Used by the tests and as a sanity check; not shown as a precise number.
 */
export function coverage(plan: FieldWorkPlan, gridM = 2): number {
  const { minX, minY, maxX, maxY } = bounds(plan.outline);
  const segments: [Vec2, Vec2][] = [];
  for (let i = 1; i < plan.path.length; i++) {
    const a = plan.path[i - 1];
    const b = plan.path[i];
    if (b.working) segments.push([[a.x, a.y], [b.x, b.y]]);
  }
  const reach = plan.workingWidthM / 2 + 1e-6;
  let inside = 0;
  let covered = 0;
  for (let y = minY + gridM / 2; y < maxY; y += gridM) {
    for (let x = minX + gridM / 2; x < maxX; x += gridM) {
      const p: Vec2 = [x, y];
      if (!pointInPolygon(p, plan.outline)) continue;
      inside++;
      if (segments.some(([a, b]) => distanceToSegment(p, a, b) <= reach)) covered++;
    }
  }
  return inside ? covered / inside : 0;
}

/** Rough hours on the field: working stretches at `workKmh`, turns and transits at `turnKmh`. */
export function estimateHours(plan: FieldWorkPlan, workKmh = 10, turnKmh = 5): number {
  return plan.workingDistanceM / 1000 / workKmh + plan.turnDistanceM / 1000 / turnKmh;
}
