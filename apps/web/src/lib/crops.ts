import type { Crop } from "@/lib/contracts";

/**
 * Crops a farmer can pick for the current rotation: exactly the crops the trained crop model learned
 * (EU HRL crop types: maize, wheat, barley, sunflower, dry pulses as pea) and scores itself. Soybean,
 * rapeseed and cover crops are left out: the model either did not learn them or the planner does
 * not score them, and the results must never stand in one crop for another.
 */
export const ROTATION_CROPS = ["maize", "wheat", "barley", "sunflower", "pea"] as const satisfies readonly Crop[];

export const DEFAULT_ROTATION: Crop[] = ["maize", "wheat", "maize"];

/**
 * A rotation saved before the picker was narrowed may hold crops the model does not score: keep
 * the supported ones in order; fewer than two left falls back to the default rotation.
 */
export function supportedRotation<T extends { current_rotation: Crop[] }>(request: T): T {
  const kept = request.current_rotation.filter((c): c is (typeof ROTATION_CROPS)[number] =>
    (ROTATION_CROPS as readonly Crop[]).includes(c),
  );
  const rotation = kept.length >= 2 ? kept.slice(0, 4) : DEFAULT_ROTATION;
  return { ...request, current_rotation: rotation };
}
export const MIN_ROTATION = 2;
export const MAX_ROTATION = 4;

/**
 * One colour per crop, used on the field-plan map, its legend and every crop chip, so a crop
 * looks the same everywhere. Fixed (not themed) because map fills sit on the satellite basemap.
 * Crop names are always shown next to the colour.
 */
export const CROP_COLORS: Record<Crop, string> = {
  maize: "#e3b23c",
  wheat: "#c9a46a",
  barley: "#c27c5a",
  soybean: "#6fae4f",
  pea: "#2f9a78",
  sunflower: "#f08a24",
  cover_mustard: "#d6d04a",
  cover_phacelia: "#8f86c9",
  cover_vetch: "#4f8752",
  fallow: "#9a8f82",
};

/** Typical height at full growth in metres, used to give each plot believable relief in 3D. */
export const CROP_HEIGHT_M: Record<Crop, number> = {
  maize: 2.5,
  sunflower: 2,
  wheat: 0.9,
  barley: 0.8,
  soybean: 0.8,
  pea: 0.6,
  cover_mustard: 0.9,
  cover_phacelia: 0.6,
  cover_vetch: 0.5,
  fallow: 0.05,
};
