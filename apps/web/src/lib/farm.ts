"use client";

import type { Farm, FarmField, FarmImport, FarmRematch, FarmSuggestion, Parcel } from "@/lib/contracts";

/** A field while the farmer edits it: like FarmField, but it may briefly hold no parcels. */
export type FieldGroup = Omit<FarmField, "parcel_ids"> & { parcel_ids: number[] };

/** The farm while it is being built; the API's Farm needs at least one parcel. */
export interface FarmState {
  name: string;
  parcels: Parcel[];
  fields: FieldGroup[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** A stable code the UI translates: `unsupported_file`, `no_outlines`, `offline`, ... */
export class FarmError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new FarmError("offline", 0);
  }
  if (!response.ok) {
    let code = "server";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") code = body.detail;
    } catch {
      // Keep the generic code.
    }
    throw new FarmError(code, response.status);
  }
  return (await response.json()) as T;
}

/** Upload a parcel file (zipped shapefile as AGI Online exports, GeoJSON or KML). */
export function importFarmFile(file: Blob, filename: string): Promise<FarmImport> {
  return call<FarmImport>(`/v1/farm/import?filename=${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
    timeoutMs: 60_000,
  });
}

/** Match the farm's parcels to the current APIA layer by outline (ids change from year to year). */
export function rematchFarm(parcels: Parcel[]): Promise<FarmRematch> {
  return call<FarmRematch>("/v1/farm/rematch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parcels),
    timeoutMs: 60_000,
  });
}

/**
 * Apply a re-match: parcels with a match are replaced by the current ones, the rest kept as they
 * were; fields keep their parcels under the new ids (a new parcel stays in the first field it
 * lands in).
 */
export function applyRematch(
  state: { parcels: Parcel[]; fields: FieldGroup[] },
  result: FarmRematch,
): { parcels: Parcel[]; fields: FieldGroup[]; changed: number; missing: number } {
  const mapping = new Map(Object.entries(result.mapping ?? {}).map(([k, v]) => [Number(k), v]));
  const kept = state.parcels.filter((p) => !mapping.has(p.id));
  const current = new Map(result.parcels.map((p) => [p.id, p]));
  const seen = new Set<number>();
  const fields = state.fields
    .map((f) => ({
      ...f,
      parcel_ids: f.parcel_ids
        .flatMap((id) => mapping.get(id) ?? [id])
        .filter((id) => (seen.has(id) ? false : (seen.add(id), true))),
    }))
    .filter((f) => f.parcel_ids.length > 0);
  const changed = state.parcels.filter((p) => {
    const ids = mapping.get(p.id);
    return ids !== undefined && !(ids.length === 1 && ids[0] === p.id);
  }).length;
  return { parcels: [...current.values(), ...kept], fields, changed, missing: kept.length };
}

export function suggestFields(parcels: Parcel[], declared: Record<number, string>): Promise<FarmSuggestion> {
  return call<FarmSuggestion>("/v1/farm/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parcels, declared_crops: declared }),
  });
}

// --------------------------------------------------------------------------- saved farm

async function accountCall<T>(path: string, init: RequestInit = {}): Promise<T> {
  return call<T>(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

export function loadSavedFarm(): Promise<Farm | null> {
  return accountCall<Farm | null>("/v1/me/farm");
}

export function saveFarm(farm: FarmState): Promise<Farm> {
  const body = { ...farm, fields: farm.fields.filter((f) => f.parcel_ids.length > 0) };
  return accountCall<Farm>("/v1/me/farm", { method: "PUT", body: JSON.stringify(body) });
}

const DRAFT_KEY = "fs-farm-draft";

export interface FarmDraft {
  farm: FarmState;
  declared: Record<number, string>;
}

/** The farm being built on this device, so a reload does not lose it. Never throws. */
export function readDraft(): FarmDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as FarmDraft) : null;
  } catch {
    return null;
  }
}

export function writeDraft(draft: FarmDraft | null) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private mode or full storage: the farm still works for this visit.
  }
}

// --------------------------------------------------------------------------- helpers

export function areaHa(parcels: Parcel[]): number {
  return parcels.reduce((sum, p) => sum + p.area_ha, 0);
}

/** Parcels of a field, in the farm's order. */
export function fieldParcels(field: FieldGroup, byId: Map<number, Parcel>): Parcel[] {
  return field.parcel_ids.map((id) => byId.get(id)).filter((p): p is Parcel => p !== undefined);
}

export interface SoilFlag {
  parcelId: number;
  kind: "clay_high" | "clay_low" | "carbon_low" | "ph_low" | "ph_high";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Parcels whose topsoil differs clearly from the rest of the farm (SoilGrids, 250 m model):
 * clay 10 points off the farm median, organic carbon under 70% of it, or pH outside 5.5-8.
 * A hint to look at those parcels, not a soil test.
 */
export function soilFlags(parcels: Parcel[]): SoilFlag[] {
  const soils = parcels.filter((p) => p.soil);
  const clayMid = median(soils.map((p) => p.soil?.clay_pct).filter((v): v is number => v != null));
  const socMid = median(soils.map((p) => p.soil?.soc_g_per_kg).filter((v): v is number => v != null));
  const flags: SoilFlag[] = [];
  for (const p of soils) {
    const s = p.soil!;
    if (clayMid != null && s.clay_pct != null && s.clay_pct - clayMid >= 10) flags.push({ parcelId: p.id, kind: "clay_high" });
    if (clayMid != null && s.clay_pct != null && clayMid - s.clay_pct >= 10) flags.push({ parcelId: p.id, kind: "clay_low" });
    if (socMid != null && s.soc_g_per_kg != null && s.soc_g_per_kg < socMid * 0.7) flags.push({ parcelId: p.id, kind: "carbon_low" });
    if (s.ph_h2o != null && s.ph_h2o < 5.5) flags.push({ parcelId: p.id, kind: "ph_low" });
    if (s.ph_h2o != null && s.ph_h2o > 8) flags.push({ parcelId: p.id, kind: "ph_high" });
  }
  return flags;
}

/** A categorical colour per field, repeating after eight; the list always shows the name too. */
export const FIELD_COLOURS = ["#2f7d4f", "#c98a1b", "#3a6ea5", "#b24c63", "#7a5ea8", "#2c8c8c", "#a3612b", "#5f7f1f"];
