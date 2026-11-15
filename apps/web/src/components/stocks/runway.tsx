"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useLocalized } from "@/lib/localized";
import { COUNTRIES, RED_DAYS, TARGET_DAYS, type Allocation } from "@/lib/stocks";

/** The axis runs 0–120 days, so the 90-day target sits at three quarters. */
export const SPAN_DAYS = 120;
/** Diagonal red stripes: days with no stock left. */
export const HATCH_BAD = "bg-[repeating-linear-gradient(-45deg,var(--status-bad)_0_2px,transparent_2px_6px)] opacity-60";

/** Where a day falls on the 0–120 axis, as a CSS percentage. */
export const at = (days: number) => `${(Math.min(Math.max(days, 0), SPAN_DAYS) / SPAN_DAYS) * 100}%`;

/** The earliest delivery in a recommended split: its lead time and the countries that bring it. */
export function useFirstDelivery(lines: Allocation["lines"]) {
  const l = useLocalized();
  const format = useFormatter();
  if (lines.length === 0) return undefined;
  const days = Math.min(...lines.map((line) => COUNTRIES[line.country].lead_days));
  const first = lines.filter((line) => COUNTRIES[line.country].lead_days === days);
  return { days, names: format.list(first.map((line) => l(COUNTRIES[line.country].name)), { type: "conjunction" }) };
}

/**
 * One ingredient's runway on a single axis of days: today, the day the stock runs out, the first
 * recommended delivery and the 90-day target. Days between the stock-out and that delivery are hatched.
 */
export function Runway({
  asOf,
  cover,
  delivery,
  className = "",
}: {
  asOf: Date;
  cover: number;
  /** The earliest recommended delivery: days from today and who brings it. */
  delivery?: { days: number; names: string };
  className?: string;
}) {
  const t = useTranslations("Stocks.runway");
  const format = useFormatter();
  const date = (days: number) =>
    format.dateTime(new Date(asOf.getTime() + days * 864e5), { day: "numeric", month: "short", timeZone: "UTC" });
  const days = Math.floor(cover);
  const gap = delivery && delivery.days > days;
  // A delivery label right next to the stock-out (or past the target) would collide with it.
  const showDelivery = delivery && Math.abs(delivery.days - days) > 6 && delivery.days < 80;

  return (
    <div className={`relative h-[5.75rem] ${className}`}>
      <div aria-hidden="true" className="absolute inset-x-0 top-10 h-2 overflow-hidden rounded-full bg-surface-sunken">
        <span className="absolute inset-y-0 left-0 rounded-full bg-ink-muted" style={{ width: at(days) }} />
        {gap ? (
          <span className={`absolute inset-y-0 ${HATCH_BAD}`} style={{ left: at(days), width: `calc(${at(delivery.days)} - ${at(days)})` }} />
        ) : null}
      </div>
      <Mark days={0} align="start" title={t("today")} detail={date(0)} />
      <Mark
        days={days}
        align={days < 30 ? "start" : "center"}
        title={t("stockOut")}
        detail={date(days)}
        critical={days < RED_DAYS}
      />
      {showDelivery ? <Mark days={delivery.days} align={delivery.days < 30 ? "start" : "center"} below title={t("firstDelivery")} detail={`${delivery.names} · ${date(delivery.days)}`} /> : null}
      <Mark days={TARGET_DAYS} below align="end" detail={t("target", { target: TARGET_DAYS, date: date(TARGET_DAYS) })} quiet />
    </div>
  );
}

function Mark({
  days,
  title,
  detail,
  below = false,
  align = "center",
  critical = false,
  quiet = false,
}: {
  days: number;
  title?: string;
  detail: string;
  below?: boolean;
  align?: "start" | "center" | "end";
  critical?: boolean;
  /** The target: a muted pin, and its label only where there is room for it. */
  quiet?: boolean;
}) {
  const shift = { start: "", center: "-translate-x-1/2 text-center", end: "-translate-x-full text-right" }[align];
  const pin = critical ? "bg-status-bad" : quiet ? "bg-ink-muted" : "bg-ink";
  return (
    <>
      <span aria-hidden="true" className={`absolute top-[2.125rem] h-5 w-0.5 -translate-x-1/2 rounded-full ${pin}`} style={{ left: at(days) }} />
      <p
        className={`absolute whitespace-nowrap text-xs leading-snug text-ink-muted tabular-nums ${below ? "top-[3.75rem]" : "top-0"} ${shift} ${quiet ? "max-sm:hidden" : ""}`}
        style={{ left: at(days) }}
      >
        {title ? <b className={`block font-semibold ${critical ? "text-status-bad" : "text-ink"}`}>{title}</b> : null}
        {detail}
      </p>
    </>
  );
}
