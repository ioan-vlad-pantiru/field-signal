"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import type { Verdict as VerdictData } from "@/lib/results";
import { CropSequence } from "@/components/ui/crop-chip";

/** The answer first, as one sentence in seasons, then the crops and the fit scores under it. */
export function Verdict({ verdict, start }: { verdict: VerdictData<Strategy>; start: number }) {
  const t = useTranslations("Results.verdict");
  const locale = useAppLocale();
  const l = useLocalized();
  const { kind, best, current, bestPoor, currentPoor } = verdict;
  const n = (v: number) => formatNumber(v, locale, 0);
  const strong = (chunks: ReactNode) => <strong className="font-semibold text-field">{chunks}</strong>;
  const name = l(best.name);

  // Zero gets its own sentence: Romanian needs a negated verb ("nu ați fi avut niciun…").
  const sentence =
    kind === "keep"
      ? bestPoor === 0
        ? t.rich("keepNone", { start, b: strong })
        : t.rich("keep", { start, count: bestPoor, b: strong })
      : kind === "fewer" && bestPoor === 0
        ? t.rich("fewerNone", { name, start, current: n(currentPoor), b: strong })
        : kind === "same"
        ? t.rich("same", { name, start, count: n(bestPoor), b: strong })
        : t.rich(kind, { name, start, best: bestPoor, current: n(currentPoor), b: strong });

  return (
    <section aria-labelledby="verdict" className="flex flex-col gap-4">
      <p
        id="verdict"
        className="max-w-[24ch] font-display text-[1.875rem] font-medium leading-[1.12] tracking-tight text-balance md:max-w-[28ch] md:text-[2.75rem] print:max-w-none print:text-[20pt]"
      >
        {sentence}
      </p>
      <div className="flex flex-col gap-2">
        <CropSequence sequence={best.sequence} />
        <p className="tabular-nums text-ink-muted">
          {kind === "keep"
            ? t("fitKeep", { score: n(best.score.total) })
            : t("fit", { best: n(best.score.total), current: n(current.score.total) })}
        </p>
      </div>
    </section>
  );
}
