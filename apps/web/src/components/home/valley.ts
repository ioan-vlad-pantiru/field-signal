/**
 * A made-up Transylvanian valley for the start page: rolling farmland between forested mountains,
 * a road, a river and a village, cut into plots along the field plan's plot axis. Deterministic,
 * so every visit draws the same valley.
 *
 * Units: 1 = 100 m. x is east, z is south (three.js), y is up.
 */
import { HEX_SIDE_M } from "@/lib/field-plan";
import type { NonFarmland } from "@/lib/land-cover";

export const HEX_SIDE = HEX_SIDE_M / 100;
/** The area searched for farmland: the valley between the mountains, north of the river. */
export const FIELD_HALF_WIDTH = 22;
export const FIELD_NORTH = 13;
/** Past this the land is river bank or hillside: `riverZ` peaks at 8.3. */
export const FIELD_SOUTH = 10;
export const WATER_LEVEL = -0.08;
export const ROAD_HALF_WIDTH = 0.13;
export const RIVER_HALF_WIDTH = 0.34;
const PLOT_AXIS_DEG = -24;
const PLOT_ANGLE = (PLOT_AXIS_DEG * Math.PI) / 180;

/** Distance along the plot axis (local north is −z). */
const plotAxis = (x: number, z: number) => x * Math.cos(PLOT_ANGLE) - z * Math.sin(PLOT_ANGLE);

const PLOT_AXIS_RANGE = (() => {
  const us = [-FIELD_HALF_WIDTH, FIELD_HALF_WIDTH].flatMap((x) =>
    [-FIELD_NORTH, FIELD_SOUTH].map((z) => plotAxis(x, z)),
  );
  return [Math.min(...us), Math.max(...us)] as const;
})();

// ---------------------------------------------------------------------------------------------
// Noise

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq + i * 17.3, y * freq - i * 9.1);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function ridged(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(2 * noise(x * freq + i * 31.7, y * freq + i * 5.3) - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Landscape features

/** The road's centreline: crosses the valley west to east, right through the field. */
export const roadZ = (x: number) => 0.9 + 2.3 * Math.sin(x * 0.13 + 0.4);
/** The river: south of the road, clipping the field's southern edge. */
export const riverZ = (x: number) => 6.9 + 1.4 * Math.sin(x * 0.17 + 1.1);

/** A forested hill reaching into the field from the north-east. */
function spur(x: number, z: number): number {
  return Math.exp(-((x - 5.6) ** 2) / 5.5 - ((z + 3.6) ** 2) / 3.2);
}

/** How mountainous the land is: the Carpathians to the north, east and west. */
function mountainMask(x: number, z: number): number {
  return Math.max(
    smoothstep(7.5, 16, -z),
    smoothstep(15, 25, Math.abs(x)) * smoothstep(-2, 6, -z + 4),
    0.3 * smoothstep(11, 22, z),
  );
}

function heightRaw(x: number, z: number): number {
  let h = Math.max(0.1 + (fbm(x * 0.09, z * 0.09, 3) - 0.5) * 0.45, 0.03);
  const m = mountainMask(x, z);
  h += m * (0.6 + 7.5 * ridged(x * 0.06 + 3, z * 0.06 - 2, 5) * (0.5 + 0.5 * m));
  h += 1.7 * spur(x, z) * (0.8 + 0.4 * fbm(x * 0.4, z * 0.4, 2));
  const dr = Math.abs(z - riverZ(x));
  h = h + (-0.42 - h) * smoothstep(0.8, 0.22, dr);
  return h;
}

/** Ground height, with the road bed levelled across. */
export function heightAt(x: number, z: number): number {
  const raw = heightRaw(x, z);
  const rz = roadZ(x);
  const d = Math.abs(z - rz);
  if (d > 0.9) return raw;
  const bed = Math.max(heightRaw(x, rz), 0.04);
  return raw + (bed - raw) * smoothstep(0.9, 0.3, d);
}

export function isForest(x: number, z: number): boolean {
  const h = heightRaw(x, z);
  if (h > 6.2) return false; // bare rock above the tree line
  if (spur(x, z) > 0.32) return true;
  if (mountainMask(x, z) > 0.22) return true;
  return fbm(x * 0.17 + 40, z * 0.17 + 7, 3) > 0.7 && Math.abs(z - riverZ(x)) > 0.6;
}

export const distToRoad = (x: number, z: number) => Math.abs(z - roadZ(x)) / Math.hypot(1, 0.3 * Math.cos(x * 0.13 + 0.4));
export const distToRiver = (x: number, z: number) => Math.abs(z - riverZ(x)) / Math.hypot(1, 0.24 * Math.cos(x * 0.17 + 1.1));

// ---------------------------------------------------------------------------------------------
// Village

export interface House {
  x: number;
  z: number;
  angle: number;
  w: number;
  d: number;
  h: number;
}

/** A street village along the road, at the field's western edge. */
export function village(): House[] {
  const rand = mulberry32(7);
  const houses: House[] = [];
  for (let x = -10.8; x < -4.6; x += 0.62 + rand() * 0.35) {
    for (const side of [-1, 1]) {
      if (rand() < 0.2) continue;
      const rz = roadZ(x);
      const slope = 2.3 * 0.13 * Math.cos(x * 0.13 + 0.4);
      const offset = side * (0.42 + rand() * 0.25);
      const z = rz + offset;
      if (distToRiver(x, z) < RIVER_HALF_WIDTH + 0.4) continue;
      houses.push({
        x,
        z,
        angle: -Math.atan(slope),
        w: 0.26 + rand() * 0.1,
        d: 0.2 + rand() * 0.06,
        h: 0.14 + rand() * 0.06,
      });
    }
  }
  return houses;
}

// ---------------------------------------------------------------------------------------------
// The field

/** Pointy-top hexagon outline, inset by `scale`: 12 points, corners and edge midpoints. */
export function hexRing(cx: number, cz: number, scale = 1): [number, number][] {
  const s = HEX_SIDE * scale;
  const pts: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a0 = ((60 * k - 30) * Math.PI) / 180;
    const a1 = ((60 * (k + 1) - 30) * Math.PI) / 180;
    // Local north is −z, so the angle runs counter-clockwise seen from above.
    const p0: [number, number] = [cx + s * Math.cos(a0), cz - s * Math.sin(a0)];
    const p1: [number, number] = [cx + s * Math.cos(a1), cz - s * Math.sin(a1)];
    pts.push(p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]);
  }
  return pts;
}

