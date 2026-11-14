"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DataOrigin, Loaded } from "@/lib/api";
import type { OptimizerPlan, OptimizerResponse, RuleCheck } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
import { byField, ruleStatus } from "@/lib/results";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { ConfidenceBadge, ToneBadge } from "@/components/ui/badges";
import { RangeBar } from "@/components/ui/charts";
import { CropDot } from "@/components/ui/crop-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { NoticeBar } from "@/components/ui/notice-bar";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { DemoBanner, EmptyState } from "@/components/ui/states";
import { CropSequence } from "./crop-sequence";

export type OptimizerState =
  | { status: "loading" }
  /** `invalid`: the API refused the fields (422); anything else is a generic failure. */
  | { status: "error"; invalid: boolean }
  | { status: "done"; result: Loaded<OptimizerResponse> };

const BREAKDOWN = ["yield_stability", "water", "soil_health", "low_risk"] as const;

function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex w-fit items-center rounded-full border border-line px-2.5 py-1 text-sm">{children}</span>;
}

/**
 * All submitted fields planned together (`POST /v1/farm/optimize`), below the per-field results. Its own
 * loading and error state: a slow solve or a rejected request never touches the per-field results.
 */
export function OptimizerSection({ state, names }: { state: OptimizerState; names: string[] }) {
  const t = useTranslations("Optimizer");
  return (
    <Section id="farm-plan" title={t("title")} hint={t("hint")} className="print:hidden">
      {state.status === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p role="status" className="font-medium">
            {t("loading")}
          </p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : state.status === "error" ? (
        <NoticeBar>{t(state.invalid ? "invalid" : "error")}</NoticeBar>
      ) : (
        <OptimizerBody data={state.result.data} origin={state.result.origin} names={names} />
      )}
    </Section>
  );
}

