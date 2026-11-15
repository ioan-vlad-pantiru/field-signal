import type { VerdictKind } from "./results.ts";

/**
 * The last answer for each field, kept on this device so field cards can show it before the
 * farmer runs the analysis again. Keyed by My fields id, or LOCAL_FIELD for the signed-out field.
 */
export interface LastVerdict {
  kind: VerdictKind;
  /** The best rotation's crops, in order. */
  best: string[];
  /** Poor seasons: the best rotation's and the current one's. */
  bestPoor: number;
  currentPoor: number;
  /** ISO date of the run. */
  at: string;
}

export const LAST_VERDICT_KEY = "field-signal.last-verdict.v1";
export const LOCAL_FIELD = "local";
/** Fields remembered at most; the oldest are dropped first. */
export const MAX_REMEMBERED = 50;

const KINDS: readonly VerdictKind[] = ["keep", "fewer", "same", "more"];

function valid(value: unknown): value is LastVerdict {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    KINDS.includes(v.kind as VerdictKind) &&
    Array.isArray(v.best) &&
    v.best.every((c) => typeof c === "string") &&
    typeof v.bestPoor === "number" &&
    typeof v.currentPoor === "number" &&
    typeof v.at === "string"
  );
}

/** Parses the stored map, dropping anything malformed (storage can hold anything). */
export function parseVerdicts(raw: string | null): Record<string, LastVerdict> {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, v]) => valid(v))) as Record<string, LastVerdict>;
  } catch {
    return {};
  }
}

/** The map with `id` set to `verdict`, newest last, trimmed to MAX_REMEMBERED. */
export function withVerdict(
  all: Record<string, LastVerdict>,
  id: string,
  verdict: LastVerdict,
): Record<string, LastVerdict> {
  const entries = Object.entries(all).filter(([key]) => key !== id);
  entries.push([id, verdict]);
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED));
}
