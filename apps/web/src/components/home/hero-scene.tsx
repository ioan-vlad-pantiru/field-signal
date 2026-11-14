"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Crop } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { cropFor } from "@/lib/field-plan";
import { useMediaQuery, usePageVisible, useWebGLSupport } from "@/components/simulator/use-media";
import { valleyField, village } from "./valley";

const HeroCanvas = dynamic(() => import("./hero-canvas"), { ssr: false });

/** Seasons shown before the year label starts over. */
const YEARS_SHOWN = 8;

/**
 * The start page's 3D scene: the field plan at work in a Transylvanian valley. 1 ha hexagons are
 * laid over the land, the ones on the road, river, village and woods are left out, and the
 * rotation's crops grow and move plot to plot season by season. The static image underneath
 * stays as the poster and the fallback.
 */
export function HeroScene({ sequence, firstYear }: { sequence: readonly Crop[]; firstYear: number }) {
  const t = useTranslations("Results.plan");
  const tc = useTranslations("CropsShort");
  const box = useRef<HTMLDivElement>(null);
  const supported = useWebGLSupport() === true;
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  const lowDetail = useMediaQuery("(max-width: 640px)");
  const pageVisible = usePageVisible();
  const [onScreen, setOnScreen] = useState(true);
  const [ready, setReady] = useState(false);
  const [season, setSeason] = useState(-1);

  const houses = useMemo(() => village(), []);
  const field = useMemo(() => valleyField(Math.min(sequence.length, 4), houses), [sequence.length, houses]);
  const reasons = useMemo(() => [...new Set(field.reasons.values())], [field]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onReady = useCallback(() => setReady(true), []);
  const shown = Math.max(still ? 0 : season, 0);
  const crops = field.layout.plots.map((_, i) => cropFor(sequence, i, shown));

  return (
    <div ref={box} aria-hidden="true" data-scene={ready ? "ready" : "loading"} className="absolute inset-0 -z-10">
      {supported && (
        <div
          className="absolute inset-0 transition-opacity duration-[var(--duration-hero)] ease-[var(--ease-settle)]"
          style={{ opacity: ready ? 1 : 0 }}
        >
          <HeroCanvas
            sequence={sequence}
            houses={houses}
            field={field}
            still={still}
            running={onScreen && pageVisible}
            lowDetail={lowDetail}
            onReady={onReady}
            onSeason={setSeason}
          />
        </div>
      )}
      {supported && ready && (
        <div className="pointer-events-none absolute right-4 top-4 hidden w-60 rounded-xl bg-[#0b120e]/75 p-4 text-white shadow-[0_8px_28px_rgb(0_0_0/0.3)] sm:right-6 sm:top-6 sm:block">
          <p className="text-sm text-white/70">{t("season")}</p>
          <p className="font-display text-4xl font-semibold tabular-nums leading-tight tracking-tight">
            {firstYear + (shown % YEARS_SHOWN)}
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {crops.map((crop, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: CROP_COLORS[crop] }} />
                <span className="tabular-nums text-white/60">
                  {t("plot")} {String.fromCharCode(65 + i)}
                </span>
                <span className="font-medium">{tc(crop)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-2 border-t border-white/15 pt-3 text-sm text-white/80">
            <svg aria-hidden="true" viewBox="0 0 12 14" className="mt-0.5 size-3.5 shrink-0">
              <path d="M6 1 11 4v6l-5 3-5-3V4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span>
              {t("notFarmland", {
                ha: field.reasons.size,
                reasons: reasons.map((r) => t(`reason.${r}`)).join(", "),
              })}
            </span>
          </p>
          <p className="mt-1.5 text-xs text-white/60">{t("hexScale")}</p>
        </div>
      )}
    </div>
  );
}
