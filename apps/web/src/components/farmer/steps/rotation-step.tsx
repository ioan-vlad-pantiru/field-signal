"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Crop } from "@/lib/contracts";
import { MAX_ROTATION, MIN_ROTATION, ROTATION_CROPS } from "@/lib/crops";
import { CropDot } from "@/components/ui/crop-chip";
import { CheckIcon, CrossIcon, PlusIcon } from "@/components/ui/icons";

/** Two filled years by default; the farmer adds up to four. */
export const START_ROTATION: Crop[] = ["maize", "wheat"];

const PRESETS: readonly Crop[][] = [
  ["maize", "wheat"],
  ["maize", "sunflower", "wheat"],
];

function same(a: readonly Crop[], b: readonly Crop[]) {
  return a.length === b.length && a.every((crop, i) => crop === b[i]);
}

/** The crops for one year slot, shown under the slot that opened it. */
function CropPicker({
  year,
  value,
  onPick,
}: {
  year: number;
  value: Crop | null;
  onPick: (crop: Crop) => void;
}) {
  const t = useTranslations("Field");
  const tc = useTranslations("Crops");
  return (
    <div role="group" aria-label={t("rotation.pickerLabel", { n: year })} className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-3">
      {ROTATION_CROPS.map((crop) => {
        const chosen = crop === value;
        return (
          <button
            key={crop}
            type="button"
            aria-pressed={chosen}
            onClick={() => onPick(crop)}
            className={`press inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left ${
              chosen ? "border-field font-semibold" : "border-line hover:border-ink"
            }`}
          >
            <CropDot crop={crop} />
            <span className="flex-1">{tc(crop)}</span>
            {chosen ? <CheckIcon size={16} className="text-field" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function RotationStep({ rotation, onChange }: { rotation: Crop[]; onChange: (rotation: Crop[]) => void }) {
  const t = useTranslations("Field");
  const tc = useTranslations("Crops");
  /** Index of the slot whose picker is open; `rotation.length` is the "add a year" slot. */
  const [open, setOpen] = useState<number | null>(null);
  const canAdd = rotation.length < MAX_ROTATION;
  const canRemove = rotation.length > MIN_ROTATION;

  function pick(index: number, crop: Crop) {
    const next = [...rotation];
    next[index] = crop;
    onChange(next);
    setOpen(null);
  }

  function remove(index: number) {
    onChange(rotation.filter((_, i) => i !== index));
    setOpen(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("rotation.title")}</h1>
        <p className="mt-1 text-ink-muted">{t("rotation.hint")}</p>
      </header>

      <div className="flex flex-col gap-2">
        <p className="font-medium">{t("rotation.presets")}</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const active = same(preset, rotation);
            return (
              <button
                key={preset.join("-")}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onChange([...preset]);
                  setOpen(null);
                }}
                className={`press inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 font-medium ${
                  active ? "border-field text-field" : "border-line hover:border-ink"
                }`}
              >
                {active ? <CheckIcon size={16} /> : null}
                {preset.map((crop) => tc(crop)).join(", ")}
              </button>
            );
          })}
        </div>
      </div>

      <ol className="flex flex-col divide-y divide-line border-y border-line" aria-label={t("rotation.title")}>
        {rotation.map((crop, index) => (
          <li key={index} className="py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={open === index}
                aria-label={t("rotation.change", { n: index + 1, crop: tc(crop) })}
                onClick={() => setOpen(open === index ? null : index)}
                className="press flex min-h-12 flex-1 items-center gap-3 rounded-xl px-2 text-left hover:bg-surface-sunken"
              >
                <span className="w-16 shrink-0 text-sm text-ink-muted">{t("year", { n: index + 1 })}</span>
                <CropDot crop={crop} />
                <span className="flex-1 text-lg font-medium">{tc(crop)}</span>
                <span className="text-sm text-field">{t("rotation.changeShort")}</span>
              </button>
              {canRemove ? (
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={t("removeCrop", { crop: tc(crop), n: index + 1 })}
                  className="press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-surface-sunken hover:text-ink"
                >
                  <CrossIcon size={18} />
                </button>
              ) : null}
            </div>
            {open === index ? <CropPicker year={index + 1} value={crop} onPick={(c) => pick(index, c)} /> : null}
          </li>
        ))}
        {canAdd ? (
          <li className="py-2">
            <button
              type="button"
              aria-expanded={open === rotation.length}
              onClick={() => setOpen(open === rotation.length ? null : rotation.length)}
              className="press flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-field hover:bg-surface-sunken"
            >
              <span className="w-16 shrink-0 text-sm text-ink-muted">{t("year", { n: rotation.length + 1 })}</span>
              <PlusIcon size={18} />
              <span className="font-medium">{t("rotation.addYear")}</span>
            </button>
            {open === rotation.length ? (
              <CropPicker year={rotation.length + 1} value={null} onPick={(c) => pick(rotation.length, c)} />
            ) : null}
          </li>
        ) : null}
      </ol>
      <p className="text-sm text-ink-muted">
        {canAdd ? t("rotation.limits", { min: MIN_ROTATION, max: MAX_ROTATION }) : t("rotationFull", { max: MAX_ROTATION })}
      </p>
    </div>
  );
}
