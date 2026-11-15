"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { FieldRequest } from "@/lib/contracts";
import { ChevronDownIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";

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

/** Levels back from an earlier request, e.g. after "Change field". */
export function levelsFrom(priorities: FieldRequest["priorities"] | undefined): PriorityLevels {
  if (!priorities) return DEFAULT_LEVELS;
  return Object.fromEntries(PRIORITIES.map((p) => [p, levelFor(priorities[p])])) as PriorityLevels;
}

export function weightsFrom(levels: PriorityLevels): Record<Priority, number> {
  return Object.fromEntries(PRIORITIES.map((p) => [p, LEVEL_WEIGHT[levels[p]]])) as Record<Priority, number>;
}

/**
 * What matters: one "matters most" switch per priority (off = it matters as usual), and the
 * three-level control behind "Fine-tune" for farmers who want "matters less" too. Every level the
 * API accepted before is still reachable.
 */
export function PrioritiesStep({
  levels,
  onLevels,
  irrigated,
  onIrrigated,
  fieldCount = 1,
}: {
  levels: PriorityLevels;
  onLevels: (levels: PriorityLevels) => void;
  irrigated: boolean;
  onIrrigated: (irrigated: boolean) => void;
  /** How many fields the switches apply to, for "The field is" / "The fields are irrigated". */
  fieldCount?: number;
}) {
  const t = useTranslations("Field.setup");
  const [fine, setFine] = useState(() => PRIORITIES.some((p) => levels[p] === "less"));
  const id = useId();
  const options = LEVELS.map((value) => ({ value, label: t(`level.${value}`) }));

  return (
    <div className="flex flex-col gap-1">
      {fine ? (
        <ul id={id} className="flex flex-col gap-3 py-1">
          {PRIORITIES.map((p) => (
            <li key={p} className="flex flex-col gap-1.5">
              <span className="font-semibold">{t(`priority.${p}`)}</span>
              <Segmented
                label={t(`priority.${p}`)}
                options={options}
                value={levels[p]}
                onChange={(value) => onLevels({ ...levels, [p]: value })}
                className="w-full"
              />
            </li>
          ))}
        </ul>
      ) : (
        <div id={id} className="divide-y divide-line">
          {PRIORITIES.map((p) => (
            <Toggle
              key={p}
              label={t(`priority.${p}`)}
              checked={levels[p] === "most"}
              onChange={(on) => onLevels({ ...levels, [p]: on ? "most" : "matters" })}
              className="py-1.5"
            />
          ))}
        </div>
      )}
      <button
        type="button"
        aria-expanded={fine}
        aria-controls={id}
        onClick={() => setFine((f) => !f)}
        className="press -ml-3 inline-flex min-h-tap w-fit items-center gap-1.5 rounded-pill px-3 text-sm font-semibold text-field hover:bg-surface-sunken"
      >
        {t(fine ? "simple" : "fineTune")}
        <ChevronDownIcon size={16} className={`transition-transform duration-[var(--duration-base)] ${fine ? "rotate-180" : ""}`} />
      </button>
      <div className="mt-2 border-t border-line pt-2">
        <Toggle label={t("irrigated", { count: fieldCount })} checked={irrigated} onChange={onIrrigated} />
      </div>
    </div>
  );
}
