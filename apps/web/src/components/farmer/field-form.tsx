"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { Crop, FieldRequest, LatLon } from "@/lib/contracts";
import {
  DEFAULT_ROTATION,
  MAX_ROTATION,
  MIN_ROTATION,
  ROTATION_CROPS,
} from "@/lib/crops";
import { useAppLocale } from "@/lib/localized";
import { formatNumber } from "@/lib/format";
import { polygonAreaHa, polygonCentroid } from "@/lib/geo";
import { Card } from "@/components/ui/card";
import { CropDot } from "@/components/ui/crop-chip";
import { CrossIcon, PinIcon, PlusIcon } from "@/components/ui/icons";
import { Slider } from "@/components/ui/slider";
import { FieldMap, type MapMode } from "./field-map";

const DEFAULT_POINT: LatLon = { lat: 46.3, lon: 23.75 };
/** Below 1 ha the 1 ha hexagons cannot cover the field; above this it is a farm, not a field. */
const MIN_FIELD_HA = 1;
const MAX_FIELD_HA = 1200;

const PRIORITIES = ["yield", "water", "soil", "risk"] as const;
type Priority = (typeof PRIORITIES)[number];
const DEFAULT_PRIORITIES: Record<Priority, number> = { yield: 60, water: 50, soil: 50, risk: 50 };

