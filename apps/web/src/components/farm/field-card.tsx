"use client";

import { useTranslations } from "next-intl";
import type { Parcel } from "@/lib/contracts";
import { areaHa, type FieldGroup } from "@/lib/farm";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { FieldThumb } from "@/components/fields/field-thumb";
import { Button } from "@/components/ui/button";

/** One field of the farm: its shape, a name to edit in place, size, why it was grouped, and "Show on map". */
export function FieldCard({
  field,
  parcels,
  colour,
  reason,
  onRename,
  onShow,
}: {
  field: FieldGroup;
  parcels: Parcel[];
  colour: string;
  reason?: string;
  onRename: (name: string) => void;
  onShow: () => void;
}) {
  const t = useTranslations("Farm.fields");
  const locale = useAppLocale();
  // Parcels of one field can lie kilometres apart; the largest one keeps the tile recognisable.
  const largest = parcels.reduce<Parcel | null>((best, p) => (!best || p.area_ha > best.area_ha ? p : best), null);

  return (
    <li className="flex gap-3 py-3">
      <span className="relative shrink-0">
        {largest ? <FieldThumb boundary={largest.boundary} /> : null}
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 size-4 rounded-pill ring-2 ring-surface"
          style={{ background: colour }}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <input
          value={field.name}
          aria-label={t("nameLabel")}
          onChange={(e) => onRename(e.target.value)}
          className="-ml-2 min-h-tap min-w-0 rounded-[var(--radius-sm)] bg-transparent px-2 text-lg font-semibold hover:bg-surface-sunken focus:bg-surface-sunken"
        />
        <p className="text-sm tabular-nums text-ink-muted">
          {t("size", { ha: formatNumber(areaHa(parcels), locale, 1), count: parcels.length })}
        </p>
        {reason ? <p className="mt-1 line-clamp-2 text-sm">{reason}</p> : null}
        <Button variant="quiet" onClick={onShow} className="-ml-4 mt-1 w-fit">
          {t("select")}
        </Button>
      </div>
    </li>
  );
}
