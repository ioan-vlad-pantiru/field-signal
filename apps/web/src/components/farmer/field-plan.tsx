"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Crop, LatLon, Strategy } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { cropFor, hexField, layoutField } from "@/lib/field-plan";
import type { NonFarmland } from "@/lib/land-cover";
import { formatNumber } from "@/lib/format";
import { polygonAreaHa } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { CropDot } from "@/components/ui/crop-chip";
import { FieldPlanMap, type PlotView } from "./field-plan-map";

const STEP_MS = 1800;

/**
 * "Which crop goes where": the rotation selected on the results page laid out on the farmer's
 * field, season by season. Without a drawn boundary the field outline is illustrative.
 */
export function FieldPlan({
  center,
  boundary,
  strategy,
}: {
  center: LatLon;
  boundary: LatLon[] | null;
  /** The page's selected rotation; the plan restarts at its first season when it changes. */
  strategy: Strategy;
}) {
  const t = useTranslations("Results.plan");
  const tc = useTranslations("Crops");
  const ts = useTranslations("CropsShort");
  const locale = useAppLocale();
  const sequence = strategy.sequence;
  const seasons = sequence.length;
  const firstSeason = useMemo(() => new Date().getFullYear() + 1, []);

  const [season, setSeason] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [shownId, setShownId] = useState(strategy.id);
  if (shownId !== strategy.id) {
    setShownId(strategy.id);
    setSeason(0);
  }
  const hexes = useMemo(() => hexField(center, boundary), [center, boundary]);
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

  return (
    <div className="flex flex-col gap-4 print:gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-ink-muted">{t("season")}</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums" aria-live="polite">
            {year}
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
        layout={layout}
        plots={plots}
        boundary={boundary}
        onNonFarmland={setNonFarmland}
        fitKey={strategy.id}
        onUnavailable={setMapUnavailable}
        label={t("mapLabel", {
          year,
          plots: plots.map((p) => `${p.id}: ${p.label}`).join(", "),
        })}
      />

      <ul hidden={mapUnavailable} className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={t("legend")}>
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

      {/* Phone: one block per plot, its crop in each season, so nothing scrolls sideways. */}
      <ul aria-label={t("tableCaption")} className="flex flex-col divide-y divide-line border-y border-line sm:hidden">
        {layout.plots.map((plot, p) => (
          <li key={plot.id} className="flex flex-col gap-2 py-3">
            <p className="font-semibold">
              {t("plot")} {plot.id}{" "}
              <span className="font-normal tabular-nums text-ink-muted">
                · {t("area", { ha: formatNumber(plot.areaHa, locale, 0) })}
              </span>
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {Array.from({ length: seasons }, (_, i) => {
                const crop: Crop = cropFor(sequence, p, i);
                return (
                  <div
                    key={i}
                    className={`flex items-baseline gap-2 rounded-lg px-2 py-1 ${i === season ? "bg-surface-sunken" : ""}`}
                  >
                    <dt className={`tabular-nums ${i === season ? "font-semibold" : "text-ink-muted"}`}>
                      {firstSeason + i}
                    </dt>
                    <dd className="flex min-w-0 items-start gap-1.5 leading-snug">
                      <span className="inline-flex shrink-0 self-start pt-[0.45em]">
                        <CropDot crop={crop} />
                      </span>
                      <span className="min-w-0 break-words">{ts(crop)}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>

      <div className="relative hidden overflow-x-auto sm:block print:break-inside-avoid">
        <table className="w-full min-w-[22rem] border-collapse text-left text-sm">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead className="border-b border-line">
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
                    className={`press min-h-11 w-full rounded-lg px-2 font-semibold tabular-nums print:min-h-0 print:bg-transparent print:py-1 print:text-ink ${
                      i === season ? "bg-field text-on-field" : "hover:bg-surface-sunken"
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
                <th scope="row" className="whitespace-nowrap px-3 py-2 font-semibold print:py-1">
                  {plot.id}
                  <span className="block text-xs font-normal tabular-nums text-ink-muted">
                    {t("area", { ha: formatNumber(plot.areaHa, locale, 0) })}
                  </span>
                </th>
                {Array.from({ length: seasons }, (_, i) => {
                  const crop: Crop = cropFor(sequence, p, i);
                  return (
                    <td
                      key={i}
                      className={`whitespace-nowrap px-2 py-2 print:bg-transparent print:py-1 ${i === season ? "bg-surface-sunken" : ""}`}
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
        {boundary
          ? t("noteDrawn", {
              area: formatNumber(polygonAreaHa(boundary), locale, 1),
              ha: formatNumber(layout.farmedHa, locale, 0),
              plots: seasons,
            })
          : t("note", { ha: formatNumber(layout.farmedHa, locale, 0), plots: seasons })}
      </p>
    </div>
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
