"use client";

import { useTranslations } from "next-intl";
import type { Confidence, CropOutlook } from "@/lib/contracts";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";
import { warningCount } from "./commune-sort";

/** A 44px checkbox that ticks a commune for the comparison without opening it. */
export function Tick({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label
      className="inline-flex size-tap shrink-0 cursor-pointer items-center justify-center rounded-pill"
      onClick={(event) => event.stopPropagation()}
    >
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="size-5 accent-field" />
    </label>
  );
}

/** Quality: the icon of the overall level plus the number of warnings, or "None". */
export function Warnings({ outlook }: { outlook: CropOutlook }) {
  const t = useTranslations("Feed.table");
  const count = warningCount(outlook);
  if (count === 0) return <span className="text-sm text-ink-muted">{t("noWarnings")}</span>;
  const tone = RISK_TONE[outlook.quality.level];
  const Icon = TONE_ICONS[tone];
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <span className={TONE_CLASSES[tone].text}>
        <Icon size={16} />
      </span>
      {t("warnings", { count })}
    </span>
  );
}

const CONFIDENCE_DOTS: Record<Confidence, number> = { low: 1, medium: 2, high: 3 };

/** A forecast's confidence as three dots and a word, sized for a table cell. */
export function ConfidenceMark({ confidence }: { confidence: Confidence }) {
  const t = useTranslations("Confidence");
  const filled = CONFIDENCE_DOTS[confidence];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((dot) => (
          <span key={dot} className={`size-2 rounded-pill ${dot <= filled ? "bg-field" : "bg-line"}`} />
        ))}
      </span>
      {t(confidence)}
    </span>
  );
}
