"use client";

import { useTranslations } from "next-intl";
import type { Loaded } from "@/lib/api";
import type { FieldAnalysis } from "@/lib/contracts";
import { verdict } from "@/lib/results";
import { Chip, ChipRow } from "@/components/ui/chip";
import { GridIcon } from "@/components/ui/icons";
import type { SubmittedField } from "../draft-field";
import { useFieldLabel } from "../steps/field-list";

export const ALL_FIELDS = -1;

/** Several fields analysed together: "All fields" first, then one chip per field. */
export function FieldSwitcher({
  fields,
  results,
  selected,
  onSelect,
}: {
  fields: SubmittedField[];
  results: Loaded<FieldAnalysis>[];
  /** The field shown, or `ALL_FIELDS` for the overview of every field. */
  selected: number;
  onSelect: (index: number) => void;
}) {
  const t = useTranslations("Results.fields");
  const label = useFieldLabel();
  return (
    <nav aria-label={t("label")} className="no-print">
      <ChipRow label={t("label")}>
        <Chip selected={selected === ALL_FIELDS} onClick={() => onSelect(ALL_FIELDS)}>
          <GridIcon size={16} />
          {t("all")}
        </Chip>
        {fields.map((field, i) => {
          const better = verdict(results[i].data.strategies).kind === "fewer";
          return (
            <Chip key={i} selected={i === selected} onClick={() => onSelect(i)} className="max-w-56">
              {better ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-field" /> : null}
              <span className="truncate">{label(field, i)}</span>
            </Chip>
          );
        })}
      </ChipRow>
    </nav>
  );
}
