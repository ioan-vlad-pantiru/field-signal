"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Crop, CropOutlook, RiskLevel, Zone } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { ConfidenceBadge, RiskBadge } from "@/components/ui/badges";
import { CheckIcon } from "@/components/ui/icons";

type Side = "a" | "b";

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/** Which side is better on one measure, or null when it is a tie or a value is missing. */
function better(a: number | null | undefined, b: number | null | undefined, higherIsBetter: boolean): Side | null {
  if (a == null || b == null || a === b) return null;
  return (a > b) === higherIsBetter ? "a" : "b";
}

interface Row {
  key: string;
  label: string;
  a: ReactNode;
  b: ReactNode;
  winner: Side | null;
}

/** Defaults to the riskiest and the safest zone for the crop: the comparison a buyer starts from. */
export function defaultPair(zones: Zone[], crop: Crop): [string, string] {
  const scored = zones
    .map((z) => ({ id: z.id, score: z.crops.find((c) => c.crop === crop)?.availability.score }))
    .filter((z): z is { id: string; score: number } => z.score != null)
    .sort((x, y) => y.score - x.score);
  const first = scored[0]?.id ?? zones[0]?.id ?? "";
  const last = scored.at(-1)?.id ?? zones[1]?.id ?? first;
  return [first, last === first ? (zones.find((z) => z.id !== first)?.id ?? first) : last];
}

/**
 * SPACE2FEED question 3: how do two supply zones compare on availability, quality and water?
 * Every row marks the better zone with an icon and a word, never colour alone.
 */
