"use client";

import { useTranslations } from "next-intl";
import type { SoilProfile } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { SourceChip } from "@/components/ui/source-chip";

export function SoilCard({ soil }: { soil: SoilProfile }) {
  const t = useTranslations("Results.soil");
  const locale = useAppLocale();
  const l = useLocalized();
  const value = (v: number | null | undefined, unit = "") =>
    v == null ? "—" : `${formatNumber(v, locale)}${unit}`;

  const texture = soil.texture_class ? l(soil.texture_class) : "—";
  const mix =
    soil.clay_pct != null && soil.sand_pct != null
      ? t("mix", {
          clay: formatNumber(soil.clay_pct, locale, 0),
          sand: formatNumber(soil.sand_pct, locale, 0),
          silt: formatNumber(soil.silt_pct ?? 100 - soil.clay_pct - soil.sand_pct, locale, 0),
        })
      : null;

  const rows = [
    { key: "carbon", value: value(soil.soc_g_per_kg, " g/kg") },
    { key: "ph", value: value(soil.ph_h2o) },
    { key: "texture", value: texture, detail: mix },
  ] as const;

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">{t("title")}</h3>
        <p className="text-sm text-muted">{t("depth", { depth: soil.depth ?? "0-30cm" })}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-start gap-x-2 rounded-xl bg-surface-muted p-3">
            <p className="min-w-0 flex-1 text-sm text-muted">{t(`${row.key}.label`)}</p>
            <InfoTip label={t("whatIs", { term: t(`${row.key}.label`) })}>{t(`${row.key}.help`)}</InfoTip>
            <p className="basis-full text-xl font-semibold">
              {row.value}
              {"detail" in row && row.detail ? (
                <span className="block text-sm font-normal text-muted">{row.detail}</span>
              ) : null}
            </p>
          </div>
        ))}
      </div>
      <SourceChip source={soil.source} />
    </Card>
  );
}
