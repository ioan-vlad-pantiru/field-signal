"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AdoptionScenario, Range } from "@/lib/contracts";
import { formatNumber, scaleRange } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useCountUp } from "@/lib/use-count-up";
import { Card } from "@/components/ui/card";
import { RangeBar } from "@/components/ui/charts";
import { Slider } from "@/components/ui/slider";

const MAX_ADOPTION = 50;

/**
 * "If X% of suppliers add soybean": the API gives one scenario; we rescale its ranges linearly
 * on the client. Linear scaling is itself an assumption and is listed with the others.
 */
export function AdoptionSlider({ scenario }: { scenario: AdoptionScenario }) {
  const t = useTranslations("Feed.adoption");
  const tc = useTranslations("Crops");
  const locale = useAppLocale();
  const l = useLocalized();
  const [pct, setPct] = useState(Math.round(scenario.adoption_pct));
  const cropName = tc(scenario.crop).toLocaleLowerCase(locale);
  const base = scenario.adoption_pct;
  const factor = base > 0 ? pct / base : 0;
  // Fixed axis (the value at maximum adoption) so the bars visibly grow with the slider.
  const axisFactor = base > 0 ? MAX_ADOPTION / base : 0;

  const outputs: { key: "area" | "production" | "protein"; unit: string; range: Range }[] = [
    { key: "area", unit: "ha", range: scenario.added_area_ha },
    { key: "production", unit: "t", range: scenario.added_production_t },
    { key: "protein", unit: "t", range: scenario.added_protein_t },
  ];

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <span className="inline-block rounded-full bg-wheat-tint px-2.5 py-0.5 text-sm font-semibold">
          {t("estimate")}
        </span>
        <h2 className="mt-2 text-xl font-semibold">{t("title", { crop: cropName })}</h2>
        <p className="text-ink-muted">{t("hint")}</p>
      </div>
      <Slider
        label={t("sliderLabel", { crop: cropName })}
        value={pct}
        max={MAX_ADOPTION}
        onChange={setPct}
        valueText={`${pct}%`}
      />
      <ul className="flex flex-col gap-4" aria-live="polite">
        {outputs.map(({ key, unit, range }) => (
          <AdoptionOutput
            key={key}
            label={t(key)}
            unit={unit}
            range={scaleRange(range, factor)}
            axisMax={range.high * axisFactor || 1}
          />
        ))}
      </ul>
      <div>
        <h3 className="mb-1 text-sm font-semibold">{t("assumptions")}</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>{t("linear", { base: formatNumber(base, locale, 0) })}</li>
          {scenario.assumptions.map((a, i) => (
            <li key={i}>{l(a)}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** One result row; the central estimate counts towards its new value as the slider moves. */
function AdoptionOutput({
  label,
  unit,
  range,
  axisMax,
}: {
  label: string;
  unit: string;
  range: Range;
  axisMax: number;
}) {
  const t = useTranslations("Feed.adoption");
  const locale = useAppLocale();
  const shownMid = useCountUp(range.mid);
  const n = (v: number) => formatNumber(v, locale, 0);
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{label}</span>
        <span>
          <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">+{n(shownMid)}</span>{" "}
          <span className="text-ink-muted">{unit}</span>
        </span>
      </div>
      <RangeBar
        range={range}
        domain={[0, axisMax]}
        label={t("rangeLabel", { low: n(range.low), mid: n(range.mid), high: n(range.high), unit })}
      />
      <p className="mt-1 font-mono text-sm text-ink-muted tabular-nums">
        {t("range", { low: n(range.low), high: n(range.high), unit })}
      </p>
    </li>
  );
}