export function ZoneCompare({ zones, crop, ids }: { zones: Zone[]; crop: Crop; ids: [string, string] }) {
  const t = useTranslations("Feed.compare");
  const l = useLocalized();
  const tc = useTranslations("Crops");
  const tz = useTranslations("Feed.zone");
  const locale = useAppLocale();
  const unitLabel = useUnitLabel();
  const [idA, idB] = ids;

  const zoneA = zones.find((z) => z.id === idA);
  const zoneB = zones.find((z) => z.id === idB);
  if (!zoneA || !zoneB || idA === idB) return null;
  const a = zoneA.crops.find((c) => c.crop === crop);
  const b = zoneB.crops.find((c) => c.crop === crop);

  const n = (v: number | null | undefined, digits = 0) => (v == null ? "—" : formatNumber(v, locale, digits));
  const mid = (o: CropOutlook | undefined) => o?.availability.expected_yield_anomaly_pct?.mid;
  const anomaly = (o: CropOutlook | undefined) => {
    const r = o?.availability.expected_yield_anomaly_pct;
    return r ? t("anomaly", { mid: n(r.mid), low: n(r.low), high: n(r.high) }) : "—";
  };
  const flags = (o: CropOutlook | undefined) =>
    o && o.quality.flags.length > 0 ? (
      <span className="flex flex-col gap-0.5">
        <RiskBadge level={o.quality.level} />
        {o.quality.flags.map((f) => (
          <span key={f.code} className="text-xs text-ink-muted">
            <span className="font-medium text-ink">{l(f.label)}:</span>{" "}
            {t("flagDays", { observed: f.days_observed, normal: n(f.days_normal, 1) })}
          </span>
        ))}
      </span>
    ) : o ? (
      <RiskBadge level={o.quality.level} />
    ) : (
      "—"
    );

  const rows: Row[] = [
    {
      key: "risk",
      label: t("supplyRisk"),
      a: a ? <RiskBadge level={a.availability.level} /> : "—",
      b: b ? <RiskBadge level={b.availability.level} /> : "—",
      winner: better(a?.availability.score, b?.availability.score, false),
    },
    {
      key: "score",
      label: t("riskScore"),
      a: a ? `${n(a.availability.score)}/100` : "—",
      b: b ? `${n(b.availability.score)}/100` : "—",
      winner: better(a?.availability.score, b?.availability.score, false),
    },
    {
      key: "anomaly",
      label: tz("yieldAnomaly"),
      a: anomaly(a),
      b: anomaly(b),
      winner: better(mid(a), mid(b), true),
    },
    {
      key: "area",
      label: t("area"),
      a: `${n(a?.area_ha)} ha`,
      b: `${n(b?.area_ha)} ha`,
      winner: better(a?.area_ha, b?.area_ha, true),
    },
    {
      key: "quality",
      label: tz("quality"),
      a: flags(a),
      b: flags(b),
      winner: better(a && RISK_ORDER[a.quality.level], b && RISK_ORDER[b.quality.level], false),
    },
    {
      key: "water",
      label: tz("waterDeficit"),
      a: `${n(a?.impact.water_deficit_mm)} mm`,
      b: `${n(b?.impact.water_deficit_mm)} mm`,
      winner: better(a?.impact.water_deficit_mm, b?.impact.water_deficit_mm, false),
    },
    {
      key: "legumes",
      label: tz("legumeShare"),
      a: `${n(a?.impact.legume_share_pct, 1)} %`,
      b: `${n(b?.impact.legume_share_pct, 1)} %`,
      winner: better(a?.impact.legume_share_pct, b?.impact.legume_share_pct, true),
    },
    {
      key: "cover",
      label: tz("winterCover"),
      a: `${n(a?.impact.winter_cover_days)} ${unitLabel("days")}`,
      b: `${n(b?.impact.winter_cover_days)} ${unitLabel("days")}`,
      winner: better(a?.impact.winter_cover_days, b?.impact.winter_cover_days, true),
    },
  ];
  // "Risk" and "risk score" are the same measure shown two ways: count it once.
  const scored = rows.filter((r) => r.key !== "score");
  const winsA = scored.filter((r) => r.winner === "a").length;
  const winsB = scored.filter((r) => r.winner === "b").length;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[65ch] font-medium" aria-live="polite">
        {t("summary", {
          crop: tc(crop).toLocaleLowerCase(locale),
          a: zoneA.name,
          b: zoneB.name,
          winsA,
          winsB,
          total: scored.length,
        })}
      </p>

      {/* One measure per row: its name on top, the two communes side by side (fits 390 px). */}
      <div className="border-y border-line">
        <div className="grid grid-cols-2" aria-hidden="true">
          <p className="min-w-0 break-words px-3 py-2 font-semibold">{zoneA.name}</p>
          <p className="min-w-0 break-words border-l border-line px-3 py-2 font-semibold">{zoneB.name}</p>
        </div>
        <ul aria-label={t("caption", { a: zoneA.name, b: zoneB.name, crop: tc(crop) })}>
          {rows.map((row) => (
            <li key={row.key} className="border-t border-line">
              <p className="px-3 pt-2 text-sm text-ink-muted">{row.label}</p>
              <div className="grid grid-cols-2">
                <Cell zone={zoneA.name} wins={row.winner === "a"} betterLabel={t("better")}>
                  {row.a}
                </Cell>
                <Cell zone={zoneB.name} wins={row.winner === "b"} betterLabel={t("better")} divider>
                  {row.b}
                </Cell>
              </div>
            </li>
          ))}
          <li className="border-t border-line">
            <p className="px-3 pt-2 text-sm text-ink-muted">{t("confidence")}</p>
            <div className="grid grid-cols-2">
              <Cell zone={zoneA.name} wins={false} betterLabel={t("better")}>
                {a ? <ConfidenceBadge confidence={a.confidence} /> : "—"}
              </Cell>
              <Cell zone={zoneB.name} wins={false} betterLabel={t("better")} divider>
                {b ? <ConfidenceBadge confidence={b.confidence} /> : "—"}
              </Cell>
            </div>
          </li>
        </ul>
      </div>
      <p className="max-w-[65ch] text-sm text-ink-muted">{t("note")}</p>
    </div>
  );
}

function Cell({
  zone,
  wins,
  betterLabel,
  divider = false,
  children,
}: {
  zone: string;
  wins: boolean;
  betterLabel: string;
  divider?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 px-3 pb-2 pt-1 ${divider ? "border-l border-line" : ""}`}
    >
      <span className="sr-only">{zone}:</span>
      {typeof children === "string" ? (
        <span className="tabular-nums">{children}</span>
      ) : (
        children
      )}
      {wins ? (
        <span className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-field">
          <CheckIcon size={14} />
          {betterLabel}
        </span>
      ) : null}
    </div>
  );
}
