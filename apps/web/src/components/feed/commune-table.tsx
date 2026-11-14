"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Confidence, CropOutlook, RiskLevel, Zone } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { RiskBadge } from "@/components/ui/badges";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";

export type SortKey = "name" | "area" | "risk" | "quality" | "confidence";
type Direction = "asc" | "desc";

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
const CONFIDENCE_ORDER: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
/** The first click on a column sorts in the order a buyer most likely wants. */
const FIRST_DIRECTION: Record<SortKey, Direction> = {
  name: "asc",
  area: "desc",
  risk: "asc",
  quality: "asc",
  confidence: "desc",
};

/** Quality warnings are the flags at medium or high level; low-level flags are only being watched. */
export function warningCount(outlook: CropOutlook): number {
  return outlook.quality.flags.filter((f) => f.level !== "low").length;
}

function sortValue(key: Exclude<SortKey, "name">, o: CropOutlook): number {
  switch (key) {
    case "area":
      return o.area_ha ?? -1;
    case "risk":
      return o.availability.score;
    case "quality":
      return warningCount(o) * 10 + RISK_ORDER[o.quality.level];
    case "confidence":
      return CONFIDENCE_ORDER[o.confidence];
  }
}

interface Row {
  zone: Zone;
  outlook: CropOutlook | undefined;
}

function sortRows(rows: Row[], key: SortKey, dir: Direction, locale: string): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    if (key === "name") return sign * x.zone.name.localeCompare(y.zone.name, locale);
    // Communes without data for this crop always go last.
    if (!x.outlook || !y.outlook) return (x.outlook ? 0 : 1) - (y.outlook ? 0 : 1);
    const diff = sortValue(key, x.outlook) - sortValue(key, y.outlook);
    return diff !== 0 ? sign * diff : x.zone.name.localeCompare(y.zone.name, locale);
  });
}

/**
 * The communes for one crop: a sortable table from md up, rows of name, area and risk on a phone.
 * Columns have fixed widths, so a risky commune changes the mark in its row, never the layout.
 */
export function CommuneTable({
  zones,
  outlookFor,
  cropName,
  selectedId,
  onSelect,
  ticked,
  onTick,
}: {
  zones: Zone[];
  outlookFor: (zone: Zone) => CropOutlook | undefined;
  cropName: string;
  selectedId: string | null;
  onSelect: (zone: Zone) => void;
  ticked: string[];
  onTick: (id: string) => void;
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
        className={`p-0 font-medium ${align === "right" ? "text-right" : "text-left"}`}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          className={`inline-flex min-h-11 w-full items-center gap-1 rounded-lg px-2 text-sm hover:text-ink ${
            align === "right" ? "justify-end" : ""
          } ${active ? "text-ink" : "text-ink-muted"}`}
        >
          {t(key)}
          <SortMark active={active} dir={sort.dir} />
        </button>
      </th>
    );
  };

  const tick = (zone: Zone) => (
    <Tick checked={ticked.includes(zone.id)} label={t("tick", { zone: zone.name })} onChange={() => onTick(zone.id)} />
  );

  return (
    <>
      {/* Laptop and tablet: the full table. */}
      <table className="hidden w-full table-fixed border-collapse md:table">
        <caption className="sr-only">{t("caption", { crop: cropName })}</caption>
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-24" />
          <col className="w-36" />
          <col className="w-28" />
          <col className="w-28" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="p-0 text-left text-sm font-medium text-ink-muted">
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
                className={`cursor-pointer border-b border-line ${selected ? "bg-surface-sunken" : "hover:bg-surface-sunken"}`}
              >
                <td className="py-1">{tick(zone)}</td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    aria-label={t("open", { zone: zone.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(zone);
                    }}
                    className={`min-h-11 w-full truncate rounded-lg text-left ${selected ? "font-semibold" : "font-medium"} hover:underline`}
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

      {/* Phone: one row per commune with name, area and risk. */}
      <ul className="md:hidden" aria-label={t("caption", { crop: cropName })}>
        {rows.map(({ zone, outlook }) => {
          const selected = zone.id === selectedId;
          return (
            <li key={zone.id} className="flex items-center gap-1 border-b border-line">
              {tick(zone)}
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(zone)}
                className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg py-2 pr-1 text-left"
              >
                <span className="min-w-0">
                  <span className={`block truncate ${selected ? "font-semibold" : "font-medium"}`}>{zone.name}</span>
                  <span className="text-sm tabular-nums text-ink-muted">{area(outlook)}</span>
                </span>
                {outlook ? (
                  <RiskBadge level={outlook.availability.level} />
                ) : (
                  <span className="text-sm text-ink-muted">{tf("noCropData")}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Tick({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label
      className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg"
      onClick={(event) => event.stopPropagation()}
    >
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="h-5 w-5 accent-field" />
    </label>
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

/** Quality: icon of the overall level plus the number of warnings, or "None". */
function Warnings({ outlook }: { outlook: CropOutlook }) {
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

/** The same three dots as the confidence badge, without its frame, so it fits a table cell. */
function ConfidenceMark({ confidence }: { confidence: Confidence }): ReactNode {
  const t = useTranslations("Confidence");
  const filled = CONFIDENCE_DOTS[confidence];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((dot) => (
          <span key={dot} className={`h-2 w-2 rounded-full ${dot <= filled ? "bg-field" : "bg-line"}`} />
        ))}
      </span>
      {t(confidence)}
    </span>
  );
}
