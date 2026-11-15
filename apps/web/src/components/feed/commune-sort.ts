import type { Confidence, CropOutlook, RiskLevel, Zone } from "@/lib/contracts";

export type SortKey = "name" | "area" | "risk" | "quality" | "confidence";
export type Direction = "asc" | "desc";

export interface CommuneRow {
  zone: Zone;
  outlook: CropOutlook | undefined;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
const CONFIDENCE_ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** The first click on a column sorts in the order a buyer most likely wants. */
export const FIRST_DIRECTION: Record<SortKey, Direction> = {
  name: "asc",
  area: "desc",
  risk: "asc",
  quality: "asc",
  confidence: "desc",
};

/** Quality warnings are the flags at medium or high level; low-level flags are only being watched. */
export function warningCount(outlook: CropOutlook): number {
  return outlook.quality.flags.filter((f) => f.level !== "low").length;
}

function sortValue(key: Exclude<SortKey, "name">, o: CropOutlook): number {
  switch (key) {
    case "area":
      return o.area_ha ?? -1;
    case "risk":
      return o.availability.score;
    case "quality":
      return warningCount(o) * 10 + RISK_ORDER[o.quality.level];
    case "confidence":
      return CONFIDENCE_ORDER[o.confidence];
  }
}

/** Communes without data for the crop always go last; ties fall back to the name. */
export function sortRows(rows: CommuneRow[], key: SortKey, dir: Direction, locale: string): CommuneRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    if (key === "name") return sign * x.zone.name.localeCompare(y.zone.name, locale);
    if (!x.outlook || !y.outlook) return (x.outlook ? 0 : 1) - (y.outlook ? 0 : 1);
    const diff = sortValue(key, x.outlook) - sortValue(key, y.outlook);
    return diff !== 0 ? sign * diff : x.zone.name.localeCompare(y.zone.name, locale);
  });
}
