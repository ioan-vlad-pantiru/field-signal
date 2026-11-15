"use client";

import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { TARGET_DAYS, rankCandidates, type RowAssessment, type StocksScenario } from "@/lib/stocks";
import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
import { CoverBadge } from "./inventory-table";

/**
 * The headline: the most exposed ingredient (rows come sorted by days of cover, lowest first), its
 * shortfall and the best-ranked country to buy from. Tapping it opens that ingredient's suppliers.
 */
export function GapCard({
  scenario,
  rows,
  onOpen,
}: {
  scenario: StocksScenario;
  rows: RowAssessment[];
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("Stocks.headline");
  const ts = useTranslations("Stocks");
  const locale = useAppLocale();
  const l = useLocalized();
  const worst = rows.find((a) => a.shortfall_t > 0);

  if (!worst) {
    return (
      <section className="flex items-center gap-3 rounded-[var(--radius-lg)] bg-field-soft p-4 shadow-1">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-status-good-tint text-status-good">
          <CheckIcon size={20} />
        </span>
        <p className="font-semibold">{t("none", { target: TARGET_DAYS })}</p>
      </section>
    );
  }

  const best = rankCandidates(scenario, worst)[0];
  const days = Math.floor(worst.cover_days);
  const tonnes = ts("tonnes", { value: formatNumber(worst.shortfall_t, locale, 0) });

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => onOpen(worst.row.id)}
      className="press flex w-full flex-col gap-3 rounded-[var(--radius-lg)] bg-field-soft p-4 text-left shadow-1 hover:shadow-2 sm:p-5"
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm text-ink-muted">{t("label")}</span>
          <span className="block text-xl font-semibold leading-snug">{l(worst.row.name)}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-display text-3xl font-semibold leading-none tabular-nums">{days}</span>
          <span className="text-sm text-ink-muted">{t("daysLeft", { days })}</span>
        </span>
      </span>
      <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
        <CoverBadge status={worst.status} />
        <span className="min-w-0 flex-1 text-sm tabular-nums">
          {best ? t("line", { tonnes, country: l(best.facts.name) }) : t("short", { tonnes })}
        </span>
        <ChevronRightIcon size={18} className="shrink-0 text-ink-muted" />
      </span>
    </button>
  );
}
