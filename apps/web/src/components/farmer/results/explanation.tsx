"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { formatNumber, formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { AgronomistBadge, ConfidenceBadge } from "@/components/ui/badges";
import { Link } from "@/i18n/navigation";

const BREAKDOWN = ["yield_stability", "water", "soil_health", "low_risk"] as const;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 font-semibold">{title}</h4>
      {children}
    </div>
  );
}

/** Why a rotation scored as it did: the reasoning, the numbers behind it, and what to check locally. */
export function Explanation({ strategy }: { strategy: Strategy }) {
  const t = useTranslations("Results.explain");
  const tr = useTranslations("Results.rotations");
  const tSim = useTranslations("Simulator");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();
  const { explanation, score, score_range: range } = strategy;
  const n = (v: number) => formatNumber(v, locale, 0);

  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <Block title={t("why")}>
        <p>{l(explanation.why)}</p>
      </Block>

      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {BREAKDOWN.map((key) => (
            <div key={key}>
              <dt className="text-sm text-ink-muted">{tr(`breakdown.${key}`)}</dt>
              <dd className="text-lg font-semibold tabular-nums">{n(score[key])}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
          <span className="tabular-nums">{tr("range", { low: n(range.low), high: n(range.high) })}</span>
          <ConfidenceBadge confidence={strategy.confidence} />
        </div>
      </div>

      {explanation.evidence.length > 0 ? (
        <Block title={t("evidence")}>
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {explanation.evidence.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span>{l(e.text)}</span>
                  {e.value != null ? (
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatQuantity(e.value, e.unit, locale, unitLabel)}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-ink-muted">{t("source", { source: e.source })}</span>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <Block title={t("benefits")}>
          <ul className="list-disc space-y-1 pl-5">
            {explanation.benefits.map((b, i) => (
              <li key={i}>{l(b)}</li>
            ))}
          </ul>
        </Block>
        <Block title={t("gaps")}>
          <ul className="list-disc space-y-1 pl-5">
            {explanation.gaps.map((g, i) => (
              <li key={i}>{l(g)}</li>
            ))}
          </ul>
        </Block>
      </div>

      {explanation.risks.length > 0 ? (
        <Block title={t("risks")}>
          <ul className="flex flex-col gap-3">
            {explanation.risks.map((r, i) => (
              <li key={i} className="flex flex-col items-start gap-1.5">
                <span>{l(r.text)}</span>
                <AgronomistBadge />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <div className="flex flex-col items-start gap-1">
        <Link
          href={`/simulator?strategy=${encodeURIComponent(strategy.id)}&seq=${strategy.sequence.join(",")}`}
          className="inline-flex min-h-11 items-center font-medium text-field underline underline-offset-4"
        >
          {tSim("openLink")} →
        </Link>
        <p className="text-xs text-ink-muted">{t(`generatedBy.${explanation.generated_by}`)}</p>
      </div>
    </div>
  );
}
