"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { DEFAULT_LEVELS, PrioritiesStep, weightsFrom, type PriorityLevels } from "@/components/farmer/steps/priorities-step";
import { Button } from "@/components/ui/button";
import { CropChip, CropDot } from "@/components/ui/crop-chip";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { DemoBanner, EmptyState, ErrorState } from "@/components/ui/states";
import type { Crop, FarmPlan, FarmPlanRequest, PlanCheck } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import {
  csvFileName,
  declarationCsv,
  nextSeason,
  plannableFields,
  postFarmPlan,
  toPlanField,
  yearTotals,
  type PlanInputField,
} from "@/lib/farm-plan";
import { useAppLocale, useLocalized } from "@/lib/localized";

export type { PlanInputField };

const PLAN_YEARS = 4;

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "done"; plan: FarmPlan; fields: PlanInputField[] };

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</section>;
}

function PanelTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <header className="mb-4">
      <h2 className="text-xl font-semibold tracking-tight">{children}</h2>
      {hint ? <p className="mt-1 text-ink-muted">{hint}</p> : null}
    </header>
  );
}

export function PlanStep({
  fields,
  declaredCrops,
  farmName,
}: {
  fields: PlanInputField[];
  declaredCrops: Record<number, string>;
  farmName: string;
}): JSX.Element {
  const t = useTranslations("FarmPlan");
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

  if (ready.length === 0) {
    return <EmptyState>{t("empty")}</EmptyState>;
  }

  const lastYear = startYear + PLAN_YEARS - 1;

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <PrioritiesStep levels={levels} onLevels={setLevels} irrigated={irrigated} onIrrigated={setIrrigated} headingLevel={2} />
        <div className="mt-6 flex flex-col gap-2 border-t border-line pt-5">
          <p className="text-ink-muted">
            {t("summary", { count: ready.length, from: startYear, to: lastYear })}
          </p>
          <Button
            size="lg"
            onClick={makePlan}
            disabled={state.status === "loading"}
            className="w-full sm:w-auto sm:self-start"
          >
            {state.status === "done" ? t("remake") : t("make")}
          </Button>
        </div>
      </Panel>

      <div ref={results} tabIndex={-1} aria-live="polite" className="flex flex-col gap-6 outline-none">
        {state.status === "loading" ? <Loading /> : null}
        {state.status === "error" ? <ErrorState onRetry={makePlan} /> : null}
        {state.status === "done" ? <PlanResult plan={state.plan} fields={state.fields} farmName={farmName} /> : null}
      </div>
    </div>
  );
}

function Loading() {
  const t = useTranslations("FarmPlan");
  return (
    <div className="flex flex-col gap-4" role="status">
      <p className="text-ink-muted">{t("loading")}</p>
      <Skeleton className="h-48" />
      <Skeleton className="h-32" />
    </div>
  );
}

function useHectares(): (ha: number) => string {
  const locale = useAppLocale();
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });
    return (ha: number) => `${format.format(ha)} ha`;
  }, [locale]);
}

