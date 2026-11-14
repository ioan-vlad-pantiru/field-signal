"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CropDot } from "@/components/ui/crop-chip";
import { NoticeBar } from "@/components/ui/notice-bar";
import { Segmented } from "@/components/ui/segmented";
import type { LatLon, Strategy } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { DEMO_FIELD_RECT, toLocalMetres, type Polygon } from "@/lib/sim/geometry";
import { DEFAULT_PLANNER_OPTIONS, estimateHours, planFieldWork } from "@/lib/sim/path-planner";
import { sceneStateAt, type SceneState } from "@/lib/sim/scene-state";
import { buildTimeline, calendarOf, CROP_CALENDAR, isCoverCrop, snapshotTimes, type Timeline } from "@/lib/sim/timeline";
import { DRILLED_2D, Field2D, SOIL_2D, STUBBLE_2D } from "./field-2d";
import type { CameraMode } from "./scene/camera-rig";
import { SimClock, useClock } from "./sim-clock";
import { useMediaQuery, usePageVisible, useWebGLSupport } from "./use-media";

// three.js and the scene live in their own chunk, fetched only when a simulator is on screen.
const SimCanvas = dynamic(() => import("./scene/sim-canvas"), {
  ssr: false,
  loading: () => <SceneLoading />,
});

function SceneLoading() {
  const t = useTranslations("Simulator");
  return (
    <div className="flex h-full items-center justify-center bg-surface-sunken text-ink-muted" role="status">
      {t("loading")}
    </div>
  );
}

const SPEEDS = [1, 2, 4] as const;
const CAMERAS: CameraMode[] = ["overview", "follow", "top"];
const WORK_KMH = 10;
const TURN_KMH = 5;

export interface FieldSimulatorProps {
  strategy: Strategy;
  /** Field boundary as lat/lon points. Defaults to a 10 ha rectangle near Aiud. */
  outline?: LatLon[];
  /** Or a boundary already in local metres (x east, y north). */
  outlineMetres?: Polygon;
}