export function FieldForm({
  initial,
  initialBoundary,
  startPoint,
  onSubmit,
}: {
  initial: FieldRequest | null;
  /** The field the farmer drew last time, if any. */
  initialBoundary: LatLon[] | null;
  /** Where the pin starts when there is no earlier request (e.g. a pin passed from the feed screen). */
  startPoint?: LatLon | null;
  /** `boundary` is the drawn field (null with a pin only); the API still receives a point. */
  onSubmit: (request: FieldRequest, boundary: LatLon[] | null) => void;
}) {
  const t = useTranslations("Field");
  const tc = useTranslations("Crops");
  const locale = useAppLocale();

  const [point, setPoint] = useState<LatLon>(initial?.location ?? startPoint ?? DEFAULT_POINT);
  const [rotation, setRotation] = useState<Crop[]>(
    initial ? [...initial.current_rotation] : DEFAULT_ROTATION,
  );
  const [priorities, setPriorities] = useState<Record<Priority, number>>(() =>
    initial
      ? (Object.fromEntries(
          PRIORITIES.map((p) => [p, Math.round((initial.priorities[p] ?? 0.5) * 100)]),
        ) as Record<Priority, number>)
      : DEFAULT_PRIORITIES,
  );
  const [irrigated, setIrrigated] = useState(initial?.irrigated ?? false);
  const [corners, setCorners] = useState<LatLon[]>(initialBoundary ?? []);
  const [mode, setMode] = useState<MapMode>(initialBoundary ? "locked" : "pin");
  const areaHa = polygonAreaHa(corners);
  const tooSmall = corners.length >= 3 && areaHa < MIN_FIELD_HA;
  const tooBig = areaHa > MAX_FIELD_HA;
  const canFinish = corners.length >= 3 && !tooSmall && !tooBig;
  const boundary = mode === "locked" && corners.length >= 3 ? corners : null;

  function startDrawing() {
    setCorners([]);
    setMode("draw");
  }
  function finishDrawing() {
    const c = polygonCentroid(corners);
    setPoint({ lat: Number(c.lat.toFixed(4)), lon: Number(c.lon.toFixed(4)) });
    setMode("locked");
  }
  function switchToPin() {
    setCorners([]);
    setMode("pin");
  }

  const canAdd = rotation.length < MAX_ROTATION;
  const canRemove = rotation.length > MIN_ROTATION;

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(
      {
        location: point,
        current_rotation: rotation as FieldRequest["current_rotation"],
        priorities: Object.fromEntries(PRIORITIES.map((p) => [p, priorities[p] / 100])),
        irrigated,
      },
      boundary,
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PinIcon className="text-field" /> {t("whereTitle")}
        </h2>
        <p className="mb-3 text-ink-muted">{t("whereHint")}</p>

        <div role="radiogroup" aria-label={t("modeLabel")} className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-surface-sunken p-1">
          {(["pin", "draw"] as const).map((m) => {
            const active = m === "pin" ? mode === "pin" : mode !== "pin";
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => (m === "pin" ? switchToPin() : mode === "pin" ? startDrawing() : undefined)}
                className={`press min-h-11 rounded-full px-3 font-semibold ${
                  active ? "bg-surface text-ink shadow-1" : "text-ink-muted hover:text-ink"
                }`}
              >
                {t(`mode.${m}`)}
              </button>
            );
          })}
        </div>

        <FieldMap
          value={point}
          onChange={setPoint}
          mode={mode}
          corners={corners}
          closed={mode === "locked"}
          onAddCorner={(c) => setCorners((prev) => [...prev, c])}
          label={t("mapLabel")}
        />

        {mode === "draw" ? (
          <div className="rise mt-3 flex flex-col gap-3 rounded-2xl bg-field-tint p-3">
            <p>{t("draw.hint")}</p>
            <p className="font-mono font-semibold tabular-nums" aria-live="polite">
              {t("draw.progress", {
                corners: corners.length,
                ha: formatNumber(areaHa, locale, 1),
              })}
            </p>
            {tooSmall ? <p className="text-sm font-medium text-status-bad">{t("draw.tooSmall", { min: MIN_FIELD_HA })}</p> : null}
            {tooBig ? <p className="text-sm font-medium text-status-bad">{t("draw.tooBig", { max: formatNumber(MAX_FIELD_HA, locale, 0) })}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={corners.length === 0}
                onClick={() => setCorners((prev) => prev.slice(0, -1))}
                className="press min-h-11 rounded-full border border-line bg-surface px-4 font-medium hover:border-field disabled:opacity-40"
              >
                {t("draw.undo")}
              </button>
              <button
                type="button"
                disabled={corners.length === 0}
                onClick={() => setCorners([])}
                className="press min-h-11 rounded-full border border-line bg-surface px-4 font-medium hover:border-field disabled:opacity-40"
              >
                {t("draw.clear")}
              </button>
              <button
                type="button"
                disabled={!canFinish}
                onClick={finishDrawing}
                className="press min-h-11 rounded-full bg-field px-5 font-semibold text-on-field hover:bg-field-strong disabled:opacity-40"
              >
                {t("draw.done")}
              </button>
            </div>
          </div>
        ) : null}

        {mode === "locked" ? (
          <div className="rise mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-field-tint p-3">
            <p>
              <span className="block text-sm text-ink-muted">{t("draw.yourField")}</span>
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {t("draw.area", { ha: formatNumber(areaHa, locale, 1) })}
              </span>
              <span className="block text-sm text-ink-muted">{t("draw.corners", { corners: corners.length })}</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("draw")}
                className="press min-h-11 rounded-full border border-line bg-surface px-4 font-medium hover:border-field"
              >
                {t("draw.edit")}
              </button>
              <button
                type="button"
                onClick={switchToPin}
                className="press min-h-11 rounded-full border border-line bg-surface px-4 font-medium hover:border-field"
              >
                {t("draw.remove")}
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <span className="tabular-nums">
            {t("coordinates", {
              lat: formatNumber(point.lat, locale, 3),
              lon: formatNumber(point.lon, locale, 3),
            })}
          </span>
          <button
            type="button"
            onClick={() => {
              switchToPin();
              setPoint(DEFAULT_POINT);
            }}
            className="press min-h-11 rounded-lg px-2 font-medium text-field underline-offset-2 hover:underline"
          >
            {t("resetPin")}
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("rotationTitle")}</h2>
        <p className="mb-3 text-ink-muted">{t("rotationHint")}</p>
        <ol className="flex flex-wrap gap-2" aria-label={t("rotationTitle")}>
          {rotation.map((crop, index) => (
            <li key={index}>
              <span className="press inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-field bg-field-tint pl-3 pr-1">
                <span className="text-sm text-ink-muted">{t("year", { n: index + 1 })}</span>
                <CropDot crop={crop} />
                <span className="font-medium">{tc(crop)}</span>
                <button
                  type="button"
                  disabled={!canRemove}
                  onClick={() => setRotation((r) => r.filter((_, i) => i !== index))}
                  aria-label={t("removeCrop", { crop: tc(crop), n: index + 1 })}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface disabled:opacity-30"
                >
                  <CrossIcon size={16} />
                </button>
              </span>
            </li>
          ))}
        </ol>
        <p className="mb-2 mt-4 text-sm font-medium">
          {canAdd ? t("addCrop") : t("rotationFull", { max: MAX_ROTATION })}
        </p>
        <div className="flex flex-wrap gap-2">
          {ROTATION_CROPS.map((crop) => (
            <button
              key={crop}
              type="button"
              disabled={!canAdd}
              onClick={() => setRotation((r) => [...r, crop])}
              className="press inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3 hover:border-field disabled:opacity-40"
            >
              <PlusIcon size={16} className="text-ink-muted" />
              <CropDot crop={crop} />
              {tc(crop)}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("prioritiesTitle")}</h2>
        <p className="mb-3 text-ink-muted">{t("prioritiesHint")}</p>
        <div className="flex flex-col gap-3">
          {PRIORITIES.map((p) => (
            <Slider
              key={p}
              label={t(`priority.${p}.label`)}
              hint={t(`priority.${p}.hint`)}
              value={priorities[p]}
              step={10}
              onChange={(value) => setPriorities((prev) => ({ ...prev, [p]: value }))}
              valueText={t("importance", { value: priorities[p] })}
            />
          ))}
        </div>
      </Card>

      <Card>
        <label className="press flex min-h-11 cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="block text-lg font-semibold">{t("irrigatedTitle")}</span>
            <span className="text-ink-muted">{t("irrigatedHint")}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={irrigated}
            onChange={(event) => setIrrigated(event.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-8 w-14 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-field peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] after:absolute after:left-1 after:top-1 after:h-6 after:w-6 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:after:translate-x-6"
          />
        </label>
      </Card>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 sm:bottom-4">
        <button
          type="submit"
          className="press min-h-14 w-full rounded-2xl bg-field px-6 text-lg font-semibold text-on-field shadow-lg hover:bg-field-strong"
        >
          {t("analyze")}
        </button>
      </div>
    </form>
  );
}
