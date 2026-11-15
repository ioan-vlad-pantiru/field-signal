"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { FieldAnalysis, LatLon } from "@/lib/contracts";
import type { DataOrigin } from "@/lib/api";
import { mainRisk, placeShifts, rankStrategies, replayYears, verdict as buildVerdict } from "@/lib/results";
import { RefreshIcon } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/info-tip";
import { SeasonLegend } from "@/components/ui/season-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { DemoBanner } from "@/components/ui/states";
import { SwipeDeck } from "@/components/ui/swipe-deck";
import { FieldPlan } from "./field-plan";
import { DataSheet } from "./results/data-sheet";
import { ResultsHeader } from "./results/results-header";
import { useRotationName } from "./results/rotation-name";
import { StrategyCard } from "./results/strategy-card";
import { StrategySheet } from "./results/strategy-sheet";
import { VerdictCard } from "./results/verdict";

/**
 * A clean one-page plan on paper: the site chrome goes (it lives in the layout, so it is hidden from
 * here while results are on screen) and the page uses the full sheet.
 */
const PRINT_CSS = `@media print {
  body > header, body > nav, body > footer { display: none !important; }
  main { max-width: none !important; padding: 0 !important; }
  .snap-deck { display: grid !important; grid-template-columns: repeat(3, 1fr) !important; overflow: visible !important; }
  @page { margin: 14mm; }
}`;

/**
 * One field's results: the field on the 3D map, the answer in one card, then the rotations as
 * cards (swipe on a phone, a row of three on a laptop). The card in view drives the map; tapping
 * one opens its full explanation. The data behind it is one tap from the verdict or any rotation.
 */
export function ResultsView({
  analysis,
  origin,
  boundary,
  parts = [],
  onBack,
  placeName = null,
  save,
  after,
  savedAt = null,
  onRerun,
}: {
  analysis: FieldAnalysis;
  origin: DataOrigin;
  /** The field the farmer chose, if any. */
  boundary: LatLon[] | null;
  /** Further pieces of the same field (parcels that do not touch). */
  parts?: LatLon[][];
  onBack: () => void;
  /** The place the farmer searched or chose; preferred over the API's commune and county. */
  placeName?: string | null;
  /** The "Save" header action. */
  save?: ReactNode;
  /** Shown after the rotations, such as the optimized plan card. */
  after?: ReactNode;
  /** When these results were saved in the account; null for a fresh run. */
  savedAt?: string | null;
  /** Run the analysis again (offered with saved results). */
  onRerun?: () => void;
}) {
  const t = useTranslations("Results");
  const ts = useTranslations("Status");
  const nameOf = useRotationName();
  const format = useFormatter();

  const ranked = useMemo(() => rankStrategies(analysis.strategies), [analysis.strategies]);
  const verdict = useMemo(() => buildVerdict(analysis.strategies), [analysis.strategies]);
  const risk = useMemo(() => mainRisk(analysis.strategies), [analysis.strategies]);
  const years = useMemo(() => replayYears(analysis.strategies), [analysis.strategies]);
  const shifts = useMemo(() => placeShifts(analysis.indicators), [analysis.indicators]);
  const [selectedId, setSelectedId] = useState(ranked[0].id);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const selected = ranked.find((s) => s.id === selectedId) ?? ranked[0];
  const selectedIndex = ranked.indexOf(selected);
  const sheet = ranked.find((s) => s.id === sheetId) ?? null;
  const weak = ranked.some((r) => r.replay.some((o) => o.evidence_level === "low"));

  return (
    <div className="flex flex-col gap-5 print:gap-3 print:text-[11pt]">
      <style>{PRINT_CSS}</style>
      <ResultsHeader analysis={analysis} boundary={boundary} parts={parts} placeName={placeName} onBack={onBack} save={save} />
      {analysis.mock ? <DemoBanner origin={origin} /> : null}
      {savedAt ? (
        <p className="no-print -mt-2 flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
          <span>{t("saved", { date: format.dateTime(new Date(savedAt), { dateStyle: "medium" }) })}</span>
          {onRerun ? (
            <button
              type="button"
              onClick={onRerun}
              className="press -mx-2 inline-flex min-h-tap items-center gap-1.5 rounded-pill px-2 font-semibold text-field hover:bg-surface-sunken"
            >
              <RefreshIcon size={16} />
              {t("rerun")}
            </button>
          ) : null}
        </p>
      ) : null}

      <section aria-label={t("planTitle")} className="-mx-gutter sm:mx-0">
        <p className="hidden font-semibold print:block">{nameOf(selected)}</p>
        <FieldPlan center={analysis.location.point} boundary={boundary} parts={parts} strategy={selected} />
      </section>

      <VerdictCard verdict={verdict} risk={risk} start={analysis.period_start} onData={() => setDataOpen(true)} />

      <section aria-labelledby="rotations-title" className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <h2 id="rotations-title" className="text-lg font-semibold">
            {t("rotations.title")}
          </h2>
          <InfoTip label={t("rotations.legend")}>
            <SeasonLegend
              labels={{
                good: ts("good"),
                watch: ts("watch"),
                bad: ts("bad"),
                no_data: ts("no_data"),
                ...(weak ? { lowEvidence: t("rotations.weakEvidence") } : {}),
              }}
            />
          </InfoTip>
        </div>
        <SwipeDeck
          label={t("rotations.title")}
          active={selectedIndex}
          onActive={(i) => setSelectedId(ranked[i].id)}
          dotLabel={(i) => t("rotations.dot", { n: i + 1, total: ranked.length })}
        >
          {ranked.map((strategy, i) => (
            <div key={strategy.id} className="rise h-full" style={{ "--i": i + 2 } as React.CSSProperties}>
              <StrategyCard
                strategy={strategy}
                years={years}
                start={analysis.period_start}
                isBest={i === 0}
                selected={strategy.id === selected.id}
                onOpen={() => {
                  setSelectedId(strategy.id);
                  setSheetId(strategy.id);
                }}
              />
            </div>
          ))}
        </SwipeDeck>
      </section>

      {after}

      <ul className="hidden flex-wrap gap-2 print:flex">
        {analysis.sources.map((s) => (
          <li key={s.dataset}>
            <SourceChip source={s} />
          </li>
        ))}
      </ul>

      <StrategySheet
        strategy={sheet}
        onClose={() => setSheetId(null)}
        onData={() => {
          setSheetId(null);
          setDataOpen(true);
        }}
      />
      <DataSheet open={dataOpen} onClose={() => setDataOpen(false)} analysis={analysis} shifts={shifts} />
    </div>
  );
}

/** The results' own shape while the 25 seasons load, so nothing jumps when they arrive. */
export function ResultsSkeleton() {
  const t = useTranslations("Results");
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton className="size-tap rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
      <p role="status" aria-live="polite" className="font-semibold">
        {t("loading")}
      </p>
      <Skeleton className="-mx-gutter h-[min(56svh,26rem)] rounded-none sm:rounded-[var(--radius-xl)] sm:mx-0 sm:h-[28rem]" />
      <Skeleton className="h-48 rounded-[var(--radius-xl)]" />
      <div className="-mx-gutter flex gap-3 overflow-hidden px-gutter lg:mx-0 lg:grid lg:grid-cols-3 lg:px-0">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-64 w-[86%] max-w-sm shrink-0 rounded-[var(--radius-xl)] sm:w-[60%] lg:w-auto lg:max-w-none" />
        ))}
      </div>
    </div>
  );
}
