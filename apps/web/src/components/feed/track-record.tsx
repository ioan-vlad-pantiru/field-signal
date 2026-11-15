"use client";

import { useTranslations } from "next-intl";
import type { Crop, Validation, ValidationYear } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { CropChip } from "@/components/ui/crop-chip";
import { CheckIcon, CrossIcon } from "@/components/ui/icons";

function byCrop(years: ValidationYear[]): [Crop, ValidationYear[]][] {
  const groups = new Map<Crop, ValidationYear[]>();
  for (const y of years) groups.set(y.crop, [...(groups.get(y.crop) ?? []), y]);
  return [...groups].map(([crop, list]) => [crop, [...list].sort((a, b) => a.season - b.season)]);
}

/** Seasons called right out of all seasons checked, for the one-line row. */
export function trackTotals(validation: Validation) {
  return { hits: validation.hits, total: validation.hits + validation.misses };
}

/** How the risk we would have given did against official yields, season by season; misses shown on purpose. */
export function TrackRecord({ validation }: { validation: Validation }) {
  const t = useTranslations("Feed.track");
  const tr = useTranslations("Risk");
  const tc = useTranslations("Crops");
  const l = useLocalized();
  const locale = useAppLocale();
  const { hits, total } = trackTotals(validation);
  const anomaly = (v: number) => `${v > 0 ? "+" : ""}${formatNumber(v, locale, 0)}%`;
  const describe = (y: ValidationYear) =>
    t("seasonLabel", {
      season: y.season,
      risk: tr(y.risk_level),
      anomaly: anomaly(y.yield_anomaly_pct),
      result: y.hit ? t("hit") : t("miss"),
    });

  return (
    <div className="flex flex-col gap-5">
      <p>
        <span className="font-display text-3xl font-semibold tabular-nums">{hits}</span>{" "}
        <span className="text-ink-muted">{t("summary", { total })}</span>
      </p>
      <p className="flex flex-wrap gap-x-4 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <CheckIcon size={14} className="text-status-good" /> {t("hit")}
        </span>
        <span className="inline-flex items-center gap-1">
          <CrossIcon size={14} className="text-status-bad" /> {t("miss")}
        </span>
      </p>
      <ul className="flex flex-col gap-4">
        {byCrop(validation.years).map(([crop, years]) => (
          <li key={crop}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <CropChip crop={crop} size="sm" />
              <span className="text-sm text-ink-muted">
                {t("cropSummary", { hits: years.filter((y) => y.hit).length, total: years.length })}
              </span>
            </div>
            <ol className="mt-2 flex flex-wrap gap-1.5" aria-label={tc(crop)}>
              {years.map((y) => (
                <li
                  key={y.season}
                  title={describe(y)}
                  className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-sm tabular-nums ${
                    y.hit ? "bg-surface-sunken" : "bg-status-bad-tint"
                  }`}
                >
                  <span className="sr-only">{describe(y)}</span>
                  <span aria-hidden="true">{y.season}</span>
                  {y.hit ? (
                    <CheckIcon size={14} className="text-status-good" />
                  ) : (
                    <CrossIcon size={14} className="text-status-bad" />
                  )}
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">{l(validation.method)}</p>
      <p className="text-sm text-ink-muted">{t("honest")}</p>
    </div>
  );
}
