"use client";

import { useTranslations } from "next-intl";
import type { Crop } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";

export function CropDot({ crop }: { crop: Crop }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-ink/15"
      style={{ background: CROP_COLORS[crop] }}
    />
  );
}

/** A crop name with its colour dot (the same colour as on the field-plan map). */
export function CropChip({ crop, size = "md" }: { crop: Crop; size?: "sm" | "md" }) {
  const t = useTranslations("Crops");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface ${
        size === "sm" ? "px-2 py-0.5 text-sm" : "px-3 py-1"
      }`}
    >
      <CropDot crop={crop} />
      {t(crop)}
    </span>
  );
}

export function CropSequence({ sequence }: { sequence: readonly Crop[] }) {
  const t = useTranslations("Common");
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label={t("sequence")}>
      {sequence.map((crop, index) => (
        <li key={index} className="flex items-center gap-1">
          {index > 0 ? (
            <span aria-hidden="true" className="text-ink-muted">
              →
            </span>
          ) : null}
          <CropChip crop={crop} size="sm" />
        </li>
      ))}
    </ol>
  );
}
