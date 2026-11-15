"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Crop } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { cropFor } from "@/lib/field-plan";
import { useMediaQuery, usePageVisible, useWebGLSupport } from "@/components/simulator/use-media";
import { village } from "./valley";

const HeroCanvas = dynamic(() => import("./hero-canvas"), { ssr: false });

/** The scene shows up to this many plots, one per year of the rotation. */
const MAX_PLOTS = 4;

/**
 * The start page's 3D scene: a valley cut into plots along the field plan's axis, the parts on the
 * road, river, village and woods left out of the plan, and the rotation's crops growing plot by
 * plot season by season. The static image underneath stays as the poster and the fallback.
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
  const plots = Math.min(sequence.length, MAX_PLOTS);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onReady = useCallback(() => setReady(true), []);
  const shown = Math.max(still ? 0 : season, 0);
  // The outermost band falls outside the farmed land, so the card lists one crop fewer.
  const crops = Array.from({ length: plots - 1 }, (_, i) => cropFor(sequence, i, shown));

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
            plots={plots}
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
            {firstYear + (shown % sequence.length)}
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {crops.map((crop, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: CROP_COLORS[crop] }} />
                <span className="font-medium">{tc(crop)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
