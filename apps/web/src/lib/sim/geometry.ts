/**
 * Small 2D geometry helpers for the field simulator. Pure functions, no DOM or three.js, so the
 * path planner and its unit tests can run under plain Node.
 *
 * Coordinates are local metres: x points east, y points north. Polygons are arrays of vertices
 * without a repeated closing point, in either winding order.
 */

export type Vec2 = [number, number];
export type Polygon = Vec2[];

const METRES_PER_DEGREE_LAT = 111_320;

/** Signed area (positive when counter-clockwise). */
export function signedArea(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function polygonArea(polygon: Polygon): number {
  return Math.abs(signedArea(polygon));
}

export function perimeter(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    sum += distance(polygon[i], polygon[(i + 1) % polygon.length]);
  }
  return sum;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function bounds(polygon: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

export function centroid(polygon: Polygon): Vec2 {
  const b = bounds(polygon);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon([px, py]: Vec2, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a segment. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Moves every edge inwards by `d` metres and joins neighbouring edges at their intersection.
 * Exact for convex polygons and fine for gently concave fields; very sharp spikes are not handled
 * (good enough for an illustration, and the tests cover an L-shaped field).
 */
export function insetPolygon(polygon: Polygon, d: number): Polygon {
  const ccw = signedArea(polygon) > 0;
  const n = polygon.length;
  const lines: { p: Vec2; dir: Vec2 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const len = distance(a, b) || 1;
    const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    // Inward normal: left of the edge for CCW polygons, right for CW.
    const normal: Vec2 = ccw ? [-dir[1], dir[0]] : [dir[1], -dir[0]];
    lines.push({ p: [a[0] + normal[0] * d, a[1] + normal[1] * d], dir });
  }
  const out: Polygon = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    out.push(intersectLines(prev.p, prev.dir, cur.p, cur.dir) ?? cur.p);
  }
  return out;
}

function intersectLines(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / cross;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/** X positions where the horizontal line `y` crosses the polygon, sorted west to east. */
export function scanline(polygon: Polygon, y: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    if (y1 === y2) continue;
    if ((y >= Math.min(y1, y2)) && (y < Math.max(y1, y2))) {
      xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
  }
  return xs.sort((a, b) => a - b);
}

/** Equirectangular projection around `origin`; plenty accurate for a field a few hundred metres wide. */
export function toLocalMetres(points: { lat: number; lon: number }[], origin: { lat: number; lon: number }): Polygon {
  const mPerLon = METRES_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return points.map((p) => [(p.lon - origin.lon) * mPerLon, (p.lat - origin.lat) * METRES_PER_DEGREE_LAT]);
}

/** The demo field: a 400 m × 250 m (10 ha) rectangle, centred on the origin. */
export const DEMO_FIELD_RECT: Polygon = [
  [-200, -125],
  [200, -125],
  [200, 125],
  [-200, 125],
];

/** An irregular demo field (≈ 9.6 ha): a rectangle with a cut corner and a slanted side. */
export const DEMO_FIELD_IRREGULAR: Polygon = [
  [-210, -120],
  [150, -120],
  [215, -30],
  [190, 130],
  [-40, 130],
  [-40, 60],
  [-210, 40],
];

/** Demo pin near Aiud, Alba county (the same area the farmer screen starts on). */
export const DEMO_FIELD_ORIGIN = { lat: 46.31, lon: 23.72 };
