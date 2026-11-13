"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Crop, LatLon, Strategy } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { cropFor, hexField, layoutField } from "@/lib/field-plan";
import type { NonFarmland } from "@/lib/land-cover";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { Card } from "@/components/ui/card";
import { CropDot } from "@/components/ui/crop-chip";
import { FieldPlanMap, type PlotView } from "./field-plan-map";

const STEP_MS = 1800;

/**
 * "Which crop goes where": the chosen rotation laid out on the farmer's field, season by
 * season. The field outline is illustrative until farmers can draw their own.
 */
export function FieldPlan({ center, strategies }: { center: LatLon; strategies: Strategy[] }) {
  const t = useTranslations("Results.plan");
  const tc = useTranslations("Crops");
  const ts = useTranslations("CropsShort");
  const locale = useAppLocale();
  const l = useLocalized();

  const best = strategies.reduce((a, b) => (b.score.total > a.score.total ? b : a));
  const [strategyId, setStrategyId] = useState(best.id);
  const strategy = strategies.find((s) => s.id === strategyId) ?? best;
  const sequence = strategy.sequence;
  const seasons = sequence.length;
  const firstSeason = useMemo(() => new Date().getFullYear() + 1, []);

  const [season, setSeason] = useState(0);
  const [playing, setPlaying] = useState(false);
  const hexes = useMemo(() => hexField(center), [center]);
  const [nonFarmland, setNonFarmland] = useState<Map<string, NonFarmland>>(() => new Map());
  const layout = useMemo(
    () => layoutField(hexes, new Set(nonFarmland.keys()), seasons),
    [hexes, nonFarmland, seasons],
  );
  const reasons = [...new Set(nonFarmland.values())];

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setSeason((s) => (s + 1) % seasons), STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, seasons]);

  const plots: PlotView[] = useMemo(
    () =>
      layout.plots.map((plot, i) => {
        const crop = cropFor(sequence, i, season);
        return { id: plot.id, crop, label: ts(crop) };
      }),
    [layout, sequence, season, ts],
  );
  const cropsThisSeason = [...new Set(plots.map((p) => p.crop))];
  const year = firstSeason + season;

  function pickStrategy(id: string) {
    setStrategyId(id);
    setSeason(0);
  }

  return (
    <Card className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("strategyLabel")} className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {strategies.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === strategy.id}
            onClick={() => pickStrategy(s.id)}
            className={`press min-h-11 shrink-0 rounded-full border px-4 font-medium ${
              s.id === strategy.id ? "border-field bg-field text-on-field" : "border-line bg-surface hover:border-field"
            }`}
          >
            {l(s.name)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-muted">{t("season")}</p>
          <p className="font-mono text-3xl font-semibold tracking-tight tabular-nums" aria-live="polite">
            {year}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSeason((s) => (s - 1 + seasons) % seasons)}
            aria-label={t("previous")}
            className="press inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-xl hover:border-field"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="press inline-flex min-h-11 items-center rounded-full bg-field px-5 font-semibold text-on-field hover:bg-field-strong"
          >
            {playing ? t("pause") : t("play")}
          </button>
          <button
            type="button"
            onClick={() => setSeason((s) => (s + 1) % seasons)}
            aria-label={t("next")}
            className="press inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-xl hover:border-field"
          >
            ›
          </button>
        </div>
      </div>

      <FieldPlanMap
        center={center}
        layout={layout}
        plots={plots}
        onNonFarmland={setNonFarmland}
        label={t("mapLabel", {
          year,
          plots: plots.map((p) => `${p.id}: ${p.label}`).join(", "),
        })}
      />

      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={t("legend")}>
        {cropsThisSeason.map((crop) => (
          <li key={crop} className="flex items-center gap-1.5">
            <Hexagon fill={CROP_COLORS[crop]} />
            {tc(crop)}
          </li>
        ))}
        {nonFarmland.size > 0 ? (
          <li className="flex items-center gap-1.5">
            <Hexagon fill="var(--status-nodata)" dashed />
            {t("notFarmland", {
              ha: nonFarmland.size,
              reasons: reasons.map((r) => t(`reason.${r}`)).join(", "),
            })}
          </li>
        ) : null}
        <li className="flex items-center gap-1.5 text-ink-muted">
          <Hexagon fill="none" />
          {t("hexScale")}
        </li>
      </ul>

      <div className="relative overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[22rem] border-collapse text-left text-sm">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead className="bg-surface-sunken">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                {t("plot")}
              </th>
              {Array.from({ length: seasons }, (_, i) => (
                <th key={i} scope="col" className="p-1">
                  <button
                    type="button"
                    onClick={() => setSeason(i)}
                    aria-pressed={i === season}
                    className={`press min-h-11 w-full rounded-lg px-2 font-mono font-semibold tabular-nums ${
                      i === season ? "bg-field text-on-field" : "hover:bg-surface"
                    }`}
                  >
                    {firstSeason + i}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {layout.plots.map((plot, p) => (
              <tr key={plot.id} className="border-t border-line">
                <th scope="row" className="whitespace-nowrap px-3 py-2 font-semibold">
                  {plot.id}
                  <span className="block font-mono text-xs font-normal text-ink-muted">
                    {t("area", { ha: formatNumber(plot.areaHa, locale, 0) })}
                  </span>
                </th>
                {Array.from({ length: seasons }, (_, i) => {
                  const crop: Crop = cropFor(sequence, p, i);
                  return (
                    <td
                      key={i}
                      className={`whitespace-nowrap px-2 py-2 transition-colors ${i === season ? "bg-field-tint" : ""}`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <CropDot crop={crop} />
                        {ts(crop)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-ink-muted">
        {t("note", { ha: formatNumber(layout.farmedHa, locale, 0), plots: seasons })}
      </p>
    </Card>
  );
}

/** Legend swatch in the map's own shape. */
function Hexagon({ fill, dashed = false }: { fill: string; dashed?: boolean }) {
  return (
    <svg viewBox="0 0 20 22" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        d="M10 1l8.66 5v10L10 21l-8.66-5V6z"
        fill={fill}
        fillOpacity={dashed ? 0.45 : 1}
        stroke={fill === "none" ? "var(--ink-muted)" : dashed ? "var(--status-nodata)" : "none"}
        strokeWidth={1.5}
        strokeDasharray={dashed ? "3 2" : undefined}
      />
    </svg>
  );
}
