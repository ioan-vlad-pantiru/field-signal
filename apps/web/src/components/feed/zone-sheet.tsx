"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { CropOutlook, LatLon, RiskLevel } from "@/lib/contracts";
import { formatNumber, formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { AgronomistBadge, ConfidenceBadge, RiskBadge } from "@/components/ui/badges";
import { FieldIcon } from "@/components/ui/icons";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";

/** One traffic light: a big icon + level, then the details that explain it. */
function Light({
  title,
  level,
  index,
  children,
}: {
  title: string;
  level: RiskLevel;
  index: number;
  children: ReactNode;
}) {
  const tone = RISK_TONE[level];
  const Icon = TONE_ICONS[tone];
  return (
    <section
      className={`rise rounded-[20px] p-4 ${TONE_CLASSES[tone].soft}`}
      style={{ "--i": index + 2 } as React.CSSProperties}
    >
      <header className="mb-3 flex items-center gap-3">
        <span
          className={`cell-in flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[tone].solid}`}
          style={{ "--row": index + 2 } as React.CSSProperties}
        >
          <Icon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{title}</h3>
          <RiskBadge level={level} />
        </div>
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="text-right font-mono font-semibold tabular-nums">{value}</span>
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
    <div className="mt-1 flex flex-col gap-2 rounded-xl bg-surface p-3">
      <p className="font-medium">{t("lowerRiskTitle")}</p>
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
          className="press mt-1 inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-field px-4 font-semibold text-on-field hover:bg-field-strong"
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
    <div className="flex flex-col gap-3">
      {outlook.area_ha != null ? (
        <p className="text-ink-muted">{t("area", { ha: formatNumber(outlook.area_ha, locale, 0) })}</p>
      ) : null}

      <Light title={t("availability")} level={availability.level} index={0}>
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
                <li key={d.code} className="flex justify-between gap-3">
                  <span>{l(d.label)}</span>
                  {d.value != null ? (
                    <span className="tabular-nums">{formatQuantity(d.value, d.unit, locale, unitLabel)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {availability.level !== "low" ? (
          <LowerRisk crop={outlook.crop} centroid={centroid} place={place} />
        ) : null}
      </Light>

      <Light title={t("quality")} level={quality.level} index={1}>
        {quality.flags.length === 0 ? (
          <p>{t("noFlags")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {quality.flags.map((flag) => (
              <li key={flag.code} className="rounded-xl bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{l(flag.label)}</span>
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

      <Light title={t("impact")} level={impact.level} index={2}>
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

      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={outlook.confidence} />
        <span className="text-sm text-ink-muted">{t("model", { version: outlook.model_version })}</span>
      </div>
    </div>
  );
}
