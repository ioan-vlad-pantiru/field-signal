"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { FieldAnalysis, LatLon } from "@/lib/contracts";
import type { DataOrigin } from "@/lib/api";
import { useLocalized } from "@/lib/localized";
import { placeShifts, rankStrategies, replayYears, verdict as buildVerdict } from "@/lib/results";
import { Disclosure } from "@/components/ui/disclosure";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { DemoBanner } from "@/components/ui/states";
import { FieldPlan } from "./field-plan";
import { Evidence } from "./results/evidence";
import { ResultsHeader } from "./results/results-header";
import { Rotations } from "./results/rotations";
import { SectionNav, type SectionId } from "./results/section-nav";
import { ShiftList } from "./results/shift";
import { LAPTOP, useMediaQuery } from "./results/use-media-query";
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

/** Sections sit under the sticky site header and, on a laptop, the in-page nav. */
const SECTION = "lg:scroll-mt-32";

/**
 * Results, answer first: verdict, what changed at this place, the rotations compared, the plan and
 * the evidence. One selected rotation drives the comparison, its explanation and the plan.
 */
export function ResultsView({
  analysis,
  origin,
  boundary,
  onBack,
}: {
  analysis: FieldAnalysis;
  origin: DataOrigin;
  /** The field the farmer drew, if any; the field plan fills it with hexagons. */
  boundary: LatLon[] | null;
  onBack: () => void;
}) {
  const t = useTranslations("Results");
  const l = useLocalized();
  const laptop = useMediaQuery(LAPTOP);

  const ranked = useMemo(() => rankStrategies(analysis.strategies), [analysis.strategies]);
  const verdict = useMemo(() => buildVerdict(analysis.strategies), [analysis.strategies]);
  const years = useMemo(() => replayYears(analysis.strategies), [analysis.strategies]);
  const shifts = useMemo(() => placeShifts(analysis.indicators), [analysis.indicators]);
  const [selectedId, setSelectedId] = useState(ranked[0].id);
  const selected = ranked.find((s) => s.id === selectedId) ?? ranked[0];

  const sections: SectionId[] = [...(shifts.length > 0 ? (["shift"] as const) : []), "rotations", "plan", "evidence"];
  const start = years[0] ?? analysis.period_start;
  const end = years.at(-1) ?? analysis.period_end;

  return (
    <div className="flex flex-col print:text-[11pt]">
      <style>{PRINT_CSS}</style>
      {analysis.mock ? <DemoBanner origin={origin} /> : null}

      <div className={analysis.mock ? "mt-6" : ""}>
        <ResultsHeader analysis={analysis} boundary={boundary} onBack={onBack} />
      </div>

      <div className="mt-8 md:mt-10 print:mt-4">
        <Verdict verdict={verdict} start={analysis.period_start} />
      </div>

      <div className="mt-10 print:mt-0">
        <SectionNav sections={sections} />
        <div className="mt-10 lg:mt-12 print:mt-0">
        {shifts.length > 0 ? (
          <Section id="shift" title={t("shift.title")} hint={t("shift.hint")} className={`${SECTION} print:hidden`}>
            <ShiftList shifts={shifts} />
          </Section>
        ) : null}

        <Section
          id="rotations"
          title={t("rotations.title")}
          hint={t(laptop ? "rotations.hint" : "rotations.hintPhone", { start, end })}
          className={`${SECTION} print:hidden`}
        >
          <Rotations
            ranked={ranked}
            years={years}
            start={analysis.period_start}
            selectedId={selected.id}
            onSelect={setSelectedId}
            laptop={laptop}
          />
        </Section>

        <Section id="plan" title={t("planTitle")} hint={t("planHint")} className={`${SECTION} print:mt-6 print:border-t-0 print:pt-0`}>
          <div className="flex flex-col gap-6">
            <div className="no-print">
              {/* Names are too long for a segmented control on a phone; a native select fits them. */}
              <div className="hidden sm:block">
                <Segmented
                  label={t("planRotation")}
                  value={selected.id}
                  onChange={setSelectedId}
                  options={ranked.map((s) => ({ value: s.id, label: l(s.name) }))}
                />
              </div>
              <label className="flex flex-col gap-1 sm:hidden">
                <span className="text-sm text-ink-muted">{t("planRotation")}</span>
                <select
                  value={selected.id}
                  onChange={(event) => setSelectedId(event.target.value)}
                  className="min-h-11 rounded-xl border border-line bg-surface px-3 font-medium text-ink"
                >
                  {ranked.map((s) => (
                    <option key={s.id} value={s.id}>
                      {l(s.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hidden font-semibold print:block">{l(selected.name)}</p>
            <FieldPlan center={analysis.location.point} boundary={boundary} strategy={selected} />
            <ul className="hidden flex-wrap gap-2 print:flex">
              {analysis.sources.map((s) => (
                <li key={s.dataset}>
                  <SourceChip source={s} />
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section id="evidence" title={t("evidence.title")} hint={t("evidence.hint")} className={`${SECTION} print:hidden`}>
          {laptop ? (
            <Evidence analysis={analysis} />
          ) : (
            <Disclosure summary={t("evidence.show")}>
              <div className="pt-2">
                <Evidence analysis={analysis} />
              </div>
            </Disclosure>
          )}
        </Section>
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
