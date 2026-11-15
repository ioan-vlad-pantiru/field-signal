import type { LatLon } from "./contracts.ts";

/**
 * SVG path data for a field's outline(s), fitted into a `size`×`size` box with `pad` around it.
 * Longitude is scaled by cos(latitude) so the shape keeps its real proportions.
 */
export function shapePath(rings: readonly (readonly LatLon[])[], size = 48, pad = 4): string {
  const points = rings.flat();
  if (points.length < 3) return "";
  const lat0 = (points.reduce((s, p) => s + p.lat, 0) / points.length) * (Math.PI / 180);
  const kx = Math.cos(lat0);
  const xs = points.map((p) => p.lon * kx);
  const ys = points.map((p) => p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (size - pad * 2) / span;
  const offX = (size - (maxX - minX) * scale) / 2;
  const offY = (size - (maxY - minY) * scale) / 2;
  const fmt = (v: number) => Number(v.toFixed(1));
  return rings
    .filter((ring) => ring.length >= 3)
    .map(
      (ring) =>
        ring
          .map((p, i) => `${i === 0 ? "M" : "L"}${fmt(offX + (p.lon * kx - minX) * scale)} ${fmt(offY + (maxY - p.lat) * scale)}`)
          .join("") + "Z",
    )
    .join("");
}
