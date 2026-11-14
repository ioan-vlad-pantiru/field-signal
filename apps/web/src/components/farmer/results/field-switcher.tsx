"use client";

import { useRef, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { Loaded } from "@/lib/api";
import type { FieldAnalysis } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { polygonAreaHa } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { verdict } from "@/lib/results";
import type { SubmittedField } from "../draft-field";
import { useFieldLabel } from "../steps/field-list";
import { useRotationName } from "./rotation-name";

/**
 * Several fields analysed together: one tab per field with its area and best rotation. The page
 * below shows the selected field's full results.
 */
export function FieldSwitcher({
  fields,
  results,
  selected,
  onSelect,
}: {
  fields: SubmittedField[];
  results: Loaded<FieldAnalysis>[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const t = useTranslations("Results.fields");
  const locale = useAppLocale();
  const label = useFieldLabel();
  const nameOf = useRotationName();
  const list = useRef<HTMLDivElement>(null);
  const totalHa = fields.reduce((sum, f) => sum + polygonAreaHa(f.boundary), 0);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (selected + step + fields.length) % fields.length;
    onSelect(next);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <nav aria-labelledby="field-switcher-title" className="no-print mb-6 border-b border-line pb-4">
      <p id="field-switcher-title" className="font-semibold">
        {t("title", { count: fields.length, ha: formatNumber(totalHa, locale, 0) })}
      </p>
      <div
        ref={list}
        role="tablist"
        aria-labelledby="field-switcher-title"
        onKeyDown={onKeyDown}
        className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:thin]"
      >
        {fields.map((field, i) => {
          const v = verdict(results[i].data.strategies);
          const active = i === selected;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(i)}
              className={`press flex min-h-11 w-56 shrink-0 flex-col items-start rounded-xl border px-3 py-2 text-left ${
                active ? "border-field bg-field-tint" : "border-line bg-surface hover:border-ink"
              }`}
            >
              <span className="w-full truncate font-semibold">{label(field, i)}</span>
              <span className="text-sm tabular-nums text-ink-muted">
                {t("area", { ha: formatNumber(polygonAreaHa(field.boundary), locale, 1) })}
              </span>
              <span className="mt-0.5 line-clamp-2 w-full text-sm">
                {v.kind === "keep" ? t("keep") : t("best", { name: nameOf(v.best) })}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
