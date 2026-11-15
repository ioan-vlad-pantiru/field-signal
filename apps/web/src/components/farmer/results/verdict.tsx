"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import type { MainRisk, Verdict as VerdictData } from "@/lib/results";
import { ConfidenceBadge } from "@/components/ui/badges";
import { AlertIcon, ChartIcon, ChevronRightIcon, ShieldIcon } from "@/components/ui/icons";
import { CropSequence } from "./crop-sequence";

/**
 * The answer in one card: the best rotation for this field and the main risk, one sentence each,
 * with the confidence and the way into the data behind it.
 */
export function VerdictCard({
  verdict,
  risk,
  start,
  onData,
}: {
  verdict: VerdictData<Strategy>;
  risk: MainRisk | null;
  start: number;
  onData: () => void;
}) {
  const t = useTranslations("Results.verdict");
  const common = useTranslations("Common");
  const locale = useAppLocale();
  const l = useLocalized();
  const { kind, best, bestPoor, currentPoor } = verdict;
  const strong = (chunks: ReactNode) => <strong className="font-semibold text-field">{chunks}</strong>;
  const name = l(best.name);
  const n = (v: number) => formatNumber(v, locale, 0);

  // Zero gets its own sentence: Romanian needs a negated verb.
  const sentence =
    kind === "keep"
      ? t.rich("keep", { b: strong })
      : kind === "fewer" && bestPoor === 0
        ? t.rich("fewerNone", { name, start, current: n(currentPoor), b: strong })
        : kind === "same"
          ? t.rich("same", { name, b: strong })
          : t.rich(kind, { name, start, best: bestPoor, current: n(currentPoor), b: strong });

  return (
    <section aria-labelledby="verdict" className="rise flex flex-col gap-4 rounded-[var(--radius-xl)] bg-surface p-5 shadow-1 print:p-0 print:shadow-none">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-ink-muted">{t("label")}</p>
        <p
          id="verdict"
          className="font-display text-[1.625rem] font-semibold leading-[1.15] tracking-tight text-balance sm:text-3xl print:text-[16pt]"
        >
          {sentence}
        </p>
        <CropSequence sequence={best.sequence} />
      </div>

      <div className="flex items-start gap-3 rounded-[var(--radius-lg)] bg-surface-sunken p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-status-watch-tint text-status-watch">
          <AlertIcon size={18} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">
            {risk ? t("risk", { risk: l(risk.label), count: risk.seasons }) : t("noRisk")}
          </p>
          {risk ? (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-muted">
              <ShieldIcon size={14} />
              {common("verifyAgronomist")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ConfidenceBadge confidence={best.confidence} />
        <button
          type="button"
          onClick={onData}
          aria-haspopup="dialog"
          className="no-print press -mr-2 inline-flex min-h-tap items-center gap-1.5 rounded-pill px-3 text-sm font-semibold text-field hover:bg-surface-sunken"
        >
          <ChartIcon size={16} />
          {t("data")}
          <ChevronRightIcon size={16} />
        </button>
      </div>
    </section>
  );
}