function PlanResult({ plan, fields, farmName }: { plan: FarmPlan; fields: PlanInputField[]; farmName: string }) {
  const t = useTranslations("FarmPlan");
  const pick = useLocalized();
  return (
    <>
      {plan.mock ? <DemoBanner origin="api" /> : null}
      <PlanTable plan={plan} fields={fields} />
      <TotalsChart plan={plan} />
      <Panel>
        <PanelTitle>{t("checksTitle")}</PanelTitle>
        <ul className="flex flex-col divide-y divide-line">
          {plan.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      </Panel>
      <Download plan={plan} fields={fields} farmName={farmName} />
      {plan.caveats.length > 0 ? (
        <Panel>
          <PanelTitle>{t("caveatsTitle")}</PanelTitle>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-muted">
            {plan.caveats.map((caveat, index) => (
              <li key={index}>{pick(caveat)}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function PlanTable({ plan, fields }: { plan: FarmPlan; fields: PlanInputField[] }) {
  const t = useTranslations("FarmPlan");
  const pick = useLocalized();
  const ha = useHectares();
  const names = new Map(fields.map((f) => [f.id, f]));
  return (
    <Panel>
      <PanelTitle hint={t("tableHint")}>{t("tableTitle")}</PanelTitle>
      {/* Wide plans scroll inside the card; the page itself never scrolls sideways. */}
      <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
        <table className="w-full min-w-max border-separate border-spacing-0 text-left">
          <caption className="sr-only">{t("tableTitle")}</caption>
          <thead>
            <tr className="text-sm text-ink-muted">
              <th scope="col" className="sticky left-0 z-10 bg-surface py-2 pr-4 font-medium">
                {t("field")}
              </th>
              {plan.years.map((year) => (
                <th key={year} scope="col" className="px-2 py-2 font-medium tabular-nums">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.fields.map((fp) => {
              const field = names.get(fp.field_id);
              const area = field?.parcels.reduce((s, p) => s + p.area_ha, 0) ?? 0;
              return (
                <tr key={fp.field_id} className="align-top">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 max-w-[11rem] border-t border-line bg-surface py-3 pr-4 font-normal"
                  >
                    <span className="block font-medium">{field?.name ?? fp.field_id}</span>
                    <span className="block text-sm text-ink-muted">
                      {ha(area)} · {pick(fp.strategy_name)}
                    </span>
                  </th>
                  {fp.crops.map((crop, index) => (
                    <td key={index} className="border-t border-line px-2 py-3">
                      <CropChip crop={crop} size="sm" />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TotalsChart({ plan }: { plan: FarmPlan }) {
  const t = useTranslations("FarmPlan");
  const tc = useTranslations("Crops");
  const ha = useHectares();
  const crops: Crop[] = [];
  for (const total of plan.totals) if (total.area_ha > 0 && !crops.includes(total.crop)) crops.push(total.crop);

  return (
    <Panel>
      <PanelTitle hint={t("totalsHint")}>{t("totalsTitle")}</PanelTitle>
      <ul className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t("legend")}>
        {crops.map((crop) => (
          <li key={crop} className="flex items-center gap-1.5">
            <CropDot crop={crop} />
            {tc(crop)}
          </li>
        ))}
      </ul>
      <ol className="flex flex-col gap-5">
        {plan.years.map((year) => {
          const rows = yearTotals(plan, year);
          const sum = rows.reduce((s, r) => s + r.area_ha, 0) || 1;
          return (
            <li key={year}>
              <p className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="font-medium tabular-nums">{year}</span>
                <span className="text-sm text-ink-muted tabular-nums">{ha(sum)}</span>
              </p>
              <div className="flex h-5 w-full gap-[2px]" aria-hidden="true">
                {rows.map((row) => (
                  <span
                    key={row.crop}
                    title={`${tc(row.crop)}: ${ha(row.area_ha)}`}
                    className="h-full min-w-[3px] first:rounded-l-[4px] last:rounded-r-[4px]"
                    style={{ width: `${(row.area_ha / sum) * 100}%`, background: CROP_COLORS[row.crop] }}
                  />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {rows.map((row) => (
                  <li key={row.crop} className="flex items-center gap-1.5">
                    <CropDot crop={row.crop} />
                    <span>{tc(row.crop)}</span>
                    <span className="text-ink-muted tabular-nums">
                      {ha(row.area_ha)} · {Math.round((row.area_ha / sum) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function CheckRow({ check }: { check: PlanCheck }) {
  const t = useTranslations("FarmPlan");
  const pick = useLocalized();
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          check.ok ? "bg-status-good-tint text-status-good" : "bg-status-bad-tint text-status-bad"
        }`}
      >
        {check.ok ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
      </span>
      <div>
        <p className="font-medium">
          <span className="sr-only">{check.ok ? t("checkOk") : t("checkNotOk")}: </span>
          {pick(check.title)}
        </p>
        <p className={`text-sm font-medium ${check.ok ? "text-status-good" : "text-status-bad"}`} aria-hidden="true">
          {check.ok ? t("checkOk") : t("checkNotOk")}
        </p>
        <p className="mt-1 text-ink-muted">{pick(check.detail)}</p>
      </div>
    </li>
  );
}

function Download({ plan, fields, farmName }: { plan: FarmPlan; fields: PlanInputField[]; farmName: string }) {
  const t = useTranslations("FarmPlan");
  const [year, setYear] = useState(plan.years[0]);
  const shown = plan.years.includes(year) ? year : plan.years[0];

  function download() {
    const blob = new Blob([declarationCsv(plan, fields, shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFileName(farmName, shown);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Panel>
      <PanelTitle hint={t("downloadHint")}>{t("downloadTitle")}</PanelTitle>
      <div className="flex flex-col gap-3">
        {plan.years.length > 1 ? (
          <Segmented
            label={t("downloadYear")}
            options={plan.years.slice(0, 4).map((y) => ({ value: String(y), label: String(y) }))}
            value={String(shown)}
            onChange={(value) => setYear(Number(value))}
            className="w-full sm:w-auto sm:self-start"
          />
        ) : null}
        <Button variant="secondary" onClick={download} className="w-full sm:w-auto sm:self-start">
          {t("download", { year: shown })}
        </Button>
      </div>
    </Panel>
  );
}