export function FieldSimulator({ strategy, outline, outlineMetres }: FieldSimulatorProps) {
  const t = useTranslations("Simulator");
  const tc = useTranslations("Crops");
  const locale = useAppLocale();

  const polygon = useMemo<Polygon>(() => {
    if (outlineMetres) return outlineMetres;
    if (outline && outline.length >= 3) {
      const lat = outline.reduce((s, p) => s + p.lat, 0) / outline.length;
      const lon = outline.reduce((s, p) => s + p.lon, 0) / outline.length;
      return toLocalMetres(outline, { lat, lon });
    }
    return DEMO_FIELD_RECT;
  }, [outline, outlineMetres]);

  const plan = useMemo(() => planFieldWork(polygon, DEFAULT_PLANNER_OPTIONS), [polygon]);
  const timeline = useMemo(() => buildTimeline(strategy.sequence), [strategy.sequence]);
  const snapshots = useMemo(() => snapshotTimes(timeline), [timeline]);

  const [clock] = useState(() => new SimClock(timeline.duration));
  useClock(clock);
  useEffect(() => clock.reset(timeline.duration), [clock, timeline]);

  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const small = useMediaQuery("(max-width: 640px)", true);
  const visible = usePageVisible();
  const webgl = useWebGLSupport();
  const [contextLost, setContextLost] = useState(false);
  const [camera, setCamera] = useState<CameraMode>("overview");
  const use3d = webgl === true && !contextLost;

  // Advance the clock while playing.
  const playing = clock.playing;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      clock.tick((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, playing]);

  // Pause when the tab is hidden.
  useEffect(() => {
    if (!visible && clock.playing) clock.setPlaying(false);
  }, [visible, clock]);

  // Reduced motion: never animate, start on the first snapshot instead.
  useEffect(() => {
    if (reducedMotion) {
      clock.setPlaying(false);
      if (clock.time === 0) clock.seek(snapshots[0] ?? 0);
    }
  }, [reducedMotion, clock, snapshots]);

  const onReady = useCallback(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) clock.setPlaying(true);
  }, [clock]);
  const onContextLost = useCallback(() => setContextLost(true), []);

  // The flat fallback has no canvas to signal readiness: start it as soon as we know.
  useEffect(() => {
    if ((webgl === false || contextLost) && !reducedMotion) clock.setPlaying(true);
  }, [webgl, contextLost, reducedMotion, clock]);

  const step = useCallback(
    (dir: 1 | -1) => {
      clock.setPlaying(false);
      const now = clock.time;
      const target = dir > 0 ? snapshots.find((s) => s > now + 0.05) : [...snapshots].reverse().find((s) => s < now - 0.05);
      clock.seek(target ?? (dir > 0 ? clock.duration : 0));
    },
    [clock, snapshots],
  );
  const togglePlay = useCallback(() => {
    if (reducedMotion) step(1);
    else clock.setPlaying(!clock.playing);
  }, [clock, reducedMotion, step]);
  const restart = useCallback(() => {
    clock.seek(reducedMotion ? (snapshots[0] ?? 0) : 0);
    if (!reducedMotion) clock.setPlaying(true);
  }, [clock, reducedMotion, snapshots]);

  // Keyboard controls (ignored while typing in a form field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))) return;
      const isButton = el?.tagName === "BUTTON";
      switch (e.key) {
        case " ":
        case "k":
          if (isButton) return; // Space on a focused button already clicks it.
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          step(1);
          break;
        case "ArrowLeft":
          step(-1);
          break;
        case "1":
        case "2":
        case "4":
          clock.setSpeed(Number(e.key));
          break;
        case "r":
        case "R":
          restart();
          break;
        case "c":
        case "C":
          setCamera((c) => CAMERAS[(CAMERAS.indexOf(c) + 1) % CAMERAS.length]);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, step, togglePlay, restart]);

  const state = sceneStateAt(timeline, plan, clock.time);
  const monthName = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { month: "long" });
    return (m: number) => fmt.format(new Date(2026, m - 1, 1));
  }, [locale]);
  const cal = calendarOf(state.month);
  const phaseText = phaseLabel(t, state);
  const valueText = t("valueText", {
    year: t("year", { n: Math.max(1, cal.year) }),
    crop: tc(state.crop),
    phase: phaseText,
    month: monthName(cal.month),
  });

  return (
    <div className="flex flex-col gap-4">
      <NoticeBar tone="info">{t("banner")}</NoticeBar>
      {webgl === false || contextLost ? <p className="text-sm text-ink-muted">{t("noWebgl")}</p> : null}

      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface-sunken">
        <div className="aspect-[4/5] w-full sm:aspect-[16/9]">
          {webgl === null ? (
            <SceneLoading />
          ) : use3d ? (
            <SimCanvas
              plan={plan}
              timeline={timeline}
              sequence={strategy.sequence}
              clock={clock}
              camera={camera}
              live={playing && visible}
              lowDetail={small}
              reducedMotion={reducedMotion}
              onReady={onReady}
              onContextLost={onContextLost}
            />
          ) : (
            <div className="h-full pt-16">
              <Field2D plan={plan} state={state} label={valueText} />
            </div>
          )}
        </div>

        {/* Season overlay: the same facts as the scene, as real text. */}
        <div className="pointer-events-none absolute left-2.5 top-2.5 max-w-[75%] rounded-xl bg-surface/90 px-3 py-1.5 shadow-2 backdrop-blur" aria-live="polite">
          <p className="text-xs font-medium text-ink-muted">
            {t("year", { n: Math.max(1, cal.year) })} · {monthName(cal.month)}
          </p>
          <p className="flex items-center gap-1.5 font-display font-semibold leading-tight">
            <CropDot crop={state.crop} />
            {tc(state.crop)}
            <span className={`font-sans text-sm font-medium ${state.bare ? "text-wheat-ink" : "text-field"}`}>· {phaseText}</span>
          </p>
        </div>
      </div>

      {use3d ? (
        <Segmented
          label={t("controls.camera")}
          options={CAMERAS.map((c) => ({ value: c, label: t(`camera.${c}`) }))}
          value={camera}
          onChange={setCamera}
          className="-mt-1 w-full"
        />
      ) : null}

      <Legend />

      <Controls
        clock={clock}
        timeline={timeline}
        month={state.month}
        valueText={valueText}
        reducedMotion={reducedMotion}
        onTogglePlay={togglePlay}
        onStep={step}
        onRestart={restart}
      />

      {reducedMotion ? <p className="text-sm text-ink-muted">{t("reducedMotion")}</p> : null}

      <Stats plan={plan} timeline={timeline} monthName={monthName} />
    </div>
  );
}

