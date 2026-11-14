"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Crop, FieldRequest, LatLon } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { polygonAreaHa, polygonCentroid } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { SATELLITE_ATTRIBUTION, type Basemap } from "@/components/map/use-map";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Stepper } from "@/components/ui/stepper";
import { FieldMap, type MapFocus, type MapMode } from "./field-map";
import type { Commune } from "./steps/communes";
import { FieldStep, MAX_FIELD_HA, MIN_FIELD_HA } from "./steps/field-step";
import { PrioritiesStep, levelsFrom, weightsFrom, type PriorityLevels } from "./steps/priorities-step";
import { RotationStep, START_ROTATION } from "./steps/rotation-step";

const DEFAULT_POINT: LatLon = { lat: 46.3, lon: 23.75 };
const STEPS = ["field", "rotation", "priorities"] as const;
export type FormStep = 0 | 1 | 2;

/**
 * The farmer's three steps (field, rotation, what matters) beside one map. Laptop: map on the
 * left, sticky; phone: map on top and a sticky action bar under the panel.
 */
export function FieldForm({
  initial,
  initialBoundary,
  initialStep = 0,
  startPoint,
  initialPlace = null,
  communes,
  notice,
  onSubmit,
}: {
  initial: FieldRequest | null;
  /** The field the farmer drew last time, if any. */
  initialBoundary: LatLon[] | null;
  initialStep?: FormStep;
  /** Where the map opens when there is no earlier request (e.g. a point passed from the feed screen). */
  startPoint?: LatLon | null;
  /** The place name known so far (feed link or saved field), replaced by a commune picked in the search. */
  initialPlace?: string | null;
  communes: Commune[];
  /** Shown above the step, such as the place pinned from the feed screen. */
  notice?: ReactNode;
  /** `boundary` is the drawn field; the API still receives a point, its centroid. */
  onSubmit: (request: FieldRequest, boundary: LatLon[], place: string | null) => void;
}) {
  const t = useTranslations("Field");
  const locale = useAppLocale();

  const [step, setStep] = useState<FormStep>(initialBoundary ? initialStep : 0);
  const [point, setPoint] = useState<LatLon>(initial?.location ?? startPoint ?? DEFAULT_POINT);
  const [rotation, setRotation] = useState<Crop[]>(initial ? [...initial.current_rotation] : START_ROTATION);
  const [levels, setLevels] = useState<PriorityLevels>(() => levelsFrom(initial?.priorities));
  const [irrigated, setIrrigated] = useState(initial?.irrigated ?? false);
  const [corners, setCorners] = useState<LatLon[]>(initialBoundary ?? []);
  const [mode, setMode] = useState<MapMode>(initialBoundary ? "locked" : "draw");
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [place, setPlace] = useState<string | null>(initialPlace);

  const areaHa = polygonAreaHa(corners);
  const boundary = mode === "locked" && corners.length >= 3 ? corners : null;
  const drawing = step === 0 && mode === "draw";

  function finishDrawing() {
    if (corners.length < 3 || areaHa < MIN_FIELD_HA || areaHa > MAX_FIELD_HA) return;
    const c = polygonCentroid(corners);
    setPoint({ lat: Number(c.lat.toFixed(4)), lon: Number(c.lon.toFixed(4)) });
    setMode("locked");
  }

  function go(next: FormStep) {
    setStep(next);
    // On a phone the panel sits under the map: bring the new step's title into view.
    document.getElementById("field-step-panel")?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!boundary) return;
    if (step < 2) {
      go((step + 1) as FormStep);
      return;
    }
    onSubmit(
      {
        location: point,
        current_rotation: rotation as FieldRequest["current_rotation"],
        priorities: weightsFrom(levels),
        irrigated,
      },
      boundary,
      place,
    );
  }

  const stepLabels = STEPS.map((s) => t(`steps.${s}`));

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-10"
    >
      <div
        className={`relative lg:sticky lg:top-[5.25rem] lg:h-[calc(100svh-7.5rem)] lg:min-h-[480px] ${
          step === 0 ? "h-[max(55svh,320px)]" : "h-[max(28svh,200px)]"
        }`}
      >
        <FieldMap
          value={point}
          mode={drawing ? "draw" : "locked"}
          corners={corners}
          closed={mode === "locked"}
          onAddCorner={(c) => setCorners((prev) => [...prev, c])}
          label={t("mapLabel")}
          basemap={basemap}
          focus={focus}
          onUnavailable={() => setMapFailed(true)}
          className="h-full"
        />
        {mapFailed ? null : (
        <div className="absolute left-2 top-2 z-[1]">
          <Segmented
            label={t("basemap.label")}
            options={[
              { value: "satellite", label: t("basemap.satellite") },
              { value: "map", label: t("basemap.map") },
            ]}
            value={basemap}
            onChange={setBasemap}
            className="shadow-2"
          />
        </div>
        )}
        {drawing && !mapFailed ? (
          // Phone: the panel starts below the map, so the map itself says what to do and how big the field is.
          <p
            aria-hidden="true"
            className="absolute left-2 top-16 z-[1] max-w-[calc(100%-4rem)] rounded-lg bg-surface/90 px-2.5 py-1 text-sm tabular-nums text-ink shadow-2 lg:hidden"
          >
            {corners.length === 0
              ? t("draw.mapHint")
              : `${t("draw.cornerCount", { corners: corners.length })} · ${t("draw.area", { ha: formatNumber(areaHa, locale, 1) })}`}
          </p>
        ) : null}
        {basemap === "satellite" && !mapFailed ? (
          // Licence: the credit stays visible, on one small line; the full text is also behind the (i) control.
          <p className="absolute bottom-2 left-2 right-10 z-[1] flex">
            <a
              href={SATELLITE_ATTRIBUTION.href}
              target="_blank"
              rel="noopener"
              title={SATELLITE_ATTRIBUTION.text}
              className="truncate rounded-md bg-surface/90 px-1.5 py-px text-[11px] leading-4 text-ink underline-offset-2 hover:underline"
            >
              {SATELLITE_ATTRIBUTION.text}
            </a>
          </p>
        ) : null}
      </div>

      <div id="field-step-panel" className="flex min-w-0 flex-col gap-6">
        <Stepper label={t("steps.label")} steps={stepLabels} current={step} onSelect={(i) => go(i as FormStep)} />
        {notice}

        {step === 0 ? (
          <FieldStep
            communes={communes}
            onFocus={(p, zoom, name) => {
              setFocus((prev) => ({ point: p, zoom, seq: (prev?.seq ?? 0) + 1 }));
              setPlace(name);
            }}
            mode={mode}
            corners={corners}
            areaHa={areaHa}
            onUndo={() => setCorners((prev) => prev.slice(0, -1))}
            onClear={() => setCorners([])}
            onDone={finishDrawing}
            onEdit={() => setMode("draw")}
            onRestart={() => {
              setCorners([]);
              setMode("draw");
            }}
          />
        ) : null}
        {step === 1 ? <RotationStep rotation={rotation} onChange={setRotation} /> : null}
        {step === 2 ? (
          <PrioritiesStep levels={levels} onLevels={setLevels} irrigated={irrigated} onIrrigated={setIrrigated} />
        ) : null}

        {/* Always in view: above the phone bottom navigation, at the viewport bottom from 640 px. */}
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-line bg-surface px-4 py-3 shadow-3 sm:bottom-0 lg:mx-0 lg:px-0 lg:shadow-none">
          {!boundary ? (
            <p className="mb-2 text-center text-sm font-medium text-ink-muted" aria-live="polite">
              {mode === "draw" && corners.length >= 3 ? t("needDone") : t("needField")}
            </p>
          ) : null}
          <div className="flex gap-2">
            {step > 0 ? (
              <Button variant="secondary" size="lg" onClick={() => go((step - 1) as FormStep)}>
                <ArrowLeftIcon />
                <span className="max-sm:sr-only">{t("back")}</span>
              </Button>
            ) : null}
            <Button type="submit" size="lg" disabled={!boundary} className="flex-1">
              {step === 2 ? t("analyze") : t("continue")}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
