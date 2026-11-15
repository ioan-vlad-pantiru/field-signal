"use client";

import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { useCountUp } from "@/lib/use-count-up";
import { RotationWheel } from "@/components/ui/rotation-wheel";
import { useRotationName } from "./rotation-name";

/**
 * One rotation as a card: name, fit score and its wheel. Tapping it opens the full explanation,
 * season by season.
 */
export function StrategyCard({
  strategy,
  isBest,
  selected,
  onOpen,
}: {
  strategy: Strategy;
  isBest: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("Results.rotations");
  const short = useTranslations("CropsShort");
  const locale = useAppLocale();
  const name = useRotationName()(strategy);
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
      className={`press flex h-full w-full flex-col gap-3 pt-4 text-left ${
        selected ? "shadow-[inset_0_2px_0_var(--field)]" : "shadow-[inset_0_1px_0_var(--line)] hover:shadow-[inset_0_2px_0_var(--line)]"
      }`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          {tag ? (
            <span className="mb-0.5 block text-xs font-semibold text-field">{tag}</span>
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

      <RotationWheel sequence={strategy.sequence} size={64} />
    </button>
  );
}