/** Why the land at a point cannot be farmed, sampled over one hexagon's worth of ground. */
function classify(cx: number, cz: number, houses: readonly House[]): NonFarmland | null {
  const samples: [number, number][] = [[cx, cz], ...hexRing(cx, cz, 0.92).filter((_, i) => i % 2 === 0)];
  if (samples.some(([x, z]) => distToRiver(x, z) < RIVER_HALF_WIDTH + 0.05)) return "water";
  if (samples.some(([x, z]) => distToRoad(x, z) < ROAD_HALF_WIDTH + 0.04)) return "road";
  if (houses.some((h) => Math.hypot(h.x - cx, h.z - cz) < HEX_SIDE * 0.95)) return "building";
  const forest = samples.filter(([x, z]) => isForest(x, z)).length;
  const heights = samples.map(([x, z]) => heightAt(x, z));
  const relief = Math.max(...heights) - Math.min(...heights);
  if (forest >= 3 || relief > 0.32) return "woods";
  return null;
}

/**
 * The plot under a point, as an index in `0..plotCount-1`, or −1 where the land is not farmed.
 * Plots are straight bands across the valley floor along the plot axis, cut off by the road,
 * river, village and woods, so nothing of the hexagon grid shows.
 */
export function fieldPlotAt(x: number, z: number, houses: readonly House[], plotCount: number): number {
  if (Math.abs(x) > FIELD_HALF_WIDTH || z < -FIELD_NORTH || z > riverZ(x) + RIVER_HALF_WIDTH + HEX_SIDE) return -1;
  if (classify(x, z, houses)) return -1;
  const { axisX, axisZ, u0, width } = plotBands(plotCount);
  const band = Math.floor((x * axisX + z * axisZ - u0) / width);
  return Math.min(Math.max(band, 0), plotCount - 1);
}

/** The plot bands' layout: axis direction, first edge and one band's width along it. */
export function plotBands(plotCount: number) {
  return {
    axisX: Math.cos(PLOT_ANGLE),
    axisZ: -Math.sin(PLOT_ANGLE),
    u0: PLOT_AXIS_RANGE[0],
    width: (PLOT_AXIS_RANGE[1] - PLOT_AXIS_RANGE[0]) / plotCount,
  };
}
