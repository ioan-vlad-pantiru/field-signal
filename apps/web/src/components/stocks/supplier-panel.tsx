"use client";

import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import {
  COUNTRIES,
  TARGET_DAYS,
  allocate,
  alternatives,
  rankCandidates,
  type PathId,
  type RowAssessment,
  type StocksScenario,
} from "@/lib/stocks";
import { Disclosure } from "@/components/ui/disclosure";
import { NoticeBar } from "@/components/ui/notice-bar";
import { CandidateCard } from "./candidate-card";

/** Cards shown before the rest fold into a disclosure. */
const VISIBLE = 6;

/** Supplier forecast for one ingredient: shortfall, recommended split, then the ranked countries. */
export function SupplierPanel({
  scenario,
  path,
  assessment,
}: {
  scenario: StocksScenario;
  path: PathId;
  assessment: RowAssessment;
}) {
  const t = useTranslations("Stocks");
  const locale = useAppLocale();
  const l = useLocalized();
  const tonnes = (value: number) => t("tonnes", { value: formatNumber(value, locale, 0) });
  const candidates = rankCandidates(scenario, assessment);
  const short = assessment.shortfall_t > 0;
  const allocation = short ? allocate(candidates, assessment.shortfall_t) : null;
  const alts = alternatives(scenario, path, assessment);
  const domain: [number, number] = [0, Math.max(1, ...candidates.map((c) => c.forecast.volume_t.high))];
  const card = (c: (typeof candidates)[number], i: number) => (
    <CandidateCard key={c.country} candidate={c} rank={i + 1} domain={domain} />
  );

  return (
    <section aria-labelledby="stocks-suppliers" className="flex flex-col gap-4">
      <div>
        <h2 id="stocks-suppliers" className="text-xl font-semibold tracking-tight">
          {t("supplyTitle", { name: l(assessment.row.name) })}
        </h2>
        <p className="mt-1 text-lg">
          {short
            ? t("shortfall", { tonnes: tonnes(assessment.shortfall_t), target: TARGET_DAYS })
            : t("noShortfall", { target: TARGET_DAYS })}
        </p>
      </div>

      {allocation && allocation.lines.length > 0 ? (
        <div className="rounded-2xl border border-field/40 bg-field-tint p-4">
          <h3 className="font-semibold">{t("allocationTitle")}</h3>
          <p className="mt-1 text-sm text-ink-muted">{t("allocationHint")}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {allocation.lines.map((line) => (
              <li
                key={line.country}
                className="rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium tabular-nums"
              >
                {t("allocationLine", {
                  country: l(COUNTRIES[line.country].name),
                  tonnes: tonnes(line.tonnes),
                  share: Math.round(line.share * 100),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {allocation?.lines.some((line) => COUNTRIES[line.country].lead_days > assessment.cover_days) ? (
        <NoticeBar>{t("bridge")}</NoticeBar>
      ) : null}
      {allocation && allocation.uncovered_t > 0 ? (
        <NoticeBar>{t("uncovered", { tonnes: tonnes(allocation.uncovered_t) })}</NoticeBar>
      ) : null}
      {allocation?.concentrated ? <NoticeBar>{t("concentrated")}</NoticeBar> : null}
      {alts.length > 0 ? (
        <NoticeBar tone="info">
          {t("alternatives", { list: alts.map((a) => l(a.row.name)).join(", ") })}
        </NoticeBar>
      ) : null}

      {candidates.length === 0 ? (
        <p className="text-ink-muted">{t("noCandidates")}</p>
      ) : (
        <>
          <h3 className="mt-2 text-lg font-semibold">{t("rankingTitle")}</h3>
          <ol className="grid gap-4 lg:grid-cols-2">{candidates.slice(0, VISIBLE).map(card)}</ol>
          {candidates.length > VISIBLE ? (
            <Disclosure summary={t("more", { count: candidates.length - VISIBLE })}>
              <ol start={VISIBLE + 1} className="grid gap-4 lg:grid-cols-2">
                {candidates.slice(VISIBLE).map((c, i) => card(c, VISIBLE + i))}
              </ol>
            </Disclosure>
          ) : null}
        </>
      )}
    </section>
  );
}
