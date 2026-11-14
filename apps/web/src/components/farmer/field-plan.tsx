"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { LatLon, Strategy } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
import { fieldAreaHa } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { FieldPlanMap } from "./field-plan-map";

const STEP_MS = 1800;

/**
 * The rotation selected on the results page on the farmer's own field, season by season: the whole
 * field grows that season's crop, drawn on the outline the farmer drew.
 */
export function FieldPlan({
  center,
  boundary,
  parts = [],
  strategy,
}: {
  center: LatLon;
  boundary: LatLon[] | null;
  /** Further pieces of the same field. */
  parts?: LatLon[][];
  /** The page's selected rotation; the plan restarts at its first season when it changes. */
  strategy: Strategy;
}) {
  const t = useTranslations("Results.plan");
  const tc = useTranslations("Crops");
  const locale = useAppLocale();
  const sequence = strategy.sequence;
  const seasons = sequence.length;
  const firstSeason = useMemo(() => new Date().getFullYear() + 1, []);

  const [season, setSeason] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shownId, setShownId] = useState(strategy.id);
  if (shownId !== strategy.id) {
    setShownId(strategy.id);
    setSeason(0);
  }

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setSeason((s) => (s + 1) % seasons), STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, seasons]);

  const crop = sequence[season];
  const year = firstSeason + season;
  const area = boundary ? fieldAreaHa({ boundary, parts }) : null;

  return (
    <div className="flex flex-col gap-4 print:gap-2">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-ink-muted">{t("season")}</p>
          <p className="flex items-baseline gap-3" aria-live="polite">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{year}</span>
            <span className="inline-flex items-center gap-2 text-lg font-medium">
              <span className="h-3 w-3 rounded-full" style={{ background: CROP_COLORS[crop] }} aria-hidden="true" />
              {tc(crop)}
            </span>
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setSeason((s) => (s - 1 + seasons) % seasons)}
            aria-label={t("previous")}
            className="w-11 px-0 text-xl"
          >
            ‹
          </Button>
          <Button variant="secondary" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
            {playing ? t("pause") : t("play")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setSeason((s) => (s + 1) % seasons)}
            aria-label={t("next")}
            className="w-11 px-0 text-xl"
          >
            ›
          </Button>
        </div>
      </div>

      <FieldPlanMap
        center={center}
        boundary={boundary}
        parts={parts}
        crop={crop}
        cropLabel={tc(crop)}
        fitKey={strategy.id}
        label={t("mapLabel", { year, crop: tc(crop) })}
      />

      {/* The rotation's seasons on this field; pick one to show it on the map. */}
      <ol aria-label={t("seasons")} className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
        {sequence.map((c, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setSeason(i);
              }}
              aria-pressed={i === season}
              className={`press flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors print:border-line print:bg-transparent ${
                i === season ? "border-field bg-surface-sunken" : "border-line hover:bg-surface-sunken"
              }`}
            >
              <span
                className="h-8 w-1.5 shrink-0 rounded-full"
                style={{ background: CROP_COLORS[c] }}
                aria-hidden="true"
              />
              <span className="flex flex-col leading-tight">
                <span className="text-sm tabular-nums text-ink-muted">{firstSeason + i}</span>
                <span className="font-semibold">{tc(c)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <p className="text-sm text-ink-muted">
        {area !== null
          ? t("noteField", { area: formatNumber(area, locale, 1), years: seasons })
          : t("notePin", { years: seasons })}
      </p>
    </div>
  );
}
