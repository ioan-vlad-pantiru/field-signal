"use client";

import { useTranslations } from "next-intl";
import type { Status, Strategy } from "@/lib/contracts";
import { formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";

/** The oldest season the timeline shows; it starts at the newest and runs back to this one. */
const FIRST_YEAR = 2002;

/** Good news is quiet: a good season is grey, only weak ones carry colour (docs/DESIGN.md). */
const MARK: Record<Status, { dot: string; word: string }> = {
  good: { dot: "bg-ink-muted/40", word: "text-ink-muted" },
  watch: { dot: "bg-status-watch", word: "text-status-watch" },
  bad: { dot: "bg-status-bad", word: "text-status-bad" },
  no_data: { dot: "border border-dashed border-status-nodata bg-surface", word: "text-ink-muted" },
};

/**
 * The selected rotation's seasons, newest first back to 2002, as a timeline: each year over a dot
 * on one line, and under it how the season went, the crop and why. Scrolls sideways.
 */
export function SeasonTimeline({ strategy }: { strategy: Strategy }) {
  const t = useTranslations("Results.history");
  const ts = useTranslations("Status");
  const tc = useTranslations("CropsShort");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();
  const seasons = strategy.replay.filter((o) => o.year >= FIRST_YEAR).sort((a, b) => b.year - a.year);

  return (
    <section aria-labelledby="history-title" className="mt-3 flex flex-col gap-1 border-t border-line pt-6">
      <h2 id="history-title" className="text-lg font-semibold">
        {t("title", { count: seasons.length })}
      </h2>
      <p className="text-sm text-ink-muted">{t("lead")}</p>
      <ol className="-mx-gutter mt-5 flex overflow-x-auto px-gutter pb-2 sm:mx-0 sm:px-0 print:flex-wrap print:overflow-visible">
        {seasons.map((o) => (
          <li key={o.year} className="flex min-w-32 flex-1 basis-0 flex-col">
            <span className="text-sm font-semibold tabular-nums">{o.year}</span>
            <span aria-hidden="true" className="relative my-2.5 flex h-3 w-full items-center">
              <span className="absolute inset-x-0 h-px bg-line" />
              <span className={`relative size-2.5 rounded-full ring-4 ring-ground ${MARK[o.status].dot}`} />
            </span>
            <div className="flex flex-1 flex-col gap-1 pr-4">
              <span className="font-semibold leading-tight">{tc(o.crop)}</span>
              <span className={`text-sm ${MARK[o.status].word}`}>{ts(o.status)}</span>
              {o.reasons.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1 text-sm text-ink-muted">
                  {o.reasons.map((reason) => (
                    <li key={reason.code}>
                      {l(reason.label)}
                      {reason.value != null ? (
                        <span className="font-semibold tabular-nums text-ink"> {formatQuantity(reason.value, reason.unit, locale, unitLabel)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
