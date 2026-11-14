import type { LatLon } from "@/lib/contracts";

/**
 * Small-area geometry for a field the farmer draws. A field is at most a few km across,
 * so a local flat projection around its first corner is accurate to well under 1 %.
 */

const METRES_PER_DEGREE_LAT = 111_320;

function toMetres(origin: LatLon, p: LatLon): [number, number] {
  const metresPerDegreeLon = METRES_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return [(p.lon - origin.lon) * metresPerDegreeLon, (p.lat - origin.lat) * METRES_PER_DEGREE_LAT];
}

/** Area of a simple polygon in hectares (shoelace formula). */
export function polygonAreaHa(corners: LatLon[]): number {
  if (corners.length < 3) return 0;
  const pts = corners.map((c) => toMetres(corners[0], c));
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2 / 10_000;
}

/** Area-weighted centroid; falls back to the mean of the corners for a degenerate shape. */
export function polygonCentroid(corners: LatLon[]): LatLon {
  const mean = {
    lat: corners.reduce((s, c) => s + c.lat, 0) / corners.length,
    lon: corners.reduce((s, c) => s + c.lon, 0) / corners.length,
  };
  if (corners.length < 3) return mean;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % corners.length];
    const cross = p.lon * q.lat - q.lon * p.lat;
    a += cross;
    cx += (p.lon + q.lon) * cross;
    cy += (p.lat + q.lat) * cross;
  }
  if (Math.abs(a) < 1e-12) return mean;
  return { lon: cx / (3 * a), lat: cy / (3 * a) };
}

/** Ray-casting test; `point` is [lon, lat] like MapLibre coordinates. */
export function insidePolygon(point: [number, number], corners: LatLon[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i].lon;
    const yi = corners[i].lat;
    const xj = corners[j].lon;
    const yj = corners[j].lat;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Farthest corner from `center`, in metres. */
export function radiusMetres(center: LatLon, corners: LatLon[]): number {
  return Math.max(...corners.map((c) => Math.hypot(...toMetres(center, c))));
}

/** A field: its main outline and, when its parcels do not touch, further pieces. */
export interface FieldShape {
  boundary: LatLon[];
  parts?: LatLon[][] | null;
}

/** Every outline of a field, the main one first. */
export function fieldRings(field: FieldShape): LatLon[][] {
  return [field.boundary, ...(field.parts ?? [])].filter((ring) => ring.length >= 3);
}

/** A field's area in hectares, all its pieces together. */
export function fieldAreaHa(field: FieldShape): number {
  return fieldRings(field).reduce((sum, ring) => sum + polygonAreaHa(ring), 0);
}

/** Area-weighted centre of all of a field's pieces. */
export function fieldCentroid(field: FieldShape): LatLon {
  const rings = fieldRings(field);
  if (rings.length <= 1) return polygonCentroid(field.boundary);
  let lat = 0;
  let lon = 0;
  let total = 0;
  for (const ring of rings) {
    const a = polygonAreaHa(ring);
    const c = polygonCentroid(ring);
    lat += c.lat * a;
    lon += c.lon * a;
    total += a;
  }
  return total > 0 ? { lat: lat / total, lon: lon / total } : polygonCentroid(field.boundary);
}
