"use client";

import { useTranslations } from "next-intl";
import type { Crop, CropOutlook, RiskLevel, Zone } from "@/lib/contracts";
import { Chip, ChipRow } from "@/components/ui/chip";
import { CropDot } from "@/components/ui/crop-chip";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";

const LEVELS: RiskLevel[] = ["low", "medium", "high"];
const SUMMARY_KEY = { low: "good", medium: "watch", high: "bad" } as const;

/** The crop being bought (a filter, so chips), then how many communes fall in each supply-risk level. */
export function CropFilter({
  crops,
  value,
  onChange,
  zones,
  outlookFor,
  cropName,
}: {
  crops: Crop[];
  value: Crop;
  onChange: (crop: Crop) => void;
  zones: Zone[];
  outlookFor: (zone: Zone) => CropOutlook | undefined;
  cropName: string;
}) {
  const t = useTranslations("Feed");
  const tc = useTranslations("Crops");

  return (
    <div className="flex flex-col gap-2">
      <ChipRow label={t("cropToggle")}>
        {crops.map((c) => (
          <Chip key={c} selected={c === value} onClick={() => onChange(c)}>
            <CropDot crop={c} />
            {tc(c)}
          </Chip>
        ))}
      </ChipRow>
      {zones.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-live="polite">
          {LEVELS.map((level) => {
            const count = zones.filter((z) => outlookFor(z)?.availability.level === level).length;
            const tone = RISK_TONE[level];
            const Icon = TONE_ICONS[tone];
            return (
              <li
                key={level}
                className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-sm ${TONE_CLASSES[tone].soft}`}
              >
                <span aria-hidden="true" className={TONE_CLASSES[tone].text}>
                  <Icon size={16} />
                </span>
                <span aria-hidden="true">
                  <span className="font-semibold tabular-nums">{count}</span> {t(`counts.${level}`)}
                </span>
                <span className="sr-only">
                  {count} {t(`summary.${SUMMARY_KEY[level]}`, { count, crop: cropName })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
