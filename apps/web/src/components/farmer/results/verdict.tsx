"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { useLocalized } from "@/lib/localized";
import { YIELD_INDEX_CODE, type MainRisk, type Verdict as VerdictData } from "@/lib/results";
import { ConfidenceBadge } from "@/components/ui/badges";
import { AlertIcon, ChartIcon, ChevronRightIcon, ShieldIcon } from "@/components/ui/icons";
import { RotationWheel } from "@/components/ui/rotation-wheel";

/**
 * The answer in one card: the best rotation for this field in one short sentence, its wheel with
 * the poor seasons beside it, then the main risk, the confidence and the way into the data.
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
  const l = useLocalized();
  const { kind, best, bestPoor, currentPoor } = verdict;
  const strong = (chunks: ReactNode) => <strong className="font-semibold text-field">{chunks}</strong>;
  const name = l(best.name);

  const headline =
    kind === "keep" ? t.rich("keep", { b: strong }) : t.rich(kind === "fewer" ? "fewer" : "best", { name, b: strong });

  return (
    <section aria-labelledby="verdict" className="rise flex flex-col gap-4 rounded-[var(--radius-xl)] bg-surface p-5 shadow-1 print:p-0 print:shadow-none">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-ink-muted">{t("label")}</p>
          <p
            id="verdict"
            className="font-display text-[1.5rem] font-semibold leading-[1.2] tracking-tight text-balance sm:text-3xl print:text-[16pt]"
          >
            {headline}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <RotationWheel sequence={best.sequence} size={88} animate />
          <div className="flex min-w-0 flex-col gap-1">
            <p className={`font-semibold ${kind === "fewer" ? "text-status-good" : ""}`}>{t("poor", { count: bestPoor, start })}</p>
            {kind === "keep" ? null : <p className="text-sm text-ink-muted">{t("yours", { count: currentPoor })}</p>}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2.5 border-t border-line pt-4">
        <AlertIcon size={18} className={`mt-0.5 shrink-0 ${risk ? "text-status-watch" : "text-ink-muted"}`} />
        <div className="min-w-0">
          <p className="font-semibold">
            {risk ? (risk.code === YIELD_INDEX_CODE ? t("riskYield") : t("risk", { risk: l(risk.label) })) : t("noRisk")}
          </p>
          {risk ? (
            <p className="text-sm text-ink-muted">
              {t("riskHit", { count: risk.seasons })}{" "}
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <ShieldIcon size={13} />
                {common("verifyAgronomist")}
              </span>
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
          className="no-print press -mr-2 ml-auto inline-flex min-h-tap items-center gap-1.5 rounded-pill px-3 text-sm font-semibold text-field hover:bg-surface-sunken"
        >
          <ChartIcon size={16} />
          {t("data")}
          <ChevronRightIcon size={16} />
        </button>
      </div>
    </section>
  );
}
