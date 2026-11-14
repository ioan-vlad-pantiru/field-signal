"use client";

import { useTranslations } from "next-intl";
import type { FieldRequest } from "@/lib/contracts";
import { Segmented } from "@/components/ui/segmented";

export const PRIORITIES = ["yield", "water", "soil", "risk"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type Level = "less" | "matters" | "most";
export type PriorityLevels = Record<Priority, Level>;

/** Sent to the API as weights; it normalises them, so only their ratio matters. */
export const LEVEL_WEIGHT: Record<Level, number> = { less: 0.2, matters: 0.6, most: 1 };
const LEVELS: readonly Level[] = ["less", "matters", "most"];

export const DEFAULT_LEVELS: PriorityLevels = { yield: "matters", water: "matters", soil: "matters", risk: "matters" };

function levelFor(weight: number | undefined): Level {
  if (weight == null) return "matters";
  return weight < 0.4 ? "less" : weight < 0.8 ? "matters" : "most";
}

/** Levels back from an earlier request, e.g. after "Change field or rotation". */
export function levelsFrom(priorities: FieldRequest["priorities"] | undefined): PriorityLevels {
  if (!priorities) return DEFAULT_LEVELS;
  return Object.fromEntries(PRIORITIES.map((p) => [p, levelFor(priorities[p])])) as PriorityLevels;
}

export function weightsFrom(levels: PriorityLevels): Record<Priority, number> {
  return Object.fromEntries(PRIORITIES.map((p) => [p, LEVEL_WEIGHT[levels[p]]])) as Record<Priority, number>;
}

export function PrioritiesStep({
  levels,
  onLevels,
  irrigated,
  onIrrigated,
}: {
  levels: PriorityLevels;
  onLevels: (levels: PriorityLevels) => void;
  irrigated: boolean;
  onIrrigated: (irrigated: boolean) => void;
}) {
  const t = useTranslations("Field");
  const options = LEVELS.map((value) => ({ value, label: t(`level.${value}`) }));

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("prioritiesTitle")}</h1>
        <p className="mt-1 text-ink-muted">{t("prioritiesHint")}</p>
      </header>

      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {PRIORITIES.map((p) => (
          <li key={p} className="flex flex-col gap-1.5 py-3">
            <p>
              <span className="font-medium">{t(`priority.${p}.label`)}</span>
              <span className="text-ink-muted"> · {t(`priority.${p}.hint`)}</span>
            </p>
            <Segmented
              label={t(`priority.${p}.label`)}
              options={options}
              value={levels[p]}
              onChange={(value) => onLevels({ ...levels, [p]: value })}
              className="w-full"
            />
          </li>
        ))}
      </ul>

      <label className="press flex min-h-11 cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-lg font-medium">{t("irrigatedTitle")}</span>
          <span className="text-sm text-ink-muted">{t("irrigatedHint")}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={irrigated}
          onChange={(event) => onIrrigated(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="relative h-8 w-14 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-field peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] after:absolute after:left-1 after:top-1 after:h-6 after:w-6 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:after:translate-x-6"
        />
      </label>
    </div>
  );
}
