"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { LatLon, Strategy } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { IconButton } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "@/components/ui/icons";
import { FieldPlanMap } from "./field-plan-map";

const STEP_MS = 1800;

/**
 * The selected rotation on the farmer's own field, season by season, on the 3D terrain map (the
 * map itself is unchanged). One floating pill steps through the seasons or plays them.
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

  return (
    <div className="plan-map-frame relative">
      <FieldPlanMap
        center={center}
        boundary={boundary}
        parts={parts}
        crop={crop}
        cropLabel={tc(crop)}
        fitKey={strategy.id}
        label={t("mapLabel", { year, crop: tc(crop) })}
      />
      <div className="no-print pointer-events-none absolute inset-x-0 top-3 z-[2] flex justify-center px-3">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-pill bg-glass p-1 shadow-float backdrop-blur-md">
          <IconButton label={t("previous")} onClick={() => { setPlaying(false); setSeason((s) => (s - 1 + seasons) % seasons); }}>
            <ChevronLeftIcon size={20} />
          </IconButton>
          <p className="flex min-w-36 items-center justify-center gap-2 px-1 text-sm font-semibold" aria-live="polite">
            <span className="tabular-nums text-ink-muted">{year}</span>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: CROP_COLORS[crop] }} aria-hidden="true" />
            <span className="truncate">{tc(crop)}</span>
          </p>
          <IconButton label={t("next")} onClick={() => { setPlaying(false); setSeason((s) => (s + 1) % seasons); }}>
            <ChevronRightIcon size={20} />
          </IconButton>
          <IconButton label={playing ? t("pause") : t("play")} variant="filled" aria-pressed={playing} onClick={() => setPlaying((p) => !p)}>
            {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </IconButton>
        </div>
      </div>
      {/* On paper: every season of the plan, in order. */}
      <ol className="mt-2 hidden flex-wrap gap-x-4 gap-y-1 text-sm print:flex">
        {sequence.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: CROP_COLORS[c] }} aria-hidden="true" />
            <span className="tabular-nums">{firstSeason + i}</span> {tc(c)}
          </li>
        ))}
      </ol>
    </div>
  );
}
