"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import {
  COUNTRIES,
  allocate,
  alternatives,
  rankCandidates,
  type PathId,
  type RowAssessment,
  type StocksScenario,
} from "@/lib/stocks";
import { Button } from "@/components/ui/button";
import { NoticeBar } from "@/components/ui/notice-bar";
import { CandidateCard } from "./candidate-card";

/** Countries shown before "More". */
const VISIBLE = 3;

/**
 * The supplier sheet for one ingredient: the recommended split, the notices that qualify it, then
 * the ranked countries (the first three, the rest behind "More").
 */
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
  const [showAll, setShowAll] = useState(false);
  const tonnes = (value: number) => t("tonnes", { value: formatNumber(value, locale, 0) });
  const candidates = rankCandidates(scenario, assessment);
  const allocation = assessment.shortfall_t > 0 ? allocate(candidates, assessment.shortfall_t) : null;
  const alts = alternatives(scenario, path, assessment);
  const domain: [number, number] = [0, Math.max(1, ...candidates.map((c) => c.forecast.volume_t.high))];
  const shown = showAll ? candidates : candidates.slice(0, VISIBLE);

  return (
    <div className="flex flex-col gap-5">
      {allocation && allocation.lines.length > 0 ? (
        <section>
          <h3 className="font-semibold">{t("allocationTitle")}</h3>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] bg-field-soft">
            {allocation.lines.map((line) => (
              <li key={line.country} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span>{l(COUNTRIES[line.country].name)}</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{tonnes(line.tonnes)}</span>{" "}
                  <span className="text-ink-muted">{t("share", { share: Math.round(line.share * 100) })}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {allocation?.lines.some((line) => COUNTRIES[line.country].lead_days > assessment.cover_days) ? (
        <NoticeBar>{t("bridge")}</NoticeBar>
      ) : null}
      {allocation && allocation.uncovered_t > 0 ? (
        <NoticeBar>{t("uncovered", { tonnes: tonnes(allocation.uncovered_t) })}</NoticeBar>
      ) : null}
      {allocation?.concentrated ? <NoticeBar>{t("concentrated")}</NoticeBar> : null}
      {alts.length > 0 ? (
        <NoticeBar tone="info">{t("alternatives", { list: alts.map((a) => l(a.row.name)).join(", ") })}</NoticeBar>
      ) : null}

      {candidates.length === 0 ? (
        <p className="text-ink-muted">{t("noCandidates")}</p>
      ) : (
        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">{t("rankingTitle")}</h3>
          <ol className="flex flex-col gap-3">
            {shown.map((c, i) => (
              <CandidateCard key={c.country} candidate={c} rank={i + 1} domain={domain} />
            ))}
          </ol>
          {candidates.length > VISIBLE ? (
            <Button variant="secondary" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              {showAll ? t("fewer") : t("more", { count: candidates.length - VISIBLE })}
            </Button>
          ) : null}
        </section>
      )}
    </div>
  );
}
