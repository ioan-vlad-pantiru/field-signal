"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Crop } from "@/lib/contracts";
import { MAX_ROTATION, MIN_ROTATION, ROTATION_CROPS } from "@/lib/crops";
import { Chip, ChipRow } from "@/components/ui/chip";
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

/**
 * The rotation as a row of year chips: tap a year to change its crop, × to drop it, + to add one.
 * Two common rotations are one tap away.
 */
export function RotationEditor({ rotation, onChange }: { rotation: Crop[]; onChange: (rotation: Crop[]) => void }) {
  const t = useTranslations("Field.setup");
  const tc = useTranslations("Crops");
  const short = useTranslations("CropsShort");
  /** The slot whose crops are shown; `rotation.length` is the new year. */
  const [open, setOpen] = useState<number | null>(null);
  const canAdd = rotation.length < MAX_ROTATION;
  const canRemove = rotation.length > MIN_ROTATION;

  function pick(index: number, crop: Crop) {
    const next = [...rotation];
    next[index] = crop;
    onChange(next);
    setOpen(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <ol aria-label={t("rotation")} className="flex flex-wrap items-center gap-2">
        {rotation.map((crop, index) => (
          <li
            key={index}
            className={`flex items-center rounded-pill text-sm font-semibold ${
              open === index ? "bg-ink text-surface" : "bg-surface shadow-1 ring-1 ring-line"
            }`}
          >
            <button
              type="button"
              aria-expanded={open === index}
              aria-label={t("change", { n: index + 1, crop: tc(crop) })}
              onClick={() => setOpen(open === index ? null : index)}
              className={`press inline-flex min-h-tap items-center gap-2 rounded-pill pl-3 ${canRemove ? "pr-1" : "pr-4"}`}
            >
              <span className="tabular-nums opacity-60">{index + 1}</span>
              <CropDot crop={crop} />
              {short(crop)}
            </button>
            {canRemove ? (
              <button
                type="button"
                aria-label={t("remove", { crop: tc(crop), n: index + 1 })}
                onClick={() => {
                  onChange(rotation.filter((_, i) => i !== index));
                  setOpen(null);
                }}
                className="press flex size-tap items-center justify-center rounded-full opacity-60 hover:opacity-100"
              >
                <CrossIcon size={14} />
              </button>
            ) : null}
          </li>
        ))}
        {canAdd ? (
          <li>
            <button
              type="button"
              aria-expanded={open === rotation.length}
              aria-label={t("addYear")}
              title={t("addYear")}
              onClick={() => setOpen(open === rotation.length ? null : rotation.length)}
              className="press inline-flex size-tap items-center justify-center rounded-full bg-field-soft text-field-strong"
            >
              <PlusIcon size={18} />
            </button>
          </li>
        ) : null}
      </ol>

      {open !== null ? (
        <ChipRow label={t("pickerLabel", { n: open + 1 })}>
          {ROTATION_CROPS.map((crop) => {
            const chosen = rotation[open] === crop;
            return (
              <Chip key={crop} selected={chosen} onClick={() => pick(open, crop)}>
                <CropDot crop={crop} />
                {tc(crop)}
              </Chip>
            );
          })}
        </ChipRow>
      ) : (
        <ChipRow label={t("presets")}>
          {PRESETS.map((preset) => {
            const active = same(preset, rotation);
            return (
              <Chip key={preset.join("-")} selected={active} onClick={() => onChange([...preset])}>
                {active ? <CheckIcon size={14} /> : null}
                {preset.map((crop) => short(crop)).join(" → ")}
              </Chip>
            );
          })}
        </ChipRow>
      )}
    </div>
  );
}
