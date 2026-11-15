"use client";

import { useTranslations } from "next-intl";
import type { SeasonOutcome, Strategy } from "@/lib/contracts";
import { formatNumber, formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { Link } from "@/i18n/navigation";
import { ConfidenceBadge, StatusBadge } from "@/components/ui/badges";
import { buttonClass } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { ChartIcon, ShieldIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { useRotationName } from "./rotation-name";

const BREAKDOWN = ["yield_stability", "water", "soil_health", "low_risk"] as const;

/**
 * Everything about one rotation, one tap from its card: the score and its parts, then Why,
 * Evidence, Benefits, Gaps, Risks (each with its confidence and "check with an agronomist") and
 * every season, as collapsible sections. Links to the simulator and to the data behind it.
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
        <dl className="grid grid-cols-4 gap-2">
          {BREAKDOWN.map((key) => (
            <div key={key} className="rounded-[var(--radius-md)] bg-surface-sunken px-2 py-2 text-center">
              <dd className="font-display text-xl font-semibold tabular-nums">{formatNumber(score[key], locale, 0)}</dd>
              <dt className="text-xs leading-tight text-ink-muted">{tr(`breakdown.${key}`)}</dt>
            </div>
          ))}
        </dl>
        <ConfidenceBadge confidence={strategy.confidence} />
      </div>

      <Disclosure summary={t("why")} defaultOpen>
        <p>{l(explanation.why)}</p>
      </Disclosure>

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

      <Disclosure summary={t("benefits")}>
        <ul className="list-disc space-y-1 pl-5">
          {explanation.benefits.map((b, i) => (
            <li key={i}>{l(b)}</li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure summary={t("gaps")}>
        <ul className="list-disc space-y-1 pl-5">
          {explanation.gaps.map((g, i) => (
            <li key={i}>{l(g)}</li>
          ))}
        </ul>
      </Disclosure>

      {explanation.risks.length > 0 ? (
        <Disclosure summary={`${t("risks")} · ${explanation.risks.length}`}>
          <ul className="flex flex-col gap-3">
            {explanation.risks.map((r, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-surface-sunken p-3">
                <span>{l(r.text)}</span>
                {/* A risk carries its rotation's confidence: the API rates one confidence per rotation. */}
                <span className="flex flex-wrap items-center gap-2">
                  <ConfidenceBadge confidence={strategy.confidence} />
                  <span className="inline-flex items-center gap-1 text-sm font-semibold">
                    <ShieldIcon size={14} />
                    {common("verifyAgronomist")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      <Disclosure summary={t("seasons")}>
        <SeasonList outcomes={strategy.replay} />
      </Disclosure>

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

/** Every season of one rotation, newest first: crop, outcome and the main reason. */
function SeasonList({ outcomes }: { outcomes: SeasonOutcome[] }) {
  const tr = useTranslations("Results.rotations");
  const tc = useTranslations("CropsShort");
  const l = useLocalized();
  return (
    <ol className="flex flex-col divide-y divide-line">
      {[...outcomes].reverse().map((o) => (
        <li key={o.year} className="flex items-start gap-3 py-2">
          <span className="w-12 shrink-0 pt-1 font-semibold tabular-nums">{o.year}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={o.status} />
              <span className="text-sm text-ink-muted">{tc(o.crop)}</span>
              {o.evidence_level === "low" ? <span className="text-xs text-ink-muted">{tr("weakEvidence")}</span> : null}
            </span>
            {o.status !== "good" && o.reasons[0] ? <span className="mt-1 block text-sm">{l(o.reasons[0].label)}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
