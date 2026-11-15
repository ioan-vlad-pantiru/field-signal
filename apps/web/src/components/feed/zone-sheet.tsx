"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { CropOutlook, LatLon, RiskLevel } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { AgronomistBadge, RiskBadge } from "@/components/ui/badges";
import { buttonClass } from "@/components/ui/button";
import { FieldIcon } from "@/components/ui/icons";

/** One of the three outlooks: its name and level, then the details that explain it. Hairline, no fill. */
function Light({ title, level, children }: { title: string; level: RiskLevel; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <RiskBadge level={level} />
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="text-right font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Guidance under a medium or high availability risk: which rotations usually lower it, and a link that
 * opens the farmer screen pinned on this commune. Worded as guidance, not a computed number.
 */
function LowerRisk({ crop, centroid, place }: { crop: CropOutlook["crop"]; centroid?: LatLon; place?: string }) {
  const t = useTranslations("Feed.zone");
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-[var(--radius-md)] bg-surface-sunken p-3">
      <p className="font-semibold">{t("lowerRiskTitle")}</p>
      <p>{crop === "maize" ? t("lowerRiskMaize") : t("lowerRiskOther")}</p>
      <AgronomistBadge />
      {centroid ? (
        <Link
          href={{
            pathname: "/field",
            query: {
              lat: centroid.lat.toFixed(4),
              lon: centroid.lon.toFixed(4),
              ...(place ? { place } : {}),
            },
          }}
          className={buttonClass("primary", "md", "mt-1 w-fit")}
        >
          <FieldIcon size={18} />
          {t("compareHere")}
        </Link>
      ) : null}
    </div>
  );
}

export function ZoneDetails({
  outlook,
  centroid,
  place,
}: {
  outlook: CropOutlook;
  /** The zone's centroid; when given, the guidance block links to the farmer screen pinned here. */
  centroid?: LatLon;
  /** The commune's name, shown on the farmer screen as where the pin came from. */
  place?: string;
}) {
  const t = useTranslations("Feed.zone");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();
  const { availability, quality, impact } = outlook;
  const missing = "—";
  const n = (v: number | null | undefined, unit: string) =>
    v == null ? missing : `${formatNumber(v, locale, 0)} ${unit}`;
  const anomaly = availability.expected_yield_anomaly_pct;

  return (
    <div className="flex flex-col gap-5">
      <Light title={t("availability")} level={availability.level}>
        <Row label={t("riskScore")} value={`${formatNumber(availability.score, locale, 0)}/100`} />
        <Row
          label={t("yieldAnomaly")}
          value={
            anomaly
              ? t("anomalyRange", {
                  low: formatNumber(anomaly.low, locale, 0),
                  high: formatNumber(anomaly.high, locale, 0),
                })
              : missing
          }
        />
        {availability.drivers.length > 0 ? (
          <div>
            <p className="text-sm text-ink-muted">{t("drivers")}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {availability.drivers.map((d) => (
                // The label already states the value ("268 mm in 2025, normal 210 mm").
                <li key={d.code}>{l(d.label)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {availability.level !== "low" ? (
          <LowerRisk crop={outlook.crop} centroid={centroid} place={place} />
        ) : null}
      </Light>

      <Light title={t("quality")} level={quality.level}>
        {quality.flags.length === 0 ? (
          <p>{t("noFlags")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {quality.flags.map((flag) => (
              <li key={flag.code}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{l(flag.label)}</span>
                  <RiskBadge level={flag.level} />
                </div>
                <p className="mt-1 text-sm">
                  {t("flagDays", { observed: flag.days_observed, normal: formatNumber(flag.days_normal, locale) })}
                </p>
                <p className="text-sm text-ink-muted">{t("window", { window: l(flag.window) })}</p>
              </li>
            ))}
          </ul>
        )}
      </Light>

      <Light title={t("impact")} level={impact.level}>
        <Row label={t("waterDeficit")} value={n(impact.water_deficit_mm, "mm")} />
        <Row
          label={t("legumeShare")}
          value={impact.legume_share_pct == null ? missing : `${formatNumber(impact.legume_share_pct, locale)} %`}
        />
        <Row label={t("winterCover")} value={n(impact.winter_cover_days, unitLabel("days"))} />
        {impact.notes?.map((note, i) => (
          <p key={i} className="text-sm">
            {l(note)}
          </p>
        ))}
      </Light>

      <p className="text-sm text-ink-muted">{t("model", { version: outlook.model_version })}</p>
    </div>
  );
}
