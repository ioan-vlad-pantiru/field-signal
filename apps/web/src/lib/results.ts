import type { Indicator, RuleCheck, Strategy, YearValue } from "./contracts.ts";

/** Seasons a rotation's replay marks as poor (`status === "bad"`). */
export function poorSeasons(strategy: Pick<Strategy, "replay">): number {
  return strategy.replay.filter((outcome) => outcome.status === "bad").length;
}

/** Best fit with the farmer's priorities first; ties keep the API's order. */
export function rankStrategies<T extends Pick<Strategy, "score">>(strategies: readonly T[]): T[] {
  return strategies
    .map((strategy, index) => ({ strategy, index }))
    .sort((a, b) => b.strategy.score.total - a.strategy.score.total || a.index - b.index)
    .map(({ strategy }) => strategy);
}

/** Every season any rotation was replayed in, oldest first: the shared year axis. */
export function replayYears(strategies: readonly Pick<Strategy, "replay">[]): number[] {
  return [...new Set(strategies.flatMap((s) => s.replay.map((r) => r.year)))].sort((a, b) => a - b);
}

export type VerdictKind =
  /** The current rotation already fits best. */
  | "keep"
  /** Another rotation fits best and had fewer poor seasons. */
  | "fewer"
  /** Another rotation fits best with as many poor seasons. */
  | "same"
  /** Another rotation fits best on the priorities, but had more poor seasons. */
  | "more";

export interface Verdict<T extends Strategy = Strategy> {
  kind: VerdictKind;
  best: T;
  /** The farmer's rotation now; the best one when the API marks none as current. */
  current: T;
  bestPoor: number;
  currentPoor: number;
}

export function verdict<T extends Strategy>(strategies: readonly T[]): Verdict<T> {
  const [best] = rankStrategies(strategies);
  const current = strategies.find((s) => s.is_current) ?? best;
  const bestPoor = poorSeasons(best);
  const currentPoor = poorSeasons(current);
  const kind: VerdictKind =
    best === current ? "keep" : bestPoor < currentPoor ? "fewer" : bestPoor === currentPoor ? "same" : "more";
  return { kind, best, current, bestPoor, currentPoor };
}

/** Years averaged at each end of a series to describe what changed. */
export const SHIFT_EARLY_YEARS = 10;
export const SHIFT_RECENT_YEARS = 5;
/** Changes smaller than this share of the early mean read as "about the same". */
export const SHIFT_STEADY_BAND = 0.05;

export interface Period {
  start: number;
  end: number;
  mean: number;
}

export interface Shift {
  indicator: Indicator;
  early: Period;
  recent: Period;
  direction: "up" | "down" | "steady";
  /** Recent mean minus early mean, as a share of the early mean. */
  relative: number;
}

function period(points: YearValue[]): Period {
  const values = points.map((p) => p.value as number);
  return {
    start: points[0].year,
    end: points[points.length - 1].year,
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
  };
}

/**
 * What changed at this place: the mean of the last five years with data against the mean of the
 * first ten. Only series with enough years for two periods that do not overlap qualify.
 */
export function indicatorShift(indicator: Indicator): Shift | null {
  const present = indicator.series
    .filter((p) => p.value !== null && Number.isFinite(p.value))
    .sort((a, b) => a.year - b.year);
  if (present.length < SHIFT_EARLY_YEARS + SHIFT_RECENT_YEARS) return null;
  const early = period(present.slice(0, SHIFT_EARLY_YEARS));
  const recent = period(present.slice(-SHIFT_RECENT_YEARS));
  const relative = (recent.mean - early.mean) / (Math.abs(early.mean) || 1);
  const direction = Math.abs(relative) < SHIFT_STEADY_BAND ? "steady" : relative > 0 ? "up" : "down";
  return { indicator, early, recent, direction, relative };
}

/** Up to `limit` shifts, largest change first. */
export function placeShifts(indicators: readonly Indicator[], limit = 3): Shift[] {
  return indicators
    .map(indicatorShift)
    .filter((s): s is Shift => s !== null)
    .sort((a, b) => Math.abs(b.relative) - Math.abs(a.relative))
    .slice(0, limit);
}

export type RuleStatus = "within" | "outside" | "belowThreshold";

/**
 * A provisional rule row's label. `passed` with a value past the limit means the API waived the rule
 * because the farm is below its size threshold; that must not read "within the limit".
 */
export function ruleStatus(rule: Pick<RuleCheck, "id" | "limit_pct" | "value_pct" | "passed">): RuleStatus {
  if (!rule.passed) return "outside";
  const breaks = rule.id === "legume_share" ? rule.value_pct < rule.limit_pct : rule.value_pct > rule.limit_pct;
  return breaks ? "belowThreshold" : "within";
}

/**
 * A farm plan's allocation rows with each field's rows together, fields in first-seen order. On a farm
 * under 75 ha one field may carry several rotations, each its own row with the same `field_id`.
 */
export function byField<T extends { field_id: string }>(rows: readonly T[]): T[] {
  const order = new Map<string, number>();
  for (const row of rows) if (!order.has(row.field_id)) order.set(row.field_id, order.size);
  return [...rows].sort((a, b) => order.get(a.field_id)! - order.get(b.field_id)!);
}

export interface MainRisk {
  /** Stable reason code, e.g. "heat_at_flowering". */
  code: string;
  label: Strategy["replay"][number]["reasons"][number]["label"];
  /** Weak seasons (watch or bad) of the current rotation in which this reason appeared. */
  seasons: number;
}

/** Reason code the model puts on every weak season; a weather cause names the risk better. */
export const YIELD_INDEX_CODE = "model_yield_index";

/**
 * The reason that most often made the current rotation's past seasons weak (watch or bad). Same
 * rule as the WhatsApp bot (`services/api/src/api/whatsapp/models.py::_main_risk`), so the web and
 * the bot name the same risk: count each reason code over those seasons; ties go to the code seen
 * first. The yield index counts only when no weather cause appears. Null when no weak season has a reason.
 */
export function mainRisk(strategies: readonly Pick<Strategy, "is_current" | "replay">[]): MainRisk | null {
  const current = strategies.find((s) => s.is_current) ?? strategies[0];
  if (!current) return null;
  const found = new Map<string, MainRisk>();
  for (const season of current.replay) {
    if (season.status !== "bad" && season.status !== "watch") continue;
    for (const reason of season.reasons) {
      const entry = found.get(reason.code);
      if (entry) {
        entry.seasons += 1;
        entry.label = reason.label;
      } else found.set(reason.code, { code: reason.code, label: reason.label, seasons: 1 });
    }
  }
  // The model's own yield index marks every poor season; a weather cause, when there is one, says more.
  const causes = [...found.values()].filter((entry) => entry.code !== YIELD_INDEX_CODE);
  let best: MainRisk | null = null;
  for (const entry of causes.length ? causes : found.values()) if (!best || entry.seasons > best.seasons) best = entry;
  return best;
}

/** The first sentence of a text, for a one-line summary on a card (the rest is one tap away). */
export function firstSentence(text: string): string {
  const match = /^([\s\S]+?[.!?])(\s|$)/.exec(text.trim());
  return (match ? match[1] : text).trim();
}
