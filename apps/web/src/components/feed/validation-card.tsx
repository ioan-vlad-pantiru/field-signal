"use client";

import { useTranslations } from "next-intl";
import type { Crop, Validation, ValidationYear } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { CropChip } from "@/components/ui/crop-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { CheckIcon, CrossIcon } from "@/components/ui/icons";

function byCrop(years: ValidationYear[]): [Crop, ValidationYear[]][] {
  const groups = new Map<Crop, ValidationYear[]>();
  for (const y of years) groups.set(y.crop, [...(groups.get(y.crop) ?? []), y]);
  return [...groups].map(([crop, list]) => [crop, [...list].sort((a, b) => a.season - b.season)]);
}

/** How the risk we would have given did against official yields; misses are shown on purpose. */
export function ValidationCard({ validation }: { validation: Validation | null | undefined }) {
  const t = useTranslations("FeedExtra.validation");
  const tr = useTranslations("Risk");
  const tc = useTranslations("Crops");
  const l = useLocalized();
  const locale = useAppLocale();
  if (!validation || validation.years.length === 0) return null;

  const total = validation.hits + validation.misses;
  const anomaly = (v: number) => `${v > 0 ? "+" : ""}${formatNumber(v, locale, 0)}%`;
  const describe = (y: ValidationYear) =>
    t("seasonLabel", {
      season: y.season,
      risk: tr(y.risk_level),
      anomaly: anomaly(y.yield_anomaly_pct),
      result: y.hit ? t("hit") : t("miss"),
    });
  const groups = byCrop(validation.years);

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
      <p className="mt-1 max-w-[65ch] text-ink-muted">{l(validation.method)}</p>

      <p className="mt-4 text-lg">
        <span className="text-2xl font-semibold tabular-nums">{validation.hits}</span>{" "}
        {t("summary", { hits: validation.hits, total })}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-4 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <CheckIcon size={14} className="text-status-good" /> {t("hit")}
        </span>
        <span className="inline-flex items-center gap-1">
          <CrossIcon size={14} className="text-status-bad" /> {t("miss")}
        </span>
      </p>

      <ul className="mt-4 flex flex-col gap-4">
        {groups.map(([crop, years]) => {
          const hits = years.filter((y) => y.hit).length;
          return (
            <li key={crop}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <CropChip crop={crop} size="sm" />
                <span className="text-sm text-ink-muted">{t("cropSummary", { hits, total: years.length })}</span>
              </div>
              <ol className="mt-2 flex flex-wrap gap-1.5" aria-label={tc(crop)}>
                {years.map((y) => (
                  <li
                    key={y.season}
                    title={describe(y)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm tabular-nums ${
                      y.hit ? "border-line" : "border-status-bad bg-status-bad-tint"
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
          );
        })}
      </ul>

      <p className="mt-4 max-w-[65ch] text-ink-muted">{t("honest")}</p>

      <Disclosure summary={t("tableTitle")} className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <caption className="sr-only">{t("tableTitle")}</caption>
            <thead className="text-ink-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">{t("colCrop")}</th>
                <th scope="col" className="py-1 pr-3 font-medium">{t("colSeason")}</th>
                <th scope="col" className="py-1 pr-3 font-medium">{t("colRisk")}</th>
                <th scope="col" className="py-1 pr-3 font-medium">{t("colYield")}</th>
                <th scope="col" className="py-1 font-medium">{t("colResult")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {groups.flatMap(([crop, years]) =>
                years.map((y) => (
                  <tr key={`${crop}-${y.season}`} className="border-t border-line">
                    <td className="py-1.5 pr-3">{tc(crop)}</td>
                    <td className="py-1.5 pr-3">{y.season}</td>
                    <td className="py-1.5 pr-3">{tr(y.risk_level)}</td>
                    <td className="py-1.5 pr-3">{anomaly(y.yield_anomaly_pct)}</td>
                    <td className="py-1.5">{y.hit ? t("hit") : t("miss")}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </section>
  );
}
