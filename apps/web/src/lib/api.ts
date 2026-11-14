import type {
  FieldAnalysis,
  FieldRequest,
  ImportOrigins,
  MergedParcels,
  ParcelCollection,
  SourcingRegion,
} from "@/lib/contracts";
import { mockFieldAnalysis, mockSourcingRegion } from "@/lib/mocks";
import builtOrigins from "@/mocks/import_origins.json";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 5000;

/** Where a response came from: the running API, or the typed mocks bundled with the app. */
export type DataOrigin = "api" | "fallback";

export interface Loaded<T> {
  data: T;
  origin: DataOrigin;
}

/** The API answered but rejected the request (4xx): a real error, not a reason to fall back. */
class ApiRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`${path} responded ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ApiRequestError(path, response.status);
  }
  return (await response.json()) as T;
}

/**
 * Calls the API and falls back to the bundled mock when it is unreachable, times out or fails
 * on the server (5xx), so the demo keeps working offline. A 4xx is rethrown: the request itself
 * is wrong and the UI shows an error. The caller shows a banner whenever `mock` is true.
 */
async function withFallback<T>(load: () => Promise<T>, fallback: T): Promise<Loaded<T>> {
  try {
    return { data: await load(), origin: "api" };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status < 500) throw error;
    return { data: fallback, origin: "fallback" };
  }
}

export function analyzeField(body: FieldRequest): Promise<Loaded<FieldAnalysis>> {
  return withFallback(
    () =>
      request<FieldAnalysis>("/v1/fields/analyze", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    mockFieldAnalysis,
  );
}

export function getSourcingRegion(season = 2025): Promise<Loaded<SourcingRegion>> {
  return withFallback(
    () => request<SourcingRegion>(`/v1/sourcing/region?season=${season}`),
    mockSourcingRegion,
  );
}

/**
 * Imported soy origins. The fallback is the same build bundled with the app (real data, not a
 * demo), so the page still works when the API cannot be reached.
 */
export function getImportOrigins(): Promise<Loaded<ImportOrigins>> {
  return withFallback(() => request<ImportOrigins>("/v1/sourcing/origins"), builtOrigins as ImportOrigins);
}

/** A map box in degrees. */
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * APIA parcels in a box, or null when there are none to offer: the API has no parcel file, the box
 * is too big, or the request failed. Parcel picking is a help, never a blocker, so it never throws
 * except when the caller aborts.
 */
export async function getParcels(box: Bounds, signal?: AbortSignal): Promise<ParcelCollection | null> {
  const query = new URLSearchParams(
    Object.entries(box).map(([k, v]) => [k, (v as number).toFixed(5)]),
  );
  try {
    const response = await fetch(`${API_URL}/v1/parcels?${query}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    });
    return response.ok ? ((await response.json()) as ParcelCollection) : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

/** Join tapped parcels into one field outline. `not_touching`: they are not next to each other. */
export async function mergeParcels(
  ids: number[],
): Promise<{ ok: true; data: MergedParcels } | { ok: false; reason: "not_touching" | "failed" }> {
  try {
    const data = await request<MergedParcels>("/v1/parcels/merge", { method: "POST", body: JSON.stringify({ ids }) });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: error instanceof ApiRequestError && error.status === 422 ? "not_touching" : "failed" };
  }
}
