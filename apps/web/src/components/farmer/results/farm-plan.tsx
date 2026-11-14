"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DataOrigin, Loaded } from "@/lib/api";
import type { FarmPlan, FarmPlanResponse, RuleCheck } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
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

export type FarmPlanState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; result: Loaded<FarmPlanResponse> };

const BREAKDOWN = ["yield_stability", "water", "soil_health", "low_risk"] as const;

function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex w-fit items-center rounded-full border border-line px-2.5 py-1 text-sm">{children}</span>;
}

/**
 * All submitted fields planned together (`POST /v1/farm/plan`), below the per-field results. Its own
 * loading and error state: a slow solve or a rejected request never touches the per-field results.
 */
export function FarmPlanSection({ state, names }: { state: FarmPlanState; names: string[] }) {
  const t = useTranslations("FarmPlan");
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
        <NoticeBar>{t("error")}</NoticeBar>
      ) : (
        <FarmPlanBody data={state.result.data} origin={state.result.origin} names={names} />
      )}
    </Section>
  );
}

function FarmPlanBody({ data, origin, names }: { data: FarmPlanResponse; origin: DataOrigin; names: string[] }) {
  const t = useTranslations("FarmPlan");
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

/** One plan: title, score against today's rotation, weather spread, area split, then the details. */
function PlanView({
  plan,
  current,
  fieldName,
}: {
  plan: FarmPlan;
  current: FarmPlan | null;
  fieldName: (id: string) => string;
}) {
  const t = useTranslations("FarmPlan");
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
  const fieldIds = [...new Set(plan.allocations.map((a) => a.field_id))];
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
        <h4 className="font-semibold">{t("areaSplit")}</h4>
        <p className="text-sm text-ink-muted">{t("areaSplitHint")}</p>
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {fieldIds.map((id) => (
            <li key={id} className="flex flex-col gap-1.5 py-2">
              <p className="font-medium">{fieldName(id)}</p>
              {plan.allocations
                .filter((a) => a.field_id === id)
                .map((a, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-16 shrink-0 pt-0.5 tabular-nums">{t("ha", { ha: formatNumber(a.area_ha, locale, 1) })}</span>
                    <CropSequence sequence={a.sequence} />
                  </div>
                ))}
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

function YearShares({ plan }: { plan: FarmPlan }) {
  const t = useTranslations("FarmPlan");
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

function Rules({ rules }: { rules: RuleCheck[] }) {
  const t = useTranslations("FarmPlan.rules");
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
              <ToneBadge tone={rule.passed ? "good" : "watch"} label={t(rule.passed ? "within" : "outside")} />
              <Pill>{t(rule.applies ? "applied" : "notApplied")}</Pill>
              {rule.verified ? null : <Pill>{t("unverified")}</Pill>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
