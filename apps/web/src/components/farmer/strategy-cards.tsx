"use client";

import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { ConfidenceBadge } from "@/components/ui/badges";
import { RangeBar, ScoreBar } from "@/components/ui/charts";
import { CropSequence } from "@/components/ui/crop-chip";

const BREAKDOWN = ["yield_stability", "water", "soil_health", "low_risk"] as const;

function StrategyCard({ strategy, isBest }: { strategy: Strategy; isBest: boolean }) {
  const t = useTranslations("Results.strategy");
  const locale = useAppLocale();
  const l = useLocalized();
  const { score, score_range: range } = strategy;
  const n = (v: number) => formatNumber(v, locale, 0);

  return (
    <article
      className={`flex w-[85%] shrink-0 snap-center flex-col gap-4 rounded-2xl border bg-surface p-4 sm:w-auto ${
        strategy.is_current ? "border-2 border-primary" : "border-border"
      }`}
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {strategy.is_current ? (
            <span className="rounded-full bg-primary px-2.5 py-0.5 text-sm font-semibold text-on-primary">
              {t("current")}
            </span>
          ) : null}
          {isBest ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold">
              {t("best")}
            </span>
          ) : null}
        </div>
        <h3 className="text-lg font-semibold">{l(strategy.name)}</h3>
        <CropSequence sequence={strategy.sequence} />
      </header>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">{t("score")}</span>
          <span>
            <span className="text-4xl font-semibold tabular-nums">{n(score.total)}</span>
            <span className="text-muted">/100</span>
          </span>
        </div>
        <RangeBar
          range={range}
          label={t("rangeLabel", { low: n(range.low), mid: n(range.mid), high: n(range.high) })}
        />
        <div className="mt-1 flex justify-between text-xs text-muted tabular-nums" aria-hidden="true">
          <span>{t("low", { value: n(range.low) })}</span>
          <span>{t("mid", { value: n(range.mid) })}</span>
          <span>{t("high", { value: n(range.high) })}</span>
        </div>
      </div>

      <ConfidenceBadge confidence={strategy.confidence} />

      <ul className="flex flex-col gap-2">
        {BREAKDOWN.map((key) => (
          <li key={key}>
            <div className="flex justify-between text-sm">
              <span>{t(`breakdown.${key}`)}</span>
              <span className="font-medium tabular-nums">{n(score[key])}</span>
            </div>
            <ScoreBar value={score[key]} />
          </li>
        ))}
      </ul>
    </article>
  );
}

/** Swipeable row on mobile, three columns on desktop. */
export function StrategyCards({ strategies }: { strategies: Strategy[] }) {
  const t = useTranslations("Results.strategy");
  const best = Math.max(...strategies.map((s) => s.score.total));
  return (
    <div
      className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0"
      role="list"
      aria-label={t("listLabel")}
    >
      {strategies.map((strategy) => (
        <div key={strategy.id} role="listitem" className="contents">
          <StrategyCard strategy={strategy} isBest={strategy.score.total === best} />
        </div>
      ))}
    </div>
  );
}
