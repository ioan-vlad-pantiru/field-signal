"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { Crop, FarmPlan, PlanCheck } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { csvFileName, declarationCsv, yearTotals, type PlanInputField } from "@/lib/farm-plan";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, ChipRow } from "@/components/ui/chip";
import { CropChip, CropDot } from "@/components/ui/crop-chip";
import { AlertIcon, CheckIcon, InfoIcon } from "@/components/ui/icons";
import { ListGroup, ListRow } from "@/components/ui/list";
import { Sheet } from "@/components/ui/sheet";
import { DemoBanner } from "@/components/ui/states";

function useHectares(): (ha: number) => string {
  const locale = useAppLocale();
  return useMemo(() => {
    const format = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { maximumFractionDigits: 1 });
    return (ha: number) => `${format.format(ha)} ha`;
  }, [locale]);
}

const fieldArea = (field: PlanInputField | undefined) => field?.parcels.reduce((s, p) => s + p.area_ha, 0) ?? 0;

/** The plan once made: crops per field (cards on phones, a table from md), totals, checks, the APIA list. */
export function PlanResult({ plan, fields, farmName }: { plan: FarmPlan; fields: PlanInputField[]; farmName: string }) {
  const t = useTranslations("FarmPlan");
  const pick = useLocalized();
  const [notesOpen, setNotesOpen] = useState(false);
  return (
    <>
      {plan.mock ? <DemoBanner origin="api" /> : null}
      <section aria-labelledby="plan-crops" className="flex flex-col gap-3">
        <h2 id="plan-crops" className="text-lg font-semibold">
          {t("tableTitle")}
        </h2>
        <PlanCards plan={plan} fields={fields} />
        <PlanTable plan={plan} fields={fields} />
      </section>
      <TotalsChart plan={plan} />
      <Card>
        <h2 className="mb-2 text-lg font-semibold">{t("checksTitle")}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {plan.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      </Card>
      <Download plan={plan} fields={fields} farmName={farmName} />
      {plan.caveats.length > 0 ? (
        <>
          <ListGroup>
            <ListRow icon={<InfoIcon size={18} />} label={t("caveatsTitle")} onClick={() => setNotesOpen(true)} />
          </ListGroup>
          <Sheet open={notesOpen} onClose={() => setNotesOpen(false)} title={t("caveatsTitle")}>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {plan.caveats.map((caveat, index) => (
                <li key={index}>{pick(caveat)}</li>
              ))}
            </ul>
          </Sheet>
        </>
      ) : null}
    </>
  );
}

/** Phones: one card per field with its crop for each year. */
function PlanCards({ plan, fields }: { plan: FarmPlan; fields: PlanInputField[] }) {
  const pick = useLocalized();
  const ha = useHectares();
  const byId = new Map(fields.map((f) => [f.id, f]));
  return (
    <ul className="flex flex-col gap-2 md:hidden">
      {plan.fields.map((fp) => {
        const field = byId.get(fp.field_id);
        return (
          <li key={fp.field_id} className="rounded-[var(--radius-lg)] bg-surface p-4 shadow-1">
            <p className="font-semibold">{field?.name ?? fp.field_id}</p>
            <p className="text-sm text-ink-muted">
              {ha(fieldArea(field))} · {pick(fp.strategy_name)}
            </p>
            <ol className="mt-3 grid gap-x-3 gap-y-2 sm:grid-cols-2">
              {fp.crops.map((crop, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 text-sm tabular-nums text-ink-muted">{plan.years[index]}</span>
                  <CropChip crop={crop} size="sm" />
                </li>
              ))}
            </ol>
          </li>
        );
      })}
    </ul>
  );
}

/** From md: fields down, years across. Wide plans scroll inside the card, never the page. */
function PlanTable({ plan, fields }: { plan: FarmPlan; fields: PlanInputField[] }) {
  const t = useTranslations("FarmPlan");
  const pick = useLocalized();
  const ha = useHectares();
  const byId = new Map(fields.map((f) => [f.id, f]));
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] bg-surface px-4 shadow-1 max-md:hidden">
      <table className="w-full min-w-max border-separate border-spacing-0 text-left">
        <caption className="sr-only">{t("tableTitle")}</caption>
        <thead>
          <tr className="text-sm text-ink-muted">
            <th scope="col" className="sticky left-0 z-10 bg-surface py-3 pr-4 font-normal">
              {t("field")}
            </th>
            {plan.years.map((year) => (
              <th key={year} scope="col" className="px-2 py-3 font-normal tabular-nums">
                {year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plan.fields.map((fp) => {
            const field = byId.get(fp.field_id);
            return (
              <tr key={fp.field_id} className="align-top">
                <th scope="row" className="sticky left-0 z-10 max-w-[13rem] border-t border-line bg-surface py-3 pr-4 font-normal">
                  <span className="block font-semibold">{field?.name ?? fp.field_id}</span>
                  <span className="block text-sm text-ink-muted">
                    {ha(fieldArea(field))} · {pick(fp.strategy_name)}
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
  );
}

function TotalsChart({ plan }: { plan: FarmPlan }) {
  const t = useTranslations("FarmPlan");
  const tc = useTranslations("Crops");
  const ha = useHectares();
  const crops: Crop[] = [];
  for (const total of plan.totals) if (total.area_ha > 0 && !crops.includes(total.crop)) crops.push(total.crop);

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("totalsTitle")}</h2>
      <ul className="mb-4 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label={t("legend")}>
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
                <span className="font-semibold tabular-nums">{year}</span>
                <span className="text-sm tabular-nums text-ink-muted">{ha(sum)}</span>
              </p>
              <div className="flex h-5 w-full gap-[2px] overflow-hidden rounded-[var(--radius-xs)]" aria-hidden="true">
                {rows.map((row) => (
                  <span
                    key={row.crop}
                    title={`${tc(row.crop)}: ${ha(row.area_ha)}`}
                    className="h-full min-w-[3px]"
                    style={{ width: `${(row.area_ha / sum) * 100}%`, background: CROP_COLORS[row.crop] }}
                  />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {rows.map((row) => (
                  <li key={row.crop} className="flex items-center gap-1.5">
                    <CropDot crop={row.crop} />
                    <span>{tc(row.crop)}</span>
                    <span className="tabular-nums text-ink-muted">
                      {ha(row.area_ha)} · {Math.round((row.area_ha / sum) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function CheckRow({ check }: { check: PlanCheck }) {
  const t = useTranslations("FarmPlan");
  const pick = useLocalized();
  return (
    <li className="flex gap-3 py-3 first:pt-1 last:pb-0">
      <span
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-pill ${
          check.ok ? "bg-status-good-tint text-status-good" : "bg-status-bad-tint text-status-bad"
        }`}
      >
        {check.ok ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
      </span>
      <div>
        <p className="font-semibold">
          <span className="sr-only">{check.ok ? t("checkOk") : t("checkNotOk")}: </span>
          {pick(check.title)}
        </p>
        <p className={`text-sm font-semibold ${check.ok ? "text-status-good" : "text-status-bad"}`} aria-hidden="true">
          {check.ok ? t("checkOk") : t("checkNotOk")}
        </p>
        <p className="mt-1 text-ink-muted">{pick(check.detail)}</p>
      </div>
    </li>
  );
}

/** The APIA list as CSV (semicolon, BOM; see declarationCsv), for one year of the plan. */
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
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{t("downloadTitle")}</h2>
        <p className="mt-0.5 text-sm text-ink-muted">{t("downloadNote")}</p>
      </div>
      {plan.years.length > 1 ? (
        <ChipRow label={t("downloadYear")}>
          {plan.years.slice(0, 4).map((y) => (
            <Chip key={y} selected={y === shown} onClick={() => setYear(y)} className="tabular-nums">
              {y}
            </Chip>
          ))}
        </ChipRow>
      ) : null}
      <Button variant="secondary" onClick={download} className="w-full sm:w-fit">
        {t("download", { year: shown })}
      </Button>
    </Card>
  );
}
