"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import type { AdoptionScenario, Crop, Range } from "@/lib/contracts";
import { formatNumber, scaleRange } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { PEA, combine, peaEstimate, soyEstimate, type CropEstimate } from "@/lib/protein";
import { RangeBar } from "@/components/ui/charts";
import { CropDot } from "@/components/ui/crop-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";

const MAX_ADOPTION = 50;

/*
 * The slider's share, shared with cards mounted elsewhere on the page (SoyImports) without
 * lifting state into the page. One slider per page.
 */
let sharedAdoption: number | null = null;
const adoptionListeners = new Set<() => void>();

function publishAdoption(pct: number) {
  sharedAdoption = pct;
  adoptionListeners.forEach((listener) => listener());
}

function subscribeAdoption(listener: () => void) {
  adoptionListeners.add(listener);
  return () => adoptionListeners.delete(listener);
}

/** The adoption share the slider shows now, or `fallback` before it has been moved. */
export function useAdoptionPct(fallback: number): number {
  const pct = useSyncExternalStore(
    subscribeAdoption,
    () => sharedAdoption,
    () => null,
  );
  return pct ?? fallback;
}
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
  const [pct, setPctState] = useState(Math.round(scenario.adoption_pct));
  const setPct = (value: number) => {
    setPctState(value);
    publishAdoption(value);
  };
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
    <div className="flex max-w-[720px] flex-col gap-5">
      <div>
        <p className="font-medium">{t("title", { crop: cropName })}</p>
        <p className="text-ink-muted">{t("hint")}</p>
      </div>

      <Segmented
        label={t("cropLabel")}
        value={choice}
        onChange={setChoice}
        // Three options with long Romanian names don't fit side by side on a phone: stack them below sm.
        className="w-full flex-col sm:w-auto sm:flex-row"
        options={CHOICES.map((c) => ({
          value: c,
          label: (
            <>
              {c !== "pea" ? <CropDot crop={soyCrop} /> : null}
              {c !== "soy" ? <CropDot crop={peaCrop} /> : null}
              {t(`choice.${c}`)}
            </>
          ),
        }))}
      />

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
      <Disclosure summary={t("assumptions")}>
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
      </Disclosure>
    </div>
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
  const n = (v: number) => formatNumber(v, locale, 0);
  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{label}</span>
        <span>
          <span className="text-2xl font-semibold tracking-tight tabular-nums">+{n(range.mid)}</span>{" "}
          <span className="text-ink-muted">{unit}</span>
        </span>
      </div>
      <RangeBar
        range={range}
        domain={[0, axisMax]}
        label={t("rangeLabel", { low: n(range.low), mid: n(range.mid), high: n(range.high), unit })}
      />
      <p className="mt-1 text-sm text-ink-muted tabular-nums">
        {t("range", { low: n(range.low), high: n(range.high), unit })}
      </p>
    </li>
  );
}
