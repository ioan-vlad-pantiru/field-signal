"use client";

import { useTranslations } from "next-intl";
import type { FieldAnalysis, LatLon } from "@/lib/contracts";
import type { DataOrigin } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { Card, SectionTitle } from "@/components/ui/card";
import { ArrowLeftIcon, PinIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { DemoBanner } from "@/components/ui/states";
import { IndicatorCard } from "./indicator-card";
import { ReplayGrid } from "./replay-grid";
import { SoilCard } from "./soil-card";
import { StrategyCards } from "./strategy-cards";
import { StrategyExplanations } from "./strategy-explanations";
import { FieldPlan } from "./field-plan";
import { VerdictCard } from "./verdict-card";

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
  const tf = useTranslations("Field");
  const locale = useAppLocale();
  const l = useLocalized();
  const { location } = analysis;
  const place = [location.commune, location.county].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="press inline-flex min-h-11 w-fit items-center gap-2 rounded-xl pr-3 font-medium text-field"
      >
        <ArrowLeftIcon /> {t("back")}
      </button>

      {analysis.mock ? <DemoBanner origin={origin} /> : null}

      <header className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-ink-muted">
          <PinIcon size={18} />
          <span className="tabular-nums">
            {tf("coordinates", {
              lat: formatNumber(location.point.lat, locale, 2),
              lon: formatNumber(location.point.lon, locale, 2),
            })}
          </span>
        </p>
        <h1 className="text-4xl font-bold tracking-tight">{place || location.label}</h1>
        <p className="text-ink-muted">
          {t("period", { start: analysis.period_start, end: analysis.period_end })}
        </p>
      </header>

      <VerdictCard strategies={analysis.strategies} />

      <SectionTitle hint={t("planHint")}>{t("planTitle")}</SectionTitle>
      <FieldPlan center={location.point} boundary={boundary} strategies={analysis.strategies} />

      <SectionTitle hint={t("indicatorsHint")}>{t("indicatorsTitle")}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        {analysis.indicators.map((indicator, index) => (
          <IndicatorCard key={indicator.id} indicator={indicator} index={index} />
        ))}
      </div>

      <SoilCard soil={analysis.soil} />

      <SectionTitle hint={t("strategiesHint")}>{t("strategiesTitle")}</SectionTitle>
      <StrategyCards strategies={analysis.strategies} />

      <div id="replay" className="scroll-mt-20">
        <SectionTitle hint={t("replayHint")}>{t("replayTitle")}</SectionTitle>
      </div>
      <ReplayGrid strategies={analysis.strategies} />

      <SectionTitle hint={t("explainHint")}>{t("explainTitle")}</SectionTitle>
      <StrategyExplanations strategies={analysis.strategies} />

      <SectionTitle>{t("caveatsTitle")}</SectionTitle>
      <Card>
        <ul className="list-disc space-y-2 pl-5">
          {analysis.caveats.map((c, i) => (
            <li key={i}>{l(c)}</li>
          ))}
        </ul>
        <h3 className="mb-2 mt-4 text-sm font-semibold">{t("sourcesTitle")}</h3>
        <div className="flex flex-wrap gap-2">
          {analysis.sources.map((s) => (
            <SourceChip key={s.dataset} source={s} />
          ))}
        </div>
      </Card>
    </div>
  );
}

export function ResultsSkeleton() {
  const t = useTranslations("Results");
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p role="status" className="text-ink-muted">
        {t("loading")}
      </p>
      <Skeleton className="h-9 w-2/3" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
      <Skeleton className="h-40" />
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-80 w-[85%] shrink-0 sm:w-1/3" />
        ))}
      </div>
    </div>
  );
}