function OptimizerBody({ data, origin, names }: { data: OptimizerResponse; origin: DataOrigin; names: string[] }) {
  const t = useTranslations("Optimizer");
  const multi = useTranslations("Field.multi");
  const locale = useAppLocale();
  const l = useLocalized();
  // The API echoes the ids sent (`f1`, `f2`, …); the bundled fallback is a demo farm, not these fields.
  const fieldName = (id: string) => {
    const n = Number(id.slice(1));
    return (origin === "api" ? names[n - 1] : undefined) ?? multi("fieldN", { n });
  };

  return (
    <div className="flex flex-col gap-8">
      {data.mock ? <DemoBanner origin={origin} /> : null}
      <p className="tabular-nums text-ink-muted">
        {t("meta", {
          years: data.plan_years,
          ha: formatNumber(data.total_area_ha, locale, 1),
          count: data.scenario_count,
          first: data.scenario_first,
          last: data.scenario_last + data.plan_years - 1,
          model: data.model_version,
        })}
      </p>

      {data.plans.length === 0 ? (
        <EmptyState>{t("none")}</EmptyState>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {data.plans.map((plan) => (
            <li key={plan.rank} className="py-6 first:pt-0">
              <PlanView plan={plan} current={data.current ?? null} fieldName={fieldName} />
            </li>
          ))}
        </ol>
      )}

      {data.current ? (
        <div className="border-t border-line pt-6">
          <PlanView plan={data.current} current={null} fieldName={fieldName} />
        </div>
      ) : null}

      <div className="border-t border-line pt-6">
        <h3 className="text-lg font-semibold">{t("caveats")}</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
          {data.caveats.map((caveat, i) => (
            <li key={i}>{l(caveat)}</li>
          ))}
        </ul>
        <ul className="mt-4 flex flex-wrap gap-2">
          {data.sources.map((source) => (
            <li key={source.dataset} className="max-w-full">
              <SourceChip source={source} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** One plan: title, score against today's rotation, weather spread, rotations by field, then the details. */
function PlanView({
  plan,
  current,
  fieldName,
}: {
  plan: OptimizerPlan;
  current: OptimizerPlan | null;
  fieldName: (id: string) => string;
}) {
  const t = useTranslations("Optimizer");
  const tr = useTranslations("Results.rotations");
  const locale = useAppLocale();
  const n = (v: number) => formatNumber(v, locale, 0);
  // "Optimal" only when the solver proved it; otherwise rank 1 is the best solution found.
  const title =
    plan.rank === 0
      ? tr("current")
      : plan.rank === 1
        ? t(plan.proven_optimal ? "bestOptimal" : "best")
        : t("alternative", { n: plan.rank - 1 });
  const diff = current ? Math.round(plan.score.total - current.score.total) : null;
  const { worst, best, score_range: range } = plan;

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className={`text-xl font-semibold tracking-tight ${plan.rank === 1 ? "text-field" : ""}`}>{title}</h3>
        <p className="tabular-nums">
          <span className="text-2xl font-semibold">{n(plan.score.total)}</span>{" "}
          <span className="text-ink-muted">{t("of100")}</span>
          {diff !== null ? (
            <span className="ml-2 text-ink-muted">{t("vsCurrent", { diff: `${diff > 0 ? "+" : ""}${n(diff)}` })}</span>
          ) : null}
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <RangeBar range={range} label={t("rangeLabel", { low: n(range.low), mid: n(range.mid), high: n(range.high) })} />
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-ink-muted">{t("worst")}</dt>
            <dd className="text-base font-semibold tabular-nums">{n(worst.total)}</dd>
            <dd className="tabular-nums text-ink-muted">{t("window", { start: worst.start_season, end: worst.end_season })}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">{t("typical")}</dt>
            <dd className="text-base font-semibold tabular-nums">{n(range.mid)}</dd>
            <dd className="text-ink-muted">{t("median")}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">{t("bestCase")}</dt>
            <dd className="text-base font-semibold tabular-nums">{n(best.total)}</dd>
            <dd className="tabular-nums text-ink-muted">{t("window", { start: best.start_season, end: best.end_season })}</dd>
          </div>
        </dl>
      </div>

      <div>
        <h4 className="font-semibold">{t("perField")}</h4>
        <p className="text-sm text-ink-muted">{t("perFieldHint")}</p>
        {/* One row per rotation; a field on a farm under 75 ha may have several rows (same field_id). */}
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {byField(plan.allocations).map((a, i) => (
            <li key={`${a.field_id}:${i}`} className="flex flex-col gap-1.5 py-2">
              <p>
                <span className="font-medium">{fieldName(a.field_id)}</span>{" "}
                <span className="tabular-nums text-ink-muted">· {t("ha", { ha: formatNumber(a.area_ha, locale, 1) })}</span>
              </p>
              <CropSequence sequence={a.sequence} />
            </li>
          ))}
        </ul>
      </div>

      <Disclosure summary={t("details")} defaultOpen={plan.rank === 1}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {BREAKDOWN.map((key) => (
                <div key={key}>
                  <dt className="text-sm text-ink-muted">{tr(`breakdown.${key}`)}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{n(plan.score[key])}</dd>
                </div>
              ))}
            </dl>
            <ConfidenceBadge confidence={plan.confidence} />
          </div>
          <YearShares plan={plan} />
          <Rules rules={plan.rules} />
        </div>
      </Disclosure>
    </article>
  );
}

function YearShares({ plan }: { plan: OptimizerPlan }) {
  const t = useTranslations("Optimizer");
  const crops = useTranslations("Crops");
  const locale = useAppLocale();
  return (
    <div>
      <h4 className="font-semibold">{t("shares")}</h4>
      <ul className="mt-2 flex flex-col gap-3">
        {plan.yearly_areas.map((year) => (
          <li key={year.plan_year}>
            <p className="text-sm text-ink-muted">{t("year", { n: year.plan_year })}</p>
            <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
              {year.areas.map((a) => (
                <span key={a.crop} style={{ width: `${a.share_pct}%`, background: CROP_COLORS[a.crop] }} />
              ))}
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
              {year.areas.map((a) => (
                <li key={a.crop} className="flex items-center gap-1.5">
                  <CropDot crop={a.crop} />
                  {crops(a.crop)} {t("pct", { value: formatNumber(a.share_pct, locale, 0) })}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

const RULE_TONE = { within: "good", outside: "watch", belowThreshold: "nodata" } as const;

function Rules({ rules }: { rules: RuleCheck[] }) {
  const t = useTranslations("Optimizer.rules");
  const locale = useAppLocale();
  const pct = (v: number) => formatNumber(v, locale, 1);
  return (
    <div>
      <h4 className="font-semibold">{t("title")}</h4>
      <p className="text-sm text-ink-muted">{t("hint")}</p>
      <ul className="mt-2 flex flex-col divide-y divide-line">
        {rules.map((rule, i) => (
          <li key={i} className="flex flex-col gap-1.5 py-2">
            <p>{t(rule.id, { limit: pct(rule.limit_pct) })}</p>
            <p className="text-sm tabular-nums text-ink-muted">{t("value", { value: pct(rule.value_pct), source: rule.source })}</p>
            <div className="flex flex-wrap gap-1.5">
              <ToneBadge tone={RULE_TONE[ruleStatus(rule)]} label={t(ruleStatus(rule))} />
              <Pill>{t(rule.applies ? "applied" : "notApplied")}</Pill>
              {rule.verified ? null : <Pill>{t("unverified")}</Pill>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
