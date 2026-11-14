import type { Range } from "./contracts.ts";

/** What the buyer purchases: whole soybeans, or soybean meal after crushing. */
export type SoyForm = "beans" | "meal";

/**
 * Tonnes of meal per tonne of beans after crushing. A typical solvent-extraction yield, not a
 * measured one: the buyer should check it with their crusher. Shown as an assumption.
 */
export const MEAL_YIELD: Range = { low: 0.78, mid: 0.79, high: 0.8 };

/** The scenario's range rescaled linearly from the API's adoption share to the slider's. */
export function scaleToAdoption(range: Range, basePct: number, pct: number): Range {
  const factor = basePct > 0 ? pct / basePct : 0;
  return { low: range.low * factor, mid: range.mid * factor, high: range.high * factor };
}

/**
 * Share (%) of the buyer's yearly purchase that the extra local soy could cover.
 * `beansT` is extra local production in tonnes of beans; for meal it is converted with
 * MEAL_YIELD (low with low, high with high). Null when there is no purchase to compare with.
 */
export function coverage(beansT: Range, purchaseT: number | null, form: SoyForm): Range | null {
  if (purchaseT == null || !Number.isFinite(purchaseT) || purchaseT <= 0) return null;
  const y = form === "meal" ? MEAL_YIELD : { low: 1, mid: 1, high: 1 };
  const pct = (t: number) => Math.max(0, (t / purchaseT) * 100);
  return { low: pct(beansT.low * y.low), mid: pct(beansT.mid * y.mid), high: pct(beansT.high * y.high) };
}

/** Whole percent for display; small but non-zero shares show one decimal so they don't read as 0. */
export function roundPct(value: number): number {
  return value > 0 && value < 1 ? Math.round(value * 10) / 10 : Math.round(value);
}

/** A tonnage typed by the buyer, or null. Accepts spaces and a decimal comma ("12 500,5"). */
export function parseTonnes(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface SoyNeed {
  tonnes: number | null;
  form: SoyForm;
}

const STORAGE_KEY = "field-signal.soy-need";

/** The buyer's own figure, kept only in this browser. Never sent anywhere. */
export function loadSoyNeed(): SoyNeed {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { tonnes: null, form: "beans" };
    const data = JSON.parse(raw) as Partial<SoyNeed>;
    const tonnes = typeof data.tonnes === "number" && data.tonnes > 0 ? data.tonnes : null;
    return { tonnes, form: data.form === "meal" ? "meal" : "beans" };
  } catch {
    return { tonnes: null, form: "beans" };
  }
}

export function saveSoyNeed(need: SoyNeed): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(need));
  } catch {
    // Private mode or blocked storage: the figure just isn't remembered.
  }
}
