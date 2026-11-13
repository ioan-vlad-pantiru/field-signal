"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { CropOutlook, RiskLevel } from "@/lib/contracts";
import { formatNumber, formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { ConfidenceBadge, RiskBadge } from "@/components/ui/badges";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";

/** One traffic light: a big icon + level, then the details that explain it. */
function Light({ title, level, children }: { title: string; level: RiskLevel; children: ReactNode }) {
  const tone = RISK_TONE[level];
  const Icon = TONE_ICONS[tone];
  return (
    <section className={`rounded-2xl p-4 ${TONE_CLASSES[tone].soft}`}>
      <header className="mb-3 flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[tone].solid}`}>
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
      <span className="text-right font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function ZoneDetails({ outlook }: { outlook: CropOutlook }) {
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
        <p className="text-muted">{t("area", { ha: formatNumber(outlook.area_ha, locale, 0) })}</p>
      ) : null}

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
            <p className="text-sm text-muted">{t("drivers")}</p>
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
      </Light>

      <Light title={t("quality")} level={quality.level}>
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
                <p className="text-sm text-muted">{t("window", { window: l(flag.window) })}</p>
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

      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={outlook.confidence} />
        <span className="text-sm text-muted">{t("model", { version: outlook.model_version })}</span>
      </div>
    </div>
  );
}
