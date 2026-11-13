import type { Crop, LatLon } from "@/lib/contracts";

/**
 * ILLUSTRATIVE field layout on a hexagon grid. The contracts carry only a point, not the field
 * boundary, so we draw a field of 1-hectare hexagons around the pin, drop the hexagons that sit on
 * roads, buildings, water or woods, and split the rest into one plot per rotation year. Each plot
 * starts the rotation at a different year (a staggered rotation), so every crop of the plan is on
 * the farm every season.
 */

/** Side of a regular hexagon of exactly 1 ha: area = (3√3 / 2) · s² = 10 000 m². */
export const HEX_SIDE_M = Math.sqrt(20_000 / (3 * Math.sqrt(3)));
export const HEX_AREA_HA = 1;
/** Rings of hexagons around the pin's hexagon: 3 rings = 37 ha. */
const FIELD_RINGS = 3;
/** Plots run across the field along this bearing, like real strips. */
const PLOT_AXIS_DEG = -24;
const METRES_PER_DEGREE_LAT = 111_320;

export interface Hex {
  /** Axial coordinates "q,r". */
  id: string;
  ring: [number, number][];
  center: [number, number];
  /** Position along the plot axis in metres, used to cut contiguous plots. */
  axis: number;
}

export interface Plot {
  /** "A", "B", ... */
  id: string;
  hexIds: string[];
  /** Label anchor: the mean of the plot's hexagon centres. */
  centroid: [number, number];
  areaHa: number;
}

export interface FieldLayout {
  hexes: Hex[];
  plots: Plot[];
  /** Hexagons on roads, buildings, water or woods: shown, never farmed. */
  blocked: Set<string>;
  farmedHa: number;
}

function toLonLat(origin: LatLon, x: number, y: number): [number, number] {
  const metresPerDegreeLon = METRES_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return [origin.lon + x / metresPerDegreeLon, origin.lat + y / METRES_PER_DEGREE_LAT];
}

/** Pointy-top 1 ha hexagons within FIELD_RINGS of the pin. */
export function hexField(center: LatLon): Hex[] {
  const s = HEX_SIDE_M;
  const angle = (PLOT_AXIS_DEG * Math.PI) / 180;
  const hexes: Hex[] = [];
  for (let q = -FIELD_RINGS; q <= FIELD_RINGS; q++) {
    for (let r = -FIELD_RINGS; r <= FIELD_RINGS; r++) {
      if (Math.abs(q + r) > FIELD_RINGS) continue;
      const x = s * Math.sqrt(3) * (q + r / 2);
      const y = -s * 1.5 * r;
      const corners = Array.from({ length: 6 }, (_, k) => {
        const a = ((60 * k - 30) * Math.PI) / 180;
        return toLonLat(center, x + s * Math.cos(a), y + s * Math.sin(a));
      });
      hexes.push({
        id: `${q},${r}`,
        ring: [...corners, corners[0]],
        center: toLonLat(center, x, y),
        axis: x * Math.cos(angle) + y * Math.sin(angle),
      });
    }
  }
  return hexes;
}

/** Splits the farmable hexagons into `plotCount` contiguous plots of (near) equal area. */
export function layoutField(hexes: Hex[], blocked: Set<string>, plotCount: number): FieldLayout {
  const farmable = hexes.filter((h) => !blocked.has(h.id)).sort((a, b) => a.axis - b.axis);
  const plots: Plot[] = Array.from({ length: plotCount }, (_, i) => {
    const start = Math.round((i * farmable.length) / plotCount);
    const end = Math.round(((i + 1) * farmable.length) / plotCount);
    const members = farmable.slice(start, end);
    const sum = members.reduce<[number, number]>(
      (acc, h) => [acc[0] + h.center[0], acc[1] + h.center[1]],
      [0, 0],
    );
    const n = Math.max(members.length, 1);
    return {
      id: String.fromCharCode(65 + i),
      hexIds: members.map((h) => h.id),
      centroid: [sum[0] / n, sum[1] / n],
      areaHa: members.length * HEX_AREA_HA,
    };
  });
  return { hexes, plots, blocked, farmedHa: farmable.length * HEX_AREA_HA };
}

/** Crop on plot `plotIndex` in the `yearIndex`-th season of the plan (staggered rotation). */
export function cropFor(sequence: readonly Crop[], plotIndex: number, yearIndex: number): Crop {
  return sequence[(plotIndex + yearIndex) % sequence.length];
}
