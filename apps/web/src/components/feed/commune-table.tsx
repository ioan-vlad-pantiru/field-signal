"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CropOutlook, Zone } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { RiskBadge } from "@/components/ui/badges";
import { FIRST_DIRECTION, sortRows, type Direction, type SortKey } from "./commune-sort";
import { ConfidenceMark, Tick, Warnings } from "./commune-marks";

/**
 * Tablets and laptops: the communes for one crop as a sortable table. Columns have fixed widths,
 * so a risky commune changes the mark in its row, never the layout.
 */
export function CommuneTable({
  zones,
  outlookFor,
  cropName,
  selectedId,
  onSelect,
  ticked,
  onTick,
  className = "",
}: {
  zones: Zone[];
  outlookFor: (zone: Zone) => CropOutlook | undefined;
  cropName: string;
  selectedId: string | null;
  onSelect: (zone: Zone) => void;
  ticked: string[];
  onTick: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations("Feed.table");
  const tf = useTranslations("Feed");
  const locale = useAppLocale();
  const [sort, setSort] = useState<{ key: SortKey; dir: Direction }>({ key: "risk", dir: "asc" });
  const rows = sortRows(
    zones.map((zone) => ({ zone, outlook: outlookFor(zone) })),
    sort.key,
    sort.dir,
    locale,
  );
  const area = (o: CropOutlook | undefined) =>
    o?.area_ha != null ? t("areaValue", { ha: formatNumber(o.area_ha, locale, 0) }) : "—";

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: FIRST_DIRECTION[key] }));
  }

  const header = (key: SortKey, align: "left" | "right" = "left") => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
        className={`p-0 font-normal ${align === "right" ? "text-right" : "text-left"}`}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          className={`inline-flex min-h-tap w-full items-center gap-1 rounded-[var(--radius-sm)] px-2 text-sm hover:text-ink ${
            align === "right" ? "justify-end" : ""
          } ${active ? "font-semibold text-ink" : "text-ink-muted"}`}
        >
          {t(key)}
          <SortMark active={active} dir={sort.dir} />
        </button>
      </th>
    );
  };

  return (
    <div className={`overflow-hidden rounded-[var(--radius-lg)] bg-surface px-2 shadow-1 ${className}`}>
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{t("caption", { crop: cropName })}</caption>
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-24" />
          <col className="w-36" />
          <col className="w-32" />
          <col className="w-28" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="p-0">
              <span className="sr-only">{t("compare")}</span>
            </th>
            {header("name")}
            {header("area", "right")}
            {header("risk")}
            {header("quality")}
            {header("confidence")}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ zone, outlook }) => {
            const selected = zone.id === selectedId;
            return (
              <tr
                key={zone.id}
                onClick={() => onSelect(zone)}
                className={`cursor-pointer border-b border-line last:border-b-0 ${
                  selected ? "bg-field-soft" : "hover:bg-surface-sunken"
                }`}
              >
                <td className="py-1">
                  <Tick
                    checked={ticked.includes(zone.id)}
                    label={t("tick", { zone: zone.name })}
                    onChange={() => onTick(zone.id)}
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    aria-label={t("open", { zone: zone.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(zone);
                    }}
                    className="min-h-tap w-full truncate rounded-[var(--radius-sm)] text-left font-semibold hover:underline"
                  >
                    {zone.name}
                  </button>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{area(outlook)}</td>
                {outlook ? (
                  <>
                    <td className="px-2 py-1">
                      <RiskBadge level={outlook.availability.level} />
                    </td>
                    <td className="px-2 py-1">
                      <Warnings outlook={outlook} />
                    </td>
                    <td className="px-2 py-1">
                      <ConfidenceMark confidence={outlook.confidence} />
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="px-2 py-1 text-sm text-ink-muted">
                    {tf("noCropData")}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortMark({ active, dir }: { active: boolean; dir: Direction }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${active ? "" : "opacity-0"}`}
    >
      {dir === "asc" ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}
