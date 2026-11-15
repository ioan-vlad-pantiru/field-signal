"use client";

import { useTranslations } from "next-intl";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
import { fieldAreaHa } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import type { DraftField } from "../draft-field";

/** "Field 2 · Aiud", or the farmer's own name for a field from My fields. */
export function useFieldLabel() {
  const t = useTranslations("Field.multi");
  return (field: Pick<DraftField, "name" | "place">, index: number) =>
    field.name ?? (field.place ? t("fieldNear", { n: index + 1, place: field.place }) : t("fieldN", { n: index + 1 }));
}

/** The fields already kept for this analysis, above the step being edited. */
export function FieldList({
  fields,
  onEdit,
  onRemove,
}: {
  fields: DraftField[];
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations("Field.multi");
  const crops = useTranslations("CropsShort");
  const locale = useAppLocale();
  const label = useFieldLabel();
  const totalHa = fields.reduce((sum, f) => sum + fieldAreaHa(f), 0);

  return (
    <section aria-labelledby="kept-fields" className="rounded-2xl bg-surface-sunken p-3">
      <h2 id="kept-fields" className="px-1 font-semibold">
        {t("listTitle", { count: fields.length, ha: formatNumber(totalHa, locale, 0) })}
      </h2>
      <ul className="mt-1 divide-y divide-line">
        {fields.map((field, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 pl-1">
            <div className="min-w-0">
              <p className="break-words font-semibold">
                {label(field, i)} <span className="font-normal tabular-nums text-ink-muted">· {t("area", { ha: formatNumber(fieldAreaHa(field), locale, 1) })}</span>
              </p>
              <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                <span className="flex gap-0.5" aria-hidden="true">
                  {field.rotation.map((crop, j) => (
                    <span key={j} className="size-2 rounded-full" style={{ background: CROP_COLORS[crop] }} />
                  ))}
                </span>
                {field.rotation.map((crop) => crops(crop)).join(" → ")}
              </p>
            </div>
            <div className="flex">
              <button
                type="button"
                onClick={() => onEdit(i)}
                className="press min-h-tap rounded-pill px-3 font-semibold text-field hover:bg-surface"
                aria-label={t("editLabel", { field: label(field, i) })}
              >
                {t("edit")}
              </button>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="press min-h-tap rounded-pill px-3 font-semibold text-ink-muted hover:bg-surface hover:text-ink"
                aria-label={t("removeLabel", { field: label(field, i) })}
              >
                {t("remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
