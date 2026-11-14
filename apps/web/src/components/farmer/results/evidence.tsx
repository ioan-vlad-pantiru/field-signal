"use client";

import { useTranslations } from "next-intl";
import type { FieldAnalysis, Indicator, SoilProfile } from "@/lib/contracts";
import { formatNumber, formatQuantity, mean } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { Sparkline } from "@/components/ui/charts";
import { InfoTip } from "@/components/ui/info-tip";
import { SourceChip } from "@/components/ui/source-chip";
import { TONE_CLASSES, TONE_ICONS, type Tone } from "@/components/ui/tone";

/** How far from the mean (as a share of it) still counts as "normal". */
const NORMAL_BAND = 0.1;

/** Indicators, soil, caveats and sources: everything the results rest on. */
export function Evidence({ analysis }: { analysis: FieldAnalysis }) {
  const t = useTranslations("Results.evidence");
  const l = useLocalized();
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h3 className="text-lg font-semibold">{t("indicatorsTitle")}</h3>
        <p className="mt-1 max-w-[65ch] text-ink-muted">{t("indicatorsHint")}</p>
        <ul className={`mt-5 grid gap-x-8 gap-y-8 sm:grid-cols-2`}>
          {analysis.indicators.map((indicator) => (
            <IndicatorItem key={indicator.id} indicator={indicator} />
          ))}
        </ul>
      </div>

      <Soil soil={analysis.soil} />

      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-lg font-semibold">{t("caveatsTitle")}</h3>
          <ul className="list-disc space-y-2 pl-5">
            {analysis.caveats.map((c, i) => (
              <li key={i}>{l(c)}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-3 text-lg font-semibold">{t("sourcesTitle")}</h3>
          <ul className="flex flex-col items-start gap-2">
            {analysis.sources.map((s) => (
              <li key={s.dataset} className="max-w-full">
                <SourceChip source={s} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function IndicatorItem({ indicator }: { indicator: Indicator }) {
  const t = useTranslations("Results.indicator");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();

  const latest = indicator.series.findLast((p) => p.value !== null);
  const baseline = indicator.baseline_mean ?? mean(indicator.series.map((p) => p.value));
  const withData = indicator.series.filter((p) => p.value !== null);
  const fmt = (v: number) => formatQuantity(v, indicator.unit, locale, unitLabel);

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
  const first = withData[0]?.year;
  const last = withData.at(-1)?.year;
  const name = l(indicator.label);

  return (
    <li className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 font-semibold">{name}</h4>
        <InfoTip label={t("whatIs", { term: name })}>{l(indicator.description)}</InfoTip>
      </div>
      {latest?.value != null ? (
        <dl className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <dt className="text-sm text-ink-muted">{t("latest", { year: latest.year })}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{fmt(latest.value)}</dd>
          </div>
          <div className="text-right">
            <dt className="text-sm text-ink-muted">{t("mean")}</dt>
            <dd className="tabular-nums">{baseline !== null ? fmt(baseline) : "—"}</dd>
          </div>
        </dl>
      ) : null}
      <p className="inline-flex items-center gap-1.5 text-sm font-medium">
        <span className={TONE_CLASSES[tone].text}>
          <ToneIcon size={16} />
        </span>
        {comparison}
      </p>
      <div>
        <Sparkline
          series={indicator.series}
          baseline={baseline}
          label={t("sparklineLabel", { name, from: first ?? "", to: last ?? "" })}
        />
        <div aria-hidden="true" className="flex justify-between text-xs tabular-nums text-ink-muted">
          <span>{first}</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 border-t border-dashed border-ink-muted" />
            {t("meanLegend")}
          </span>
          <span>{last}</span>
        </div>
      </div>
      <SourceChip source={indicator.source} />
    </li>
  );
}

function Soil({ soil }: { soil: SoilProfile }) {
  const t = useTranslations("Results.soil");
  const locale = useAppLocale();
  const l = useLocalized();
  const value = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${formatNumber(v, locale)}${unit}`);
  const mix =
    soil.clay_pct != null && soil.sand_pct != null
      ? t("mix", {
          clay: formatNumber(soil.clay_pct, locale, 0),
          sand: formatNumber(soil.sand_pct, locale, 0),
          silt: formatNumber(soil.silt_pct ?? 100 - soil.clay_pct - soil.sand_pct, locale, 0),
        })
      : null;
  const rows = [
    { key: "carbon", value: value(soil.soc_g_per_kg, " g/kg"), detail: null },
    { key: "ph", value: value(soil.ph_h2o), detail: null },
    { key: "texture", value: soil.texture_class ? l(soil.texture_class) : "—", detail: mix },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold">{t("title")}</h3>
        <p className="text-ink-muted">{t("depth", { depth: soil.depth ?? "0-30cm" })}</p>
      </div>
      <dl className="grid gap-6 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="flex items-center gap-1 text-sm text-ink-muted">
              {t(`${row.key}.label`)}
              <InfoTip label={t("whatIs", { term: t(`${row.key}.label`) })}>{t(`${row.key}.help`)}</InfoTip>
            </dt>
            <dd className="text-xl font-semibold">
              {row.value}
              {row.detail ? <span className="block text-sm font-normal text-ink-muted">{row.detail}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <SourceChip source={soil.source} />
    </div>
  );
}
