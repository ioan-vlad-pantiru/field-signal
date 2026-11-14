import type {
  FieldAnalysis,
  FieldRequest,
  MergedParcels,
  OptimizerJob,
  OptimizerRequest,
  OptimizerResponse,
  ParcelCollection,
  SourcingRegion,
} from "@/lib/contracts";
import { mockFieldAnalysis, mockOptimizer, mockSourcingRegion } from "@/lib/mocks";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 5000;
const ANALYZE_TIMEOUT_MS = 60_000;

/** Where a response came from: the running API, or the typed mocks bundled with the app. */
export type DataOrigin = "api" | "fallback";

export interface Loaded<T> {
  data: T;
  origin: DataOrigin;
}

/** The API answered but rejected the request (4xx): a real error, not a reason to fall back. */
export class ApiRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`${path} responded ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(timeoutMs),
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
      request<FieldAnalysis>(
        "/v1/fields/analyze",
        { method: "POST", body: JSON.stringify(body) },
        // The trained model scores every rotation for the field: a few seconds on the API.
        ANALYZE_TIMEOUT_MS,
      ),
    mockFieldAnalysis,
  );
}

export function getSourcingRegion(season = 2025): Promise<Loaded<SourcingRegion>> {
  return withFallback(
    () => request<SourcingRegion>(`/v1/sourcing/region?season=${season}`),
    mockSourcingRegion,
  );
}

const JOB_POLL_MS = 2000;
const JOB_MAX_MS = 5 * 60_000;

/**
 * One farm plan for all fields together, computed as a background job on the API (the trained
 * world model can take half a minute on a big farm): starts the job, then polls it until it is
 * done. The page stays usable meanwhile. `onProgress` gets the seconds since the job started;
 * `signal` stops polling (a newer run replaced this one). A rejected job throws a 422
 * `ApiRequestError`; an unreachable API falls back to the bundled mock plan.
 */
export function optimizeFarm(
  body: OptimizerRequest,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (elapsedS: number) => void } = {},
): Promise<Loaded<OptimizerResponse>> {
  return withFallback(async () => {
    const path = "/v1/farm/optimize/jobs";
    let job = await request<OptimizerJob>(path, { method: "POST", body: JSON.stringify(body) });
    const deadline = Date.now() + JOB_MAX_MS;
    while (job.status === "queued" || job.status === "running") {
      onProgress?.(job.elapsed_s);
      await sleep(JOB_POLL_MS, signal);
      if (Date.now() > deadline) throw new Error("The farm plan took too long.");
      job = await request<OptimizerJob>(`${path}/${job.id}`);
    }
    if (job.status === "done" && job.result) return job.result;
    if (job.status === "rejected") throw new ApiRequestError(path, 422);
    throw new ApiRequestError(path, 500);
  }, mockOptimizer).then((loaded) => {
    // An aborted run never resolves into the page, not even with the fallback plan.
    signal?.throwIfAborted();
    return loaded;
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
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
