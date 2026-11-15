"use client";

import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { formatNumber, formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { ChartIcon, ShieldIcon } from "@/components/ui/icons";
import { RotationLegend, RotationWheel } from "@/components/ui/rotation-wheel";
import { Sheet } from "@/components/ui/sheet";
import { useRotationName } from "./rotation-name";

const BREAKDOWN = ["yield_stability", "water", "soil_health", "low_risk"] as const;

/**
 * Everything about one rotation, one tap from its card: the score and its parts, then Evidence and
 * Risks (each with "check with an agronomist") as collapsible sections. Its seasons are on the page,
 * as a timeline. Links to the simulator and to the data behind it.
 */
export function StrategySheet({
  strategy,
  onClose,
  onData,
}: {
  strategy: Strategy | null;
  onClose: () => void;
  onData: () => void;
}) {
  const tr = useTranslations("Results.rotations");
  const nameOf = useRotationName();
  const locale = useAppLocale();
  const n = (v: number) => formatNumber(v, locale, 0);

  return (
    <Sheet
      open={strategy !== null}
      onClose={onClose}
      snap
      title={strategy ? nameOf(strategy) : ""}
      subtitle={strategy ? tr("scoreLine", { score: n(strategy.score.total), low: n(strategy.score_range.low), high: n(strategy.score_range.high) }) : undefined}
    >
      {strategy ? <Body strategy={strategy} onData={onData} /> : null}
    </Sheet>
  );
}

function Body({ strategy, onData }: { strategy: Strategy; onData: () => void }) {
  const t = useTranslations("Results.explain");
  const tr = useTranslations("Results.rotations");
  const common = useTranslations("Common");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();
  const { explanation, score } = strategy;

  return (
    <div className="flex flex-col pb-2">
      <div className="flex flex-col gap-3 pb-4">
        <div className="flex items-center gap-5 py-1">
          <RotationWheel sequence={strategy.sequence} size={112} animate />
          <RotationLegend sequence={strategy.sequence} />
        </div>
        <dl className="grid grid-cols-4 gap-2">
          {BREAKDOWN.map((key) => (
            <div key={key} className="rounded-[var(--radius-md)] bg-surface-sunken px-2 py-2 text-center">
              <dd className="font-display text-xl font-semibold tabular-nums">{formatNumber(score[key], locale, 0)}</dd>
              <dt className="text-xs leading-tight text-ink-muted">{tr(`breakdown.${key}`)}</dt>
            </div>
          ))}
        </dl>
      </div>

      {explanation.evidence.length > 0 ? (
        <Disclosure summary={t("evidence")}>
          <ul className="flex flex-col divide-y divide-line">
            {explanation.evidence.map((e, i) => (
              <li key={i} className="flex flex-col gap-0.5 py-2">
                <span className="flex items-baseline justify-between gap-3">
                  <span>{l(e.text)}</span>
                  {e.value != null ? (
                    <span className="shrink-0 font-semibold tabular-nums">{formatQuantity(e.value, e.unit, locale, unitLabel)}</span>
                  ) : null}
                </span>
                <span className="text-xs text-ink-muted">{t("source", { source: e.source })}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {explanation.risks.length > 0 ? (
        <Disclosure summary={`${t("risks")} · ${explanation.risks.length}`}>
          <ul className="flex flex-col gap-3">
            {explanation.risks.map((r, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-surface-sunken p-3">
                <span>{l(r.text)}</span>
                <span className="inline-flex items-center gap-1 text-sm font-semibold">
                  <ShieldIcon size={14} />
                  {common("verifyAgronomist")}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button type="button" onClick={onData} className={buttonClass("secondary")}>
          <ChartIcon size={18} />
          {t("data")}
        </button>
        <Link
          href={`/simulator?strategy=${encodeURIComponent(strategy.id)}&seq=${strategy.sequence.join(",")}`}
          className={buttonClass("quiet")}
        >
          {t("simulator")}
        </Link>
      </div>
      <p className="mt-3 text-xs text-ink-muted">{t(`generatedBy.${explanation.generated_by}`)}</p>
    </div>
  );
}
