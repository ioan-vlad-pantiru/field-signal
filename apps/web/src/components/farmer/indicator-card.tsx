"use client";

import { useTranslations } from "next-intl";
import type { Indicator } from "@/lib/contracts";
import { formatQuantity, mean } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useCountUp } from "@/lib/use-count-up";
import { useUnitLabel } from "@/lib/use-unit-label";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/charts";
import { InfoTip } from "@/components/ui/info-tip";
import { SourceChip } from "@/components/ui/source-chip";
import { TONE_CLASSES, TONE_ICONS, type Tone } from "@/components/ui/tone";

/** How far from the mean (as a share of it) still counts as "normal". */
const NORMAL_BAND = 0.1;

export function IndicatorCard({ indicator, index }: { indicator: Indicator; index: number }) {
  const t = useTranslations("Results");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();

  const latest = indicator.series.findLast((p) => p.value !== null);
  const baseline = indicator.baseline_mean ?? mean(indicator.series.map((p) => p.value));
  const yearsWithData = indicator.series.filter((p) => p.value !== null);
  const fmt = (v: number) => formatQuantity(v, indicator.unit, locale, unitLabel);
  const shownLatest = useCountUp(latest?.value ?? 0);

  let tone: Tone = "nodata";
  let comparison = t("noComparison");
  if (latest?.value != null && baseline !== null) {
    const delta = (latest.value - baseline) / (Math.abs(baseline) || 1);
    if (Math.abs(delta) <= NORMAL_BAND) {
      tone = "good";
      comparison = t("nearNormal");
    } else {
      const above = delta > 0;
      tone = above === indicator.higher_is_worse ? "watch" : "good";
      comparison = above ? t("aboveNormal") : t("belowNormal");
    }
  }
  const ToneIcon = TONE_ICONS[tone];
  const first = yearsWithData[0]?.year;
  const last = yearsWithData.at(-1)?.year;

  return (
    <Card className="rise flex flex-col gap-3" style={{ "--i": index } as React.CSSProperties}>
      <div className="flex flex-wrap items-start gap-x-2">
        <h3 className="min-w-0 flex-1 font-semibold">{l(indicator.label)}</h3>
        <InfoTip label={t("whatIs", { term: l(indicator.label) })}>{l(indicator.description)}</InfoTip>
      </div>
      {latest?.value != null ? (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm text-ink-muted">{t("latest", { year: latest.year })}</p>
            <p className="font-mono text-3xl font-semibold tracking-tight tabular-nums">{fmt(shownLatest)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-ink-muted">{t("mean")}</p>
            <p className="font-mono text-lg tabular-nums">{baseline !== null ? fmt(baseline) : "—"}</p>
          </div>
        </div>
      ) : null}
      <p
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${TONE_CLASSES[tone].soft}`}
      >
        <span className={TONE_CLASSES[tone].text}>
          <ToneIcon size={16} />
        </span>
        {comparison}
      </p>
      <div>
        <Sparkline
          series={indicator.series}
          baseline={baseline}
          label={t("sparklineLabel", {
            name: l(indicator.label),
            from: first ?? "",
            to: last ?? "",
          })}
        />
        <div className="flex justify-between text-xs text-ink-muted tabular-nums">
          <span>{first}</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 border-t border-dashed border-ink-muted" aria-hidden="true" />
            {t("meanLegend")}
          </span>
          <span>{last}</span>
        </div>
      </div>
      <SourceChip source={indicator.source} />
    </Card>
  );
}
