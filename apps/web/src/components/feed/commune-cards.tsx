"use client";

import { useTranslations } from "next-intl";
import type { CropOutlook, Zone } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { RiskBadge } from "@/components/ui/badges";
import { sortRows, warningCount } from "./commune-sort";
import { Tick } from "./commune-marks";

/** Phones: one card per commune, safest first. Tap opens it; the box ticks it for the comparison. */
export function CommuneCards({
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
  const rows = sortRows(
    zones.map((zone) => ({ zone, outlook: outlookFor(zone) })),
    "risk",
    "asc",
    locale,
  );

  return (
    <ul className={`flex flex-col gap-2 ${className}`} aria-label={t("caption", { crop: cropName })}>
      {rows.map(({ zone, outlook }) => {
        const isTicked = ticked.includes(zone.id);
        const warnings = outlook ? warningCount(outlook) : 0;
        const detail = [
          outlook?.area_ha != null ? t("areaValue", { ha: formatNumber(outlook.area_ha, locale, 0) }) : null,
          warnings > 0 ? t("warnings", { count: warnings }) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li
            key={zone.id}
            className={`flex items-center rounded-[var(--radius-lg)] pl-1 shadow-1 ${
              isTicked ? "bg-field-soft" : "bg-surface"
            } ${zone.id === selectedId ? "ring-2 ring-field" : ""}`}
          >
            <Tick checked={isTicked} label={t("tick", { zone: zone.name })} onChange={() => onTick(zone.id)} />
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => onSelect(zone)}
              className="press flex min-h-16 min-w-0 flex-1 items-center justify-between gap-3 rounded-[var(--radius-lg)] py-2 pr-3 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{zone.name}</span>
                {detail ? <span className="block truncate text-sm tabular-nums text-ink-muted">{detail}</span> : null}
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
  );
}
