"use client";

import { useTranslations } from "next-intl";
import type { Crop } from "@/lib/contracts";
import { cropGroup, type CropGroup } from "@/lib/crops";

const GROUP_DOT: Record<CropGroup, string> = {
  cereal: "bg-wheat",
  legume: "bg-status-good",
  oilseed: "bg-status-watch",
  cover: "bg-field",
  fallow: "bg-status-nodata",
};

export function CropDot({ crop }: { crop: Crop }) {
  return (
    <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${GROUP_DOT[cropGroup(crop)]}`} />
  );
}

/** A crop name with a dot for its family (cereal, legume, ...). */
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
