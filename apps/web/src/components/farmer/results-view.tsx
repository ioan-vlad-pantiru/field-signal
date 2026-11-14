"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { FieldAnalysis, LatLon } from "@/lib/contracts";
import type { DataOrigin } from "@/lib/api";
import { placeShifts, rankStrategies, replayYears, verdict as buildVerdict } from "@/lib/results";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { DemoBanner } from "@/components/ui/states";
import { FieldPlan } from "./field-plan";
import { Evidence } from "./results/evidence";
import { ResultsHeader } from "./results/results-header";
import { Rotations } from "./results/rotations";
import { ShiftList } from "./results/shift";
import { LAPTOP, useMediaQuery } from "./results/use-media-query";
import { useRotationName } from "./results/rotation-name";
import { Verdict } from "./results/verdict";

/**
 * A clean one-page plan on paper: the site chrome goes (it lives in the layout, so it is hidden from
 * here while results are on screen) and the page uses the full sheet.
 */
const PRINT_CSS = `@media print {
  body > header, body > nav, body > footer { display: none !important; }
  main { max-width: none !important; padding: 0 !important; }
  @page { margin: 14mm; }
}`;

type DetailTab = "rotations" | "shift" | "evidence";

/**
 * One field's results, map first: the selected rotation on the field, then the verdict, then one
 * detail at a time (rotations compared, what changed at this place, evidence). One selected
 * rotation drives the map and the comparison.
 */
export function ResultsView({
  analysis,
  origin,
  boundary,
  onBack,
  placeName = null,
  save,
}: {
  analysis: FieldAnalysis;
  origin: DataOrigin;
  /** The field the farmer drew, if any; the field plan fills it with hexagons. */
  boundary: LatLon[] | null;
  onBack: () => void;
  /** The place the farmer searched or drew at; preferred over the API's commune and county. */
  placeName?: string | null;
  /** "Save field" control for the header. */
  save?: ReactNode;
}) {
  const t = useTranslations("Results");
  const nameOf = useRotationName();
  const laptop = useMediaQuery(LAPTOP);

  const ranked = useMemo(() => rankStrategies(analysis.strategies), [analysis.strategies]);
  const verdict = useMemo(() => buildVerdict(analysis.strategies), [analysis.strategies]);
  const years = useMemo(() => replayYears(analysis.strategies), [analysis.strategies]);
  const shifts = useMemo(() => placeShifts(analysis.indicators), [analysis.indicators]);
  const [selectedId, setSelectedId] = useState(ranked[0].id);
  const selected = ranked.find((s) => s.id === selectedId) ?? ranked[0];

  const tabs: DetailTab[] = ["rotations", ...(shifts.length > 0 ? (["shift"] as const) : []), "evidence"];
  const [tab, setTab] = useState<DetailTab>("rotations");
  const start = years[0] ?? analysis.period_start;
  const end = years.at(-1) ?? analysis.period_end;

  return (
    <div className="flex flex-col print:text-[11pt]">
      <style>{PRINT_CSS}</style>
      {analysis.mock ? <DemoBanner origin={origin} /> : null}

      <div className={analysis.mock ? "mt-6" : ""}>
        <ResultsHeader analysis={analysis} boundary={boundary} placeName={placeName} onBack={onBack} save={save} />
      </div>

      {/* The map first: the selected rotation laid out on the field, season by season. */}
      <section aria-label={t("planTitle")} className="mt-6 flex flex-col gap-4 print:mt-4">
        <div className="no-print flex flex-wrap items-end justify-between gap-3">
          {/* Names are too long for a segmented control on a phone; a native select fits them. */}
          <div className="hidden sm:block">
            <Segmented
              label={t("planRotation")}
              value={selected.id}
              onChange={setSelectedId}
              options={ranked.map((s) => ({ value: s.id, label: nameOf(s) }))}
            />
          </div>
          <label className="flex w-full flex-col gap-1 sm:hidden">
            <span className="text-sm text-ink-muted">{t("planRotation")}</span>
            <select
              value={selected.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="min-h-11 rounded-xl border border-line bg-surface px-3 font-medium text-ink"
            >
              {ranked.map((s) => (
                <option key={s.id} value={s.id}>
                  {nameOf(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hidden font-semibold print:block">{nameOf(selected)}</p>
        <FieldPlan center={analysis.location.point} boundary={boundary} strategy={selected} />
        <ul className="hidden flex-wrap gap-2 print:flex">
          {analysis.sources.map((s) => (
            <li key={s.dataset}>
              <SourceChip source={s} />
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-10 border-t border-line pt-8 print:mt-4">
        <Verdict verdict={verdict} start={analysis.period_start} />
      </div>

      {/* Details one at a time, so the page stays short. */}
      <div className="no-print mt-10">
        <div role="tablist" aria-label={t("nav.label")} className="flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
              className={`press -mb-px min-h-12 shrink-0 border-b-2 px-3 font-medium ${
                tab === id ? "border-field text-ink" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t(`nav.${id}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
          {tab === "rotations" ? (
            <>
              <p className="mb-6 max-w-[65ch] text-ink-muted">
                {t(laptop ? "rotations.hint" : "rotations.hintPhone", { start, end })}
              </p>
              <Rotations
                ranked={ranked}
                years={years}
                start={analysis.period_start}
                selectedId={selected.id}
                onSelect={setSelectedId}
                laptop={laptop}
              />
            </>
          ) : null}
          {tab === "shift" ? (
            <>
              <p className="mb-6 max-w-[65ch] text-ink-muted">{t("shift.hint")}</p>
              <ShiftList shifts={shifts} />
            </>
          ) : null}
          {tab === "evidence" ? (
            <>
              <p className="mb-6 max-w-[65ch] text-ink-muted">{t("evidence.hint")}</p>
              <Evidence analysis={analysis} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ResultsSkeleton() {
  const t = useTranslations("Results");
  return (
    <div className="flex flex-col gap-8" aria-busy="true">
      <div className="flex flex-col gap-2">
        <p role="status" className="font-medium">
          {t("loading")}
        </p>
        <ul className="flex flex-col gap-1 text-ink-muted">
          {(["weather", "vegetation", "soil"] as const).map((key) => (
            <li key={key}>{t(`loadingSteps.${key}`)}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-10 w-1/2" />
      </div>
      <div className="flex flex-col gap-6 border-t border-line pt-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-3 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-8">
            <Skeleton className="h-16" />
            <Skeleton className="h-9 self-center" />
          </div>
        ))}
      </div>
    </div>
  );
}
