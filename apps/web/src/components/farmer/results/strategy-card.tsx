"use client";

import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { firstSentence, poorSeasons } from "@/lib/results";
import { useCountUp } from "@/lib/use-count-up";
import { ConfidenceBadge } from "@/components/ui/badges";
import { SeasonStrip } from "@/components/ui/season-strip";
import { useRotationName } from "./rotation-name";

/**
 * One rotation as a card: name, crops, fit score, a one-line why, its 25 seasons and its
 * confidence. Tapping it opens the full explanation.
 */
export function StrategyCard({
  strategy,
  years,
  start,
  isBest,
  selected,
  onOpen,
}: {
  strategy: Strategy;
  years: number[];
  start: number;
  isBest: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("Results.rotations");
  const short = useTranslations("CropsShort");
  const locale = useAppLocale();
  const l = useLocalized();
  const name = useRotationName()(strategy);
  const poor = poorSeasons(strategy);
  const score = useCountUp(strategy.score.total);
  const tag = isBest ? t("best") : null;
  // API names spell out the crops; the crop line only adds something under "Your rotation now".
  const nameListsCrops = strategy.sequence.every((crop) => name.includes(short(crop)));

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-current={selected ? "true" : undefined}
      className={`press flex h-full w-full flex-col gap-3 rounded-[var(--radius-xl)] bg-surface p-4 text-left shadow-1 hover:shadow-2 ${
        selected ? "ring-2 ring-field" : ""
      }`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          {tag ? (
            <span className="mb-1 inline-flex rounded-pill bg-field-soft px-2.5 py-0.5 text-xs font-semibold text-field-strong">{tag}</span>
          ) : null}
          <span className="block text-lg font-semibold leading-snug">{name}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="sr-only">{t("scoreLabel")}: </span>
          <span className="font-display text-3xl font-semibold tabular-nums leading-none">{formatNumber(score, locale, 0)}</span>
          <span className="block text-xs text-ink-muted">{t("of100")}</span>
        </span>
      </span>

      {nameListsCrops ? null : (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold" aria-label={strategy.sequence.map((c) => short(c)).join(", ")}>
          {strategy.sequence.map((crop, i) => (
            <span key={i} aria-hidden="true" className="inline-flex items-center gap-1.5">
              {i > 0 ? <span className="text-ink-muted">→</span> : null}
              <span className="size-2.5 rounded-full ring-1 ring-ink/15" style={{ background: CROP_COLORS[crop] }} />
              {short(crop)}
            </span>
          ))}
        </span>
      )}

      <span className="line-clamp-2 text-sm text-ink-muted">{firstSentence(l(strategy.explanation.why))}</span>

      <span className="mt-auto flex flex-col gap-1">
        <SeasonStrip
          outcomes={strategy.replay}
          years={years}
          label={t("stripLabel", { name, poor: t("poor", { count: poor, start }) })}
          size="sm"
          animate
          className="w-full"
        />
        <span aria-hidden="true" className="flex justify-between text-xs tabular-nums text-ink-muted">
          <span>{years[0]}</span>
          <span>{years.at(-1)}</span>
        </span>
      </span>

      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${poor === 0 ? "text-status-good" : ""}`}>{t("poorShort", { count: poor })}</span>
        <ConfidenceBadge confidence={strategy.confidence} />
      </span>
    </button>
  );
}
