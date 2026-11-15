"use client";

import { useState, type CSSProperties } from "react";
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
import { AlertIcon } from "@/components/ui/icons";
import { CandidateRow } from "./candidate-row";
import { HATCH_BAD, Runway, useFirstDelivery } from "./runway";

/** Countries shown before "More". */
const VISIBLE = 3;
/** Split segments in neutral steps; colour stays reserved for the uncovered tonnes. */
const SHADES = ["var(--ink)", "var(--ink-muted)", "color-mix(in srgb, var(--ink-muted) 55%, transparent)", "var(--line)"];

/**
 * The supplier sheet for one ingredient: its runway, the recommended split, the notes that qualify
 * it, then the ranked countries (the first three, the rest behind "More").
 */
export function SupplierPanel({
  scenario,
  path,
  assessment,
  asOf,
}: {
  scenario: StocksScenario;
  path: PathId;
  assessment: RowAssessment;
  asOf: Date;
}) {
  const t = useTranslations("Stocks");
  const locale = useAppLocale();
  const l = useLocalized();
  const [showAll, setShowAll] = useState(false);
  const tonnes = (value: number) => t("tonnes", { value: formatNumber(value, locale, 0) });
  const candidates = rankCandidates(scenario, assessment);
  const allocation = assessment.shortfall_t > 0 ? allocate(candidates, assessment.shortfall_t) : null;
  const lines = allocation?.lines ?? [];
  const uncovered = allocation?.uncovered_t ?? 0;
  const delivery = useFirstDelivery(lines);
  const alts = alternatives(scenario, path, assessment);
  const domain: [number, number] = [0, Math.max(1, ...candidates.map((c) => c.forecast.volume_t.high))];
  const shown = showAll ? candidates : candidates.slice(0, VISIBLE);
  const notes = [
    lines.some((line) => COUNTRIES[line.country].lead_days > assessment.cover_days) && t("bridge"),
    uncovered > 0 && t("uncovered", { tonnes: tonnes(uncovered) }),
    allocation?.concentrated && t("concentrated"),
    alts.length > 0 && t("alternatives", { list: alts.map((a) => l(a.row.name)).join(", ") }),
  ].filter((note): note is string => typeof note === "string");

  return (
    <div className="flex flex-col gap-8">
      <Runway asOf={asOf} cover={assessment.cover_days} delivery={delivery} />

      {lines.length > 0 || uncovered > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">{t("allocationTitle")}</h3>
          <div aria-hidden="true" className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {lines.map((line, i) => (
              <span key={line.country} className="grow-x" style={{ flexGrow: line.tonnes, background: SHADES[i], "--i": i } as CSSProperties} />
            ))}
            {uncovered > 0 ? <span className={HATCH_BAD} style={{ flexGrow: uncovered }} /> : null}
          </div>
          <ul className="mt-4 flex flex-col gap-2.5 text-sm">
            {lines.map((line, i) => (
              <li key={line.country} className="flex items-center gap-2.5">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: SHADES[i] }} />
                <span className="min-w-0 flex-1">{l(COUNTRIES[line.country].name)}</span>
                <span className="font-semibold tabular-nums">{tonnes(line.tonnes)}</span>
                <span className="w-10 text-right tabular-nums text-ink-muted">{t("share", { share: Math.round(line.share * 100) })}</span>
              </li>
            ))}
            {uncovered > 0 ? (
              <li className="flex items-center gap-2.5">
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${HATCH_BAD}`} />
                <span className="min-w-0 flex-1 text-ink-muted">{t("uncoveredShort")}</span>
                <span className="font-semibold tabular-nums">{tonnes(uncovered)}</span>
                <span className="w-10" />
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {notes.length > 0 ? (
        <ul className="flex flex-col gap-2.5 text-sm text-ink-muted">
          {notes.map((note) => (
            <li key={note} className="flex gap-2">
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {candidates.length === 0 ? (
        <p className="text-ink-muted">{t("noCandidates")}</p>
      ) : (
        <section>
          <h3 className="border-b border-line pb-2 text-sm font-semibold">{t("rankingTitle")}</h3>
          <ol className="divide-y divide-line">
            {shown.map((c, i) => (
              <CandidateRow key={c.country} candidate={c} rank={i + 1} domain={domain} />
            ))}
          </ol>
          {candidates.length > VISIBLE ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="press mt-1 min-h-tap text-sm font-semibold text-ink-muted hover:text-ink"
            >
              {showAll ? t("fewer") : t("more", { count: candidates.length - VISIBLE })}
            </button>
          ) : null}
        </section>
      )}
    </div>
  );
}
