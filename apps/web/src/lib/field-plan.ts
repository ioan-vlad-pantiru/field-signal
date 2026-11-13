import type { Crop, LatLon } from "@/lib/contracts";

/**
 * ILLUSTRATIVE field layout. The contracts carry only a point, not the field boundary, so we
 * draw a plausible field around the pin and split it into one plot per year of the rotation.
 * Each plot starts the rotation at a different year (a staggered rotation), so every crop of
 * the plan is on the farm every season, which is how farmers usually run a rotation.
 */

export interface Plot {
  /** "A", "B", ... */
  id: string;
  /** Closed ring of [lon, lat] pairs. */
  ring: [number, number][];
  centroid: [number, number];
  areaHa: number;
}

export interface FieldLayout {
  plots: Plot[];
  outline: [number, number][];
  totalHa: number;
}

const FIELD_LENGTH_M = 640;
const FIELD_WIDTH_M = 360;
/** Field rows rarely run due north; a slight angle reads as a real parcel. */
const FIELD_BEARING_DEG = -24;
const METRES_PER_DEGREE_LAT = 111_320;

function toLonLat(origin: LatLon, xMetres: number, yMetres: number): [number, number] {
  const angle = (FIELD_BEARING_DEG * Math.PI) / 180;
  const x = xMetres * Math.cos(angle) - yMetres * Math.sin(angle);
  const y = xMetres * Math.sin(angle) + yMetres * Math.cos(angle);
  const metresPerDegreeLon = METRES_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return [origin.lon + x / metresPerDegreeLon, origin.lat + y / METRES_PER_DEGREE_LAT];
}

/** A rectangle centred on the pin, cut across its length into `plotCount` equal strips. */
export function layoutField(center: LatLon, plotCount: number): FieldLayout {
  const halfW = FIELD_WIDTH_M / 2;
  const stripLength = FIELD_LENGTH_M / plotCount;
  const plots: Plot[] = Array.from({ length: plotCount }, (_, i) => {
    const x0 = -FIELD_LENGTH_M / 2 + i * stripLength;
    const x1 = x0 + stripLength;
    const corners: [number, number][] = [
      toLonLat(center, x0, -halfW),
      toLonLat(center, x1, -halfW),
      toLonLat(center, x1, halfW),
      toLonLat(center, x0, halfW),
    ];
    return {
      id: String.fromCharCode(65 + i),
      ring: [...corners, corners[0]],
      centroid: toLonLat(center, (x0 + x1) / 2, 0),
      areaHa: (stripLength * FIELD_WIDTH_M) / 10_000,
    };
  });
  const outline: [number, number][] = [
    toLonLat(center, -FIELD_LENGTH_M / 2, -halfW),
    toLonLat(center, FIELD_LENGTH_M / 2, -halfW),
    toLonLat(center, FIELD_LENGTH_M / 2, halfW),
    toLonLat(center, -FIELD_LENGTH_M / 2, halfW),
  ];
  return {
    plots,
    outline: [...outline, outline[0]],
    totalHa: (FIELD_LENGTH_M * FIELD_WIDTH_M) / 10_000,
  };
}

/** Crop on plot `plotIndex` in the `yearIndex`-th season of the plan (staggered rotation). */
export function cropFor(sequence: readonly Crop[], plotIndex: number, yearIndex: number): Crop {
  return sequence[(plotIndex + yearIndex) % sequence.length];
}
