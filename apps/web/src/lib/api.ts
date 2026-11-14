import type {
  FarmPlanRequest,
  FarmPlanResponse,
  FieldAnalysis,
  FieldRequest,
  SourcingRegion,
} from "@/lib/contracts";
import { mockFarmPlan, mockFieldAnalysis, mockSourcingRegion } from "@/lib/mocks";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TIMEOUT_MS = 5000;

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

/** One farm plan for all fields together; the solver may take a while, hence 30 s. */
export function planFarm(body: FarmPlanRequest): Promise<Loaded<FarmPlanResponse>> {
  return withFallback(
    () =>
      request<FarmPlanResponse>(
        "/v1/farm/plan",
        { method: "POST", body: JSON.stringify(body) },
        30_000,
      ),
    mockFarmPlan,
  );
}
