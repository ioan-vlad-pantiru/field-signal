"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { Crop } from "@/lib/contracts";
import { MAX_ROTATION, MIN_ROTATION, ROTATION_CROPS } from "@/lib/crops";
import { Chip, ChipRow } from "@/components/ui/chip";
import { INPUT_CLASS } from "@/components/ui/input";
import { CheckIcon, ChevronDownIcon, CrossIcon, PlusIcon } from "@/components/ui/icons";

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
 * The rotation as a small form: one row per year with its crop in a dropdown, a × to drop a year
 * and "Add a year" until the limit. Two common rotations are one tap away.
 */
export function RotationEditor({ rotation, onChange }: { rotation: Crop[]; onChange: (rotation: Crop[]) => void }) {
  const t = useTranslations("Field.setup");
  const tc = useTranslations("Crops");
  const short = useTranslations("CropsShort");
  const id = useId();
  const canAdd = rotation.length < MAX_ROTATION;
  const canRemove = rotation.length > MIN_ROTATION;

  function pick(index: number, crop: Crop) {
    const next = [...rotation];
    next[index] = crop;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label={t("rotation")} className="flex flex-col gap-2">
        {rotation.map((crop, index) => (
          <div key={index} className="flex items-center gap-2">
            <label htmlFor={`${id}-${index}`} className="w-14 shrink-0 text-sm text-ink-muted">
              {t("yearN", { n: index + 1 })}
            </label>
            <div className="relative flex-1">
              <select
                id={`${id}-${index}`}
                value={crop}
                onChange={(event) => pick(index, event.target.value as Crop)}
                className={`${INPUT_CLASS} appearance-none pr-10`}
              >
                {ROTATION_CROPS.map((option) => (
                  <option key={option} value={option}>
                    {tc(option)}
                  </option>
                ))}
              </select>
              <ChevronDownIcon
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted"
              />
            </div>
            {canRemove ? (
              <button
                type="button"
                aria-label={t("remove", { crop: tc(crop), n: index + 1 })}
                onClick={() => onChange(rotation.filter((_, i) => i !== index))}
                className="press flex size-tap shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink"
              >
                <CrossIcon size={16} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {canAdd ? (
        <button
          type="button"
          onClick={() => onChange([...rotation, ROTATION_CROPS[0]])}
          className="press -ml-2 inline-flex min-h-tap w-fit items-center gap-1.5 rounded-pill px-2 text-sm font-semibold text-field hover:bg-surface-sunken"
        >
          <PlusIcon size={16} />
          {t("addYear")}
        </button>
      ) : null}

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
    </div>
  );
}
