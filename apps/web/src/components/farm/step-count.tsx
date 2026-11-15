"use client";

import { useTranslations } from "next-intl";

export const FARM_STEPS = 3;

/** "1/3" in the action bar: where the farmer is in Parcels · Fields · Plan, without a stepper. */
export function StepCount({ step }: { step: 1 | 2 | 3 }) {
  const t = useTranslations("Farm");
  return (
    <span className="flex min-h-tap shrink-0 items-center px-3 text-sm font-semibold tabular-nums text-ink-muted">
      <span className="sr-only">{t("step", { step, total: FARM_STEPS, name: t(`stepName.${step}`) })}</span>
      <span aria-hidden="true">
        {step}/{FARM_STEPS}
      </span>
    </span>
  );
}
