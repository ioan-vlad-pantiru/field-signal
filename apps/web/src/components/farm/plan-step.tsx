"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DEFAULT_LEVELS, PrioritiesStep, weightsFrom, type PriorityLevels } from "@/components/farmer/steps/priorities-step";
import { ActionBar } from "@/components/ui/action-bar";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { FarmPlan, FarmPlanRequest } from "@/lib/contracts";
import { nextSeason, plannableFields, postFarmPlan, toPlanField, type PlanInputField } from "@/lib/farm-plan";
import { PlanResult } from "./plan-results";
import { StepCount } from "./step-count";

export type { PlanInputField };

const PLAN_YEARS = 4;

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; plan: FarmPlan; fields: PlanInputField[] };

/**
 * Step 3: the whole-farm plan. What matters (the same toggles as a single field), then one
 * synchronous `POST /v1/farm/plan` that staggers each field's rotation across the farm.
 */
export function PlanStep({
  fields,
  declaredCrops,
  farmName,
  onBack,
}: {
  fields: PlanInputField[];
  declaredCrops: Record<number, string>;
  farmName: string;
  onBack: () => void;
}) {
  const t = useTranslations("FarmPlan");
  const tf = useTranslations("Farm");
  const [levels, setLevels] = useState<PriorityLevels>(DEFAULT_LEVELS);
  const [irrigated, setIrrigated] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  const startYear = useMemo(() => nextSeason(), []);
  const ready = useMemo(() => plannableFields(fields), [fields]);
  const pending = useRef<AbortController | null>(null);
  const results = useRef<HTMLDivElement>(null);

  async function makePlan() {
    if (ready.length === 0) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ status: "loading" });
    const request: FarmPlanRequest = {
      fields: ready.map((f) => toPlanField(f, declaredCrops)) as FarmPlanRequest["fields"],
      priorities: weightsFrom(levels),
      irrigated,
      start_year: startYear,
      years: PLAN_YEARS,
    };
    try {
      const plan = await postFarmPlan(request, controller.signal);
      if (controller.signal.aborted) return;
      setState({ status: "done", plan, fields: ready });
      requestAnimationFrame(() => results.current?.focus());
    } catch {
      if (!controller.signal.aborted) setState({ status: "error" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        back={
          <IconButton label={tf("backToGroups")} variant="filled" onClick={onBack}>
            <ArrowLeftIcon size={20} />
          </IconButton>
        }
        title={t("title")}
        meta={ready.length > 0 ? t("summary", { count: ready.length, from: startYear, to: startYear + PLAN_YEARS - 1 }) : undefined}
      />

      {ready.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <>
          <Card>
            <h2 className="mb-1 text-sm font-semibold text-ink-muted">{t("priorities")}</h2>
            <PrioritiesStep
              levels={levels}
              onLevels={setLevels}
              irrigated={irrigated}
              onIrrigated={setIrrigated}
              fieldCount={Math.max(1, ready.length)}
            />
          </Card>

          <div ref={results} tabIndex={-1} aria-live="polite" className="flex flex-col gap-5 outline-none">
            {state.status === "loading" ? (
              <div className="flex flex-col gap-3" role="status">
                <p className="text-ink-muted">{t("loading")}</p>
                <Skeleton className="h-40" />
                <Skeleton className="h-32" />
              </div>
            ) : null}
            {state.status === "error" ? <ErrorState onRetry={makePlan}>{t("error")}</ErrorState> : null}
            {state.status === "done" ? <PlanResult plan={state.plan} fields={state.fields} farmName={farmName} /> : null}
          </div>
        </>
      )}

      <ActionBar>
        <StepCount step={3} />
        <Button size="lg" onClick={makePlan} disabled={ready.length === 0 || state.status === "loading"} className="flex-1">
          {state.status === "done" ? t("remake") : t("make")}
        </Button>
      </ActionBar>
    </div>
  );
}
