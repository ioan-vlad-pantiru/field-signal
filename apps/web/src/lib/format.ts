import type { Range } from "@/lib/contracts";

export function formatNumber(value: number, locale: string, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

/** Picks a sensible number of decimals from the magnitude of the value. */
function formatValue(value: number, locale: string): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : 3;
  return formatNumber(value, locale, digits);
}

export function scaleRange(range: Range, factor: number): Range {
  return { low: range.low * factor, mid: range.mid * factor, high: range.high * factor };
}

/** Mean of the non-null values, or null when the series has none. */
export function mean(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Value with its unit; years are never digit-grouped ("2025", not "2.025"). */
export function formatQuantity(
  value: number,
  unit: string | null | undefined,
  locale: string,
  unitLabel: (unit: string) => string = (u) => u,
): string {
  if (unit === "year") return String(Math.round(value));
  const number = formatValue(value, locale);
  return unit ? `${number} ${unitLabel(unit)}` : number;
}
