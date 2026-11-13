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
import { Card } from "@/components/ui/card";
import { CropDot } from "@/components/ui/crop-chip";
import { CrossIcon, PinIcon, PlusIcon } from "@/components/ui/icons";
import { Slider } from "@/components/ui/slider";
import { FieldMap } from "./field-map";

const DEFAULT_POINT: LatLon = { lat: 46.3, lon: 23.75 };

const PRIORITIES = ["yield", "water", "soil", "risk"] as const;
type Priority = (typeof PRIORITIES)[number];
const DEFAULT_PRIORITIES: Record<Priority, number> = { yield: 60, water: 50, soil: 50, risk: 50 };

export function FieldForm({
  initial,
  startPoint,
  onSubmit,
}: {
  initial: FieldRequest | null;
  /** Where the pin starts when there is no earlier request (e.g. a pin passed from the feed screen). */
  startPoint?: LatLon | null;
  onSubmit: (request: FieldRequest) => void;
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

  const canAdd = rotation.length < MAX_ROTATION;
  const canRemove = rotation.length > MIN_ROTATION;

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      location: point,
      current_rotation: rotation as FieldRequest["current_rotation"],
      priorities: Object.fromEntries(PRIORITIES.map((p) => [p, priorities[p] / 100])),
      irrigated,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PinIcon className="text-field" /> {t("whereTitle")}
        </h2>
        <p className="mb-3 text-ink-muted">{t("whereHint")}</p>
        <FieldMap value={point} onChange={setPoint} label={t("mapLabel")} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <span className="tabular-nums">
            {t("coordinates", {
              lat: formatNumber(point.lat, locale, 3),
              lon: formatNumber(point.lon, locale, 3),
            })}
          </span>
          <button
            type="button"
            onClick={() => setPoint(DEFAULT_POINT)}
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
