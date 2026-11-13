"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Crop, CropOutlook, RiskLevel, Zone } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { ConfidenceBadge, RiskBadge } from "@/components/ui/badges";
import { Card } from "@/components/ui/card";
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
function defaultPair(zones: Zone[], crop: Crop): [string, string] {
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
export function ZoneCompare({ zones, crop }: { zones: Zone[]; crop: Crop }) {
  const t = useTranslations("Feed.compare");
  const tc = useTranslations("Crops");
  const tz = useTranslations("Feed.zone");
  const locale = useAppLocale();
  const unitLabel = useUnitLabel();
  const [pair, setPair] = useState<{ crop: Crop; ids: [string, string] }>(() => ({
    crop,
    ids: defaultPair(zones, crop),
  }));
  // A new crop resets the pair to that crop's riskiest and safest zones.
  const [idA, idB] = pair.crop === crop ? pair.ids : defaultPair(zones, crop);
  const setIds = (ids: [string, string]) => setPair({ crop, ids });

  const zoneA = zones.find((z) => z.id === idA);
  const zoneB = zones.find((z) => z.id === idB);
  if (!zoneA || !zoneB || zones.length < 2) return null;
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
    <Card className="flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <ZonePicker label={t("zoneA")} zones={zones} value={idA} onChange={(id) => setIds([id, idB])} />
        <button
          type="button"
          onClick={() => setIds([idB, idA])}
          aria-label={t("swap")}
          className="press mb-0.5 inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-lg hover:border-field"
        >
          ⇄
        </button>
        <ZonePicker label={t("zoneB")} zones={zones} value={idB} onChange={(id) => setIds([idA, id])} />
      </div>

      <p className="rise rounded-2xl bg-field-tint px-4 py-3 font-medium" aria-live="polite" key={`${idA}-${idB}-${crop}`}>
        {idA === idB
          ? t("sameZone")
          : t("summary", {
              crop: tc(crop).toLocaleLowerCase(locale),
              a: zoneA.name,
              b: zoneB.name,
              winsA,
              winsB,
              total: scored.length,
            })}
      </p>

      {/* One measure per row: its name on top, the two zones side by side (fits 390 px). */}
      <div className="overflow-hidden rounded-2xl border border-line">
        <div className="grid grid-cols-2 bg-surface-sunken" aria-hidden="true">
          <p className="truncate px-3 py-2 font-semibold">{zoneA.name}</p>
          <p className="truncate border-l border-line px-3 py-2 font-semibold">{zoneB.name}</p>
        </div>
        <ul aria-label={t("caption", { a: zoneA.name, b: zoneB.name, crop: tc(crop) })}>
          {rows.map((row, index) => (
            <li key={row.key} className="rise border-t border-line" style={{ "--i": index } as React.CSSProperties}>
              <p className="px-3 pt-2 text-sm font-medium text-ink-muted">{row.label}</p>
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
            <p className="px-3 pt-2 text-sm font-medium text-ink-muted">{t("confidence")}</p>
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
      <p className="text-sm text-ink-muted">{t("note")}</p>
    </Card>
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
      className={`flex min-w-0 flex-col gap-1 px-3 pb-2 pt-1 transition-colors ${wins ? "bg-field-tint" : ""} ${
        divider ? "border-l border-line" : ""
      }`}
    >
      <span className="sr-only">{zone}:</span>
      {typeof children === "string" ? (
        <span className="font-mono tabular-nums">{children}</span>
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

function ZonePicker({
  label,
  zones,
  value,
  onChange,
}: {
  label: string;
  zones: Zone[];
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm text-ink-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="press min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 font-medium hover:border-field"
      >
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </select>
    </div>
  );
}