function phaseLabel(t: ReturnType<typeof useTranslations<"Simulator">>, s: SceneState): string {
  if (s.kind === "harvest") return isCoverCrop(s.crop) ? t("phase.harvestCover") : t("phase.harvest");
  if ((s.kind === "bare" || s.kind === "fallow") && !s.bare) return t("phase.stubble");
  return t(`phase.${s.kind}`);
}

function Legend() {
  const t = useTranslations("Simulator.legend");
  const items = [
    { key: "bare", style: { background: SOIL_2D } },
    { key: "drilled", style: { background: `repeating-linear-gradient(90deg, ${DRILLED_2D} 0 3px, #48331f 3px 5px)` } },
    { key: "covered", style: { background: "#5f8f3b" } },
    { key: "stubble", style: { background: STUBBLE_2D } },
    { key: "headland", style: { background: "transparent", border: "2px dashed #b9ab8c" } },
  ] as const;
  return (
    <div className="text-sm">
      <h2 className="sr-only">{t("title")}</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-ink-muted">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-5 shrink-0 rounded-sm" style={item.style} />
            {t(item.key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Controls({
  clock,
  timeline,
  month,
  valueText,
  reducedMotion,
  onTogglePlay,
  onStep,
  onRestart,
}: {
  clock: SimClock;
  timeline: Timeline;
  month: number;
  valueText: string;
  reducedMotion: boolean;
  onTogglePlay: () => void;
  onStep: (dir: 1 | -1) => void;
  onRestart: () => void;
}) {
  const t = useTranslations("Simulator");
  return (
    <div className="flex flex-col gap-3 border-y border-line py-4">
      <div className="flex flex-wrap items-center gap-2">
        {reducedMotion ? null : (
          <Button className="min-w-24" onClick={onTogglePlay}>
            {clock.playing ? t("controls.pause") : t("controls.play")}
          </Button>
        )}
        <Button variant="secondary" onClick={() => onStep(-1)} aria-label={t("controls.prev")}>
          ←<span className="sr-only sm:not-sr-only">{t("controls.prevShort")}</span>
        </Button>
        <Button variant="secondary" onClick={() => onStep(1)} aria-label={t("controls.next")}>
          <span className="sr-only sm:not-sr-only">{t("controls.nextShort")}</span>→
        </Button>
        <Button variant="secondary" onClick={onRestart}>
          {t("controls.restart")}
        </Button>
        {reducedMotion ? null : (
          <Segmented
            label={t("controls.speed")}
            options={SPEEDS.map((sp) => ({ value: String(sp), label: <span className="tabular-nums">{sp}×</span> }))}
            value={String(clock.speed)}
            onChange={(sp) => clock.setSpeed(Number(sp))}
            className="ml-auto"
          />
        )}
      </div>

      <TimelineBar timeline={timeline} month={month} />
      <input
        type="range"
        className="slider w-full"
        min={0}
        max={timeline.duration}
        step={0.1}
        value={clock.time}
        aria-label={t("controls.scrub")}
        aria-valuetext={valueText}
        onChange={(e) => {
          clock.setPlaying(false);
          clock.seek(Number(e.target.value));
        }}
        style={{ "--fill": `${(clock.time / timeline.duration) * 100}%` } as React.CSSProperties}
      />
      <p className="hidden text-xs text-ink-muted sm:block">{t("controls.keys")}</p>
    </div>
  );
}

/**
 * Season strip on a month scale (not animation time), so a nine-month bare gap looks nine months
 * long: hatched brown = bare soil, crop colour = crop on the field.
 */
function TimelineBar({ timeline, month }: { timeline: Timeline; month: number }) {
  const t = useTranslations("Simulator.timeline");
  const tc = useTranslations("CropsShort");
  const segments = useMemo(
    () => timeline.phases.filter((p) => p.monthEnd > p.monthStart && p.kind !== "sow" && p.kind !== "harvest"),
    [timeline],
  );
  const first = segments[0]?.monthStart ?? 0;
  const span = Math.max(1, (segments[segments.length - 1]?.monthEnd ?? 1) - first);
  const pct = (m: number) => `${((m - first) / span) * 100}%`;
  const hatch = `repeating-linear-gradient(135deg, ${SOIL_2D} 0 5px, #92735a 5px 9px)`;

  return (
    <div aria-hidden="true">
      <div className="relative h-7 overflow-hidden rounded-lg border border-line bg-surface-sunken">
        {segments.map((p, i) => {
          const bare = p.kind === "bare" || p.kind === "fallow";
          const months = p.monthEnd - p.monthStart;
          return (
            <div
              key={i}
              className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[11px] font-semibold"
              style={{
                left: pct(p.monthStart),
                width: pct(first + months),
                background: bare ? hatch : CROP_COLORS[p.crop],
                color: bare ? "#fff8ec" : "#14201a",
              }}
            >
              {bare && months >= 3 ? t("months", { months }) : null}
            </div>
          );
        })}
        <div className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface" style={{ left: pct(Math.min(Math.max(month, first), first + span)) }} />
      </div>
      <div className="relative mt-1 h-5 text-xs">
        {segments
          .filter((p) => p.kind === "grow")
          .map((p) => (
            <span
              key={p.cropIndex}
              className="absolute truncate font-medium"
              style={{ left: pct(p.monthStart), width: pct(first + p.monthEnd - p.monthStart) }}
            >
              {tc(p.crop)}
            </span>
          ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 whitespace-nowrap text-xs text-ink-muted">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: `repeating-linear-gradient(135deg, ${SOIL_2D} 0 3px, #92735a 3px 6px)` }} />
          {t("bare")}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm bg-field" />
          {t("covered")}
        </span>
        <span className="sm:ml-auto">{t("scale")}</span>
      </div>
    </div>
  );
}

function Stats({ plan, timeline, monthName }: { plan: ReturnType<typeof planFieldWork>; timeline: Timeline; monthName: (m: number) => string }) {
  const t = useTranslations("Simulator.stats");
  const ts = useTranslations("Simulator");
  const tc = useTranslations("Crops");
  const locale = useAppLocale();
  const n = (v: number, d = 1) => formatNumber(v, locale, d);
  const hours = estimateHours(plan, WORK_KMH, TURN_KMH);
  const bareMonths = timeline.bareGaps.reduce((s, g) => s + g.months, 0);

  const rows: { label: string; value: string; hint?: string }[] = [
    { label: t("area"), value: `${n(plan.fieldAreaM2 / 10_000)} ha` },
    {
      label: t("passes"),
      value: n(plan.passes.length, 0),
      hint: t("passesHint", { width: n(plan.workingWidthM, 0), laps: plan.headlandLaps.length }),
    },
    { label: t("distance"), value: `${n(plan.totalDistanceM / 1000)} km` },
    { label: t("time"), value: `≈ ${n(hours)} h`, hint: t("timeHint", { work: WORK_KMH, turn: TURN_KMH }) },
    { label: t("bare"), value: n(bareMonths, 0) },
  ];

  return (
    <section className="pt-2" aria-labelledby="sim-stats">
      <h2 id="sim-stats" className="text-2xl font-semibold tracking-tight">
        {t("title")}
      </h2>
      <p className="text-sm text-ink-muted">{t("illustrative")}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rows.map((r) => (
          <div key={r.label} className="rounded-xl bg-surface-sunken p-3">
            <dt className="text-sm text-ink-muted">{r.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{r.value}</dd>
            {r.hint ? <dd className="text-xs text-ink-muted">{r.hint}</dd> : null}
          </div>
        ))}
      </dl>

      <h3 className="mt-4 font-semibold">{t("seasons")}</h3>
      <ol className="mt-2 flex flex-col gap-1.5">
        {timeline.sequence.map((crop, i) => {
          const cal = CROP_CALENDAR[crop];
          const gap = i > 0 ? timeline.bareGaps[i - 1] : undefined;
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="w-16 shrink-0 text-ink-muted">{ts("year", { n: i + 1 })}</span>
              <CropDot crop={crop} />
              <span className="font-medium">{tc(crop)}</span>
              {cal ? (
                <span className="text-ink-muted">
                  {ts(isCoverCrop(crop) ? "seasonRowCover" : "seasonRow", {
                    sow: monthName(cal.sow),
                    harvest: monthName(cal.harvest),
                  })}
                </span>
              ) : null}
              {gap && gap.months > 0 ? (
                <span className="text-ink-muted">· {ts("timeline.bareGap", { months: gap.months })}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
