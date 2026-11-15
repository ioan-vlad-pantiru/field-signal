"use client";

import { useFormatter, useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { COUNTRIES, TARGET_DAYS, allocate, rankCandidates, type RowAssessment, type StocksScenario } from "@/lib/stocks";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Runway, useFirstDelivery } from "./runway";

/** The quiet capsule shared by the Report link and the hero's button. */
export const CAPSULE =
  "press inline-flex min-h-tap items-center gap-2.5 rounded-pill bg-surface px-4.5 text-[0.9375rem] font-semibold ring-1 ring-line hover:ring-ink-muted";

/**
 * The one dominant figure: the ingredient that runs out first (rows come sorted by days of cover),
 * its runway, the best split and, when the first ship lands after the stock-out, who can bridge it.
 */
export function StocksHero({
  scenario,
  rows,
  asOf,
  onOpen,
  className = "",
}: {
  scenario: StocksScenario;
  rows: RowAssessment[];
  asOf: Date;
  onOpen: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations("Stocks.hero");
  const ts = useTranslations("Stocks");
  const locale = useAppLocale();
  const l = useLocalized();
  const format = useFormatter();
  const worst = rows.find((a) => a.shortfall_t > 0);
  const candidates = worst ? rankCandidates(scenario, worst) : [];
  const lines = worst ? allocate(candidates, worst.shortfall_t).lines : [];
  const delivery = useFirstDelivery(lines);

  if (!worst) {
    return (
      <section className={className}>
        <p className="text-[1.75rem] font-semibold leading-tight tracking-[-0.028em]">{t("none", { target: TARGET_DAYS })}</p>
      </section>
    );
  }

  const days = Math.floor(worst.cover_days);
  const gap = delivery ? delivery.days - days : 0;
  // Countries that can land before the stock runs out: the bridge buy.
  const quick = candidates.filter((c) => c.facts.lead_days < worst.cover_days).slice(0, 2);
  const names = (codes: (keyof typeof COUNTRIES)[], type: "conjunction" | "disjunction") =>
    format.list(codes.map((cc) => l(COUNTRIES[cc].name)), { type });

  return (
    <section aria-labelledby="stocks-hero" className={className}>
      <p className="text-sm font-medium text-ink-muted">{t("label")}</p>
      <h2 id="stocks-hero" className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-[-0.028em]">
        {l(worst.row.name)}
      </h2>
      <p className="mt-4 flex items-baseline gap-3">
        <span className="text-[clamp(4rem,11vw,5.25rem)] font-semibold leading-[0.9] tracking-[-0.045em] tabular-nums">
          {days}
        </span>
        <span className="text-xl font-medium text-ink-muted">{t("daysLeft", { days })}</span>
      </p>
      <p className="mt-5 text-[1.0625rem] leading-relaxed">
        {ts("shortfall", { tonnes: ts("tonnes", { value: formatNumber(worst.shortfall_t, locale, 0) }), target: TARGET_DAYS })}
        {lines.length > 0 ? (
          <span className="text-ink-muted"> {t("split", { list: names(lines.map((line) => line.country), "conjunction") })}</span>
        ) : null}
      </p>

      <Runway asOf={asOf} cover={worst.cover_days} delivery={delivery} className="mt-9" />

      {gap > 0 ? (
        <p className="mt-6 text-[0.9375rem] leading-relaxed text-ink-muted">
          {t.rich("gap", {
            days: ts("days", { days: gap }),
            b: (chunks) => <b className="font-semibold text-ink">{chunks}</b>,
          })}
          {quick.length > 0
            ? ` ${t("bridge", {
                list: names(quick.map((c) => c.country), "disjunction"),
                days: ts("days", { days: Math.max(...quick.map((c) => c.facts.lead_days)) }),
              })}`
            : null}
        </p>
      ) : null}

      <button type="button" aria-haspopup="dialog" onClick={() => onOpen(worst.row.id)} className={`${CAPSULE} mt-7`}>
        {t("cta")}
        <ChevronRightIcon size={16} className="-mr-1 text-ink-muted" />
      </button>
    </section>
  );
}
