"use client";

import { useTranslations } from "next-intl";
import type { Crop } from "@/lib/contracts";
import { CropChip } from "@/components/ui/crop-chip";

/** The crop order, with each arrow kept on the line of the chip before it, so no line starts with "→". */
export function CropSequence({ sequence }: { sequence: readonly Crop[] }) {
  const t = useTranslations("Common");
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5" aria-label={t("sequence")}>
      {sequence.map((crop, index) => (
        <li key={index} className="flex items-center gap-1">
          <CropChip crop={crop} size="sm" />
          {index < sequence.length - 1 ? (
            <span aria-hidden="true" className="text-ink-muted">
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
