import type { Crop } from "@/lib/contracts";

/** Crops a farmer can pick for the current rotation (the brief's feed crops plus cover crops). */
export const ROTATION_CROPS = [
  "maize",
  "wheat",
  "barley",
  "soybean",
  "sunflower",
  "pea",
  "cover_mustard",
  "cover_phacelia",
  "cover_vetch",
] as const satisfies readonly Crop[];

export const DEFAULT_ROTATION: Crop[] = ["maize", "wheat", "maize"];
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
  barley: "#a8925f",
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
