"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AdoptionScenario, Crop, Range } from "@/lib/contracts";
import { formatNumber, scaleRange } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { PEA, combine, peaEstimate, soyEstimate, type CropEstimate } from "@/lib/protein";
import { useCountUp } from "@/lib/use-count-up";
import { Card } from "@/components/ui/card";
import { RangeBar } from "@/components/ui/charts";
import { CropDot } from "@/components/ui/crop-chip";
import { Slider } from "@/components/ui/slider";

const MAX_ADOPTION = 50;
const CHOICES = ["soy", "pea", "both"] as const;
type Choice = (typeof CHOICES)[number];

/**
 * "If X% of suppliers add soybean or feed pea": the API gives one soy scenario; pea is computed on
 * the client from stated assumptions (lib/protein.ts), and both are rescaled linearly with the
 * slider. Linear scaling is itself an assumption and is listed with the others.
 */
export function AdoptionSlider({ scenario }: { scenario: AdoptionScenario }) {
  const t = useTranslations("Feed.adoption");
  const tc = useTranslations("Crops");
  const locale = useAppLocale();
  const l = useLocalized();
  const [pct, setPct] = useState(Math.round(scenario.adoption_pct));
  const [choice, setChoice] = useState<Choice>("soy");

  const soyCrop = scenario.crop;
  const peaCrop: Crop = "pea";
  const lower = (c: Crop) => tc(c).toLocaleLowerCase(locale);
  const cropName =
    choice === "soy"
      ? lower(soyCrop)
      : choice === "pea"
        ? lower(peaCrop)
        : t("bothName", { a: lower(soyCrop), b: lower(peaCrop) });

  const soy = soyEstimate(scenario);
  const pea = peaEstimate(scenario);
  const estimate: CropEstimate = choice === "soy" ? soy : choice === "pea" ? pea : combine(soy, pea);

  const base = scenario.adoption_pct;
  const factor = base > 0 ? pct / base : 0;
  // Fixed axis (the value at maximum adoption) so the bars visibly grow with the slider.
  const axisFactor = base > 0 ? MAX_ADOPTION / base : 0;

  const outputs: { key: "area" | "production" | "protein"; unit: string; range: Range }[] = [
    { key: "area", unit: "ha", range: estimate.area_ha },
    { key: "production", unit: "t", range: estimate.production_t },
    { key: "protein", unit: "t", range: estimate.protein_t },
  ];
  const n0 = (v: number) => formatNumber(v, locale, 0);
  const showPea = choice !== "soy";

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <span className="inline-block rounded-full bg-wheat-tint px-2.5 py-0.5 text-sm font-semibold">
          {t("estimate")}
        </span>
        <h2 className="mt-2 text-xl font-semibold">{t("title", { crop: cropName })}</h2>
        <p className="text-ink-muted">{t("hint")}</p>
      </div>

      <div role="radiogroup" aria-label={t("cropLabel")} className="grid grid-cols-3 gap-1 rounded-full bg-surface-sunken p-1">
        {CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={choice === c}
            onClick={() => setChoice(c)}
            className={`press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold ${
              choice === c ? "bg-surface text-ink shadow-1" : "text-ink-muted hover:text-ink"
            }`}
          >
            {c !== "pea" ? <CropDot crop={soyCrop} /> : null}
            {c !== "soy" ? <CropDot crop={peaCrop} /> : null}
            {t(`choice.${c}`)}
          </button>
        ))}
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
          <li>{t("linear", { base: n0(base) })}</li>
          {showPea ? (
            <>
              <li>{t("peaArea")}</li>
              <li>
                {t("peaYield", {
                  low: formatNumber(PEA.yieldTHa.low, locale, 1),
                  mid: formatNumber(PEA.yieldTHa.mid, locale, 1),
                  high: formatNumber(PEA.yieldTHa.high, locale, 1),
                })}
              </li>
              <li>{t("peaProtein", { low: n0(PEA.proteinPct.low), high: n0(PEA.proteinPct.high) })}</li>
              {choice === "both" ? <li>{t("bothSum")}</li> : null}
              <li>{t("soyScenario")}</li>
            </>
          ) : null}
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
