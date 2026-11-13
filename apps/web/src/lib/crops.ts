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

export type CropGroup = "cereal" | "legume" | "oilseed" | "cover" | "fallow";

const GROUPS: Record<Crop, CropGroup> = {
  maize: "cereal",
  wheat: "cereal",
  barley: "cereal",
  soybean: "legume",
  pea: "legume",
  sunflower: "oilseed",
  cover_mustard: "cover",
  cover_phacelia: "cover",
  cover_vetch: "cover",
  fallow: "fallow",
};

export function cropGroup(crop: Crop): CropGroup {
  return GROUPS[crop];
}
