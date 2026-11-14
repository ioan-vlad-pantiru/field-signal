import type { Crop, FarmPlan, FarmPlanRequest, LatLon, Parcel, PlanField } from "./contracts.ts";

/** A field going into the plan: parcels farmed together with one rotation. */
export interface PlanInputField {
  id: string;
  name: string;
  parcels: Parcel[];
  currentRotation: Crop[] | null;
}

/** Romanian crop names for the APIA list (the CSV is for Romanian Excel and AGI Online). */
export const CROP_RO: Record<Crop, string> = {
  maize: "Porumb",
  wheat: "Grâu",
  barley: "Orz",
  soybean: "Soia",
  sunflower: "Floarea-soarelui",
  pea: "Mazăre",
  cover_mustard: "Muștar (cultură de acoperire)",
  cover_phacelia: "Facelia (cultură de acoperire)",
  cover_vetch: "Măzăriche (cultură de acoperire)",
  fallow: "Pârloagă",
};

const EUCROPMAP: Record<string, Crop> = {
  maize: "maize",
  common_wheat: "wheat",
  durum_wheat: "wheat",
  barley: "barley",
  sunflower: "sunflower",
  soybean: "soybean",
  dry_pulses: "pea",
};

/** Declared crop names, without diacritics, lower case; matched at the start of the name. */
const DECLARED: [string, Crop][] = [
  ["porumb", "maize"],
  ["grau", "wheat"],
  ["orz", "barley"],
  ["floarea-soarelui", "sunflower"],
  ["floarea soarelui", "sunflower"],
  ["soia", "soybean"],
  ["mazare", "pea"],
];

function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** A crop name a farmer declared (e.g. "Grâu de toamnă") as our crop id, or null. */
export function cropFromDeclared(name: string | null | undefined): Crop | null {
  if (!name) return null;
  const text = plain(name);
  // "orzoaică" is spring barley; it starts with "orz", which is what we want.
  return DECLARED.find(([key]) => text.startsWith(key))?.[1] ?? null;
}

/** The most recent mapped crop that covers at least half of the parcel, as our crop id. */
export function cropFromHistory(parcel: Pick<Parcel, "crop_history">): Crop | null {
  const latest = [...(parcel.crop_history ?? [])]
    .filter((entry) => entry.share >= 0.5)
    .sort((a, b) => b.year - a.year)[0];
  return latest?.crop ? (EUCROPMAP[latest.crop] ?? null) : null;
}

/** Last crop on a parcel: the farmer's declaration wins over the satellite map. */
export function parcelLastCrop(parcel: Parcel, declaredCrops: Record<number, string>): Crop | null {
  return cropFromDeclared(declaredCrops[parcel.id]) ?? cropFromHistory(parcel);
}

/** Last crop of a field: the crop with the most area among its parcels (ties: first seen). */
export function fieldLastCrop(parcels: Parcel[], declaredCrops: Record<number, string>): Crop | null {
  const area = new Map<Crop, number>();
  for (const parcel of parcels) {
    const crop = parcelLastCrop(parcel, declaredCrops);
    if (crop) area.set(crop, (area.get(crop) ?? 0) + parcel.area_ha);
  }
  let best: Crop | null = null;
  for (const [crop, ha] of area) if (best === null || ha > area.get(best)!) best = crop;
  return best;
}

/** Centroid of one outline (shoelace in degrees; fine at parcel scale). */
function polygonCentroid(ring: LatLon[]): LatLon {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const cross = a.lon * b.lat - b.lon * a.lat;
    twiceArea += cross;
    cx += (a.lon + b.lon) * cross;
    cy += (a.lat + b.lat) * cross;
  }
  if (Math.abs(twiceArea) < 1e-14) {
    return {
      lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length,
      lon: ring.reduce((s, p) => s + p.lon, 0) / ring.length,
    };
  }
  return { lat: cy / (3 * twiceArea), lon: cx / (3 * twiceArea) };
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

/** Area-weighted centroid of the parcels' outlines, rounded to 5 decimals (about 1 m). */
export function fieldCentroid(parcels: Pick<Parcel, "boundary" | "area_ha">[]): LatLon {
  let weight = 0;
  let lat = 0;
  let lon = 0;
  for (const parcel of parcels) {
    const c = polygonCentroid(parcel.boundary);
    const w = parcel.area_ha > 0 ? parcel.area_ha : 1e-9;
    weight += w;
    lat += c.lat * w;
    lon += c.lon * w;
  }
  return { lat: round5(lat / weight), lon: round5(lon / weight) };
}

export function toPlanField(field: PlanInputField, declaredCrops: Record<number, string>): PlanField {
  const area = field.parcels.reduce((sum, p) => sum + p.area_ha, 0);
  const rotation = field.currentRotation;
  return {
    id: field.id,
    name: field.name,
    area_ha: Math.round(area * 100) / 100,
    location: fieldCentroid(field.parcels),
    current_rotation:
      rotation && rotation.length >= 2 && rotation.length <= 4
        ? (rotation as NonNullable<PlanField["current_rotation"]>)
        : null,
    last_crop: fieldLastCrop(field.parcels, declaredCrops),
  };
}

/** Fields that can be planned: at least one parcel with some area. */
export function plannableFields(fields: PlanInputField[]): PlanInputField[] {
  return fields.filter((f) => f.parcels.length > 0 && f.parcels.some((p) => p.area_ha > 0));
}

/** The next season to plan: next year once the autumn sowing starts (September on), else this year. */
export function nextSeason(now: Date = new Date()): number {
  return now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const PLAN_TIMEOUT_MS = 20_000;

export async function postFarmPlan(body: FarmPlanRequest, signal?: AbortSignal): Promise<FarmPlan> {
  const timeout = AbortSignal.timeout(PLAN_TIMEOUT_MS);
  const response = await fetch(`${API_URL}/v1/farm/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`/v1/farm/plan responded ${response.status}`);
  return (await response.json()) as FarmPlan;
}

function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Hectares the way Romanian Excel reads them: decimal comma, no thousands separator. */
function hectares(ha: number): string {
  return (Math.round(ha * 10000) / 10000).toString().replace(".", ",");
}

/**
 * The APIA checklist for one year: one row per parcel with the crop the plan puts there.
 * Semicolon-separated with a BOM, so Romanian Excel opens it with diacritics intact.
 */
export function declarationCsv(plan: FarmPlan, fields: PlanInputField[], year: number): string {
  const yearIndex = plan.years.indexOf(year);
  const header = ["ID parcelă APIA", "Solă", "Suprafață (ha)", `Cultura ${year}`];
  const rows: string[][] = [];
  for (const field of fields) {
    const planned = plan.fields.find((f) => f.field_id === field.id);
    const crop = planned && yearIndex >= 0 ? planned.crops[yearIndex] : undefined;
    for (const parcel of field.parcels) {
      rows.push([String(parcel.id), field.name, hectares(parcel.area_ha), crop ? CROP_RO[crop] : ""]);
    }
  }
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

/** e.g. "Ferma Popescu" -> "ferma-popescu-apia-2027.csv". */
export function csvFileName(farmName: string, year: number): string {
  const slug = plain(farmName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "ferma"}-apia-${year}.csv`;
}

/** Area per crop for one year, largest first, from the plan totals. */
export function yearTotals(plan: FarmPlan, year: number): { crop: Crop; area_ha: number }[] {
  return plan.totals
    .filter((t) => t.year === year && t.area_ha > 0)
    .sort((a, b) => b.area_ha - a.area_ha || a.crop.localeCompare(b.crop))
    .map(({ crop, area_ha }) => ({ crop, area_ha }));
}
