"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SeasonOutcome, Status, Strategy } from "@/lib/contracts";
import { formatNumber, formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { poorSeasons } from "@/lib/results";
import { useUnitLabel } from "@/lib/use-unit-label";
import { StatusBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { CropChip } from "@/components/ui/crop-chip";
import { CrossIcon } from "@/components/ui/icons";
import { SeasonAxis, SeasonLegend, SeasonStrip } from "@/components/ui/season-strip";
import { Sheet } from "@/components/ui/sheet";
import { CropSequence } from "./crop-sequence";
import { Explanation } from "./explanation";
import { useRotationName } from "./rotation-name";

const STATUS_MARK: Record<Status, { swatch: string; mark: string }> = {
  good: { swatch: "bg-status-good-tint", mark: "" },
  watch: { swatch: "bg-status-watch text-on-status", mark: "!" },
  bad: { swatch: "bg-status-bad text-on-status", mark: "×" },
  no_data: { swatch: "border border-dashed border-line", mark: "" },
};

/**
 * Three rotations on one shared year axis, best fit first. The selected rotation drives the whole
 * page; its row opens to the explanation. On a laptop a year can be selected across all rows; on a
 * phone the strips are an overview and tapping one opens every season as a list.
 */
export function Rotations({
  ranked,
  years,
  start,
  selectedId,
  onSelect,
  laptop,
}: {
  /** Best fit first. */
  ranked: Strategy[];
  years: number[];
  start: number;
  selectedId: string;
  onSelect: (id: string) => void;
  laptop: boolean;
}) {
  const t = useTranslations("Results.rotations");
  const ts = useTranslations("Status");
  const [open, setOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [yearsSheet, setYearsSheet] = useState<string | null>(null);
  const bestId = ranked[0].id;

  function toggle(id: string) {
    if (id === selectedId) setOpen((o) => !o);
    else {
      onSelect(id);
      setOpen(true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col">
        {ranked.map((strategy) => (
          <RotationRow
            key={strategy.id}
            strategy={strategy}
            years={years}
            start={start}
            isBest={strategy.id === bestId}
            selected={strategy.id === selectedId}
            open={open && strategy.id === selectedId}
            onToggle={() => toggle(strategy.id)}
            laptop={laptop}
            selectedYear={laptop ? selectedYear : null}
            onSelectYear={(year) => setSelectedYear((y) => (y === year ? null : year))}
            onOpenYears={() => setYearsSheet(strategy.id)}
          />
        ))}
      </ol>

      <SeasonLegend
        labels={{
          good: ts("good"),
          watch: ts("watch"),
          bad: ts("bad"),
          no_data: ts("no_data"),
          // Only when a season here actually rests on weaker evidence.
          ...(ranked.some((r) => r.replay.some((o) => o.evidence_level === "low"))
            ? { lowEvidence: t("weakEvidence") }
            : {}),
        }}
      />

      {laptop && selectedYear !== null ? (
        <YearPanel year={selectedYear} ranked={ranked} onClose={() => setSelectedYear(null)} />
      ) : null}

      {!laptop ? (
        <Sheet open={yearsSheet !== null} onClose={() => setYearsSheet(null)} title={t("yearsSheetTitle")}>
          <YearsList ranked={ranked} years={years} highlightId={yearsSheet} />
        </Sheet>
      ) : null}
    </div>
  );
}

function RotationRow({
  strategy,
  years,
  start,
  isBest,
  selected,
  open,
  onToggle,
  laptop,
  selectedYear,
  onSelectYear,
  onOpenYears,
}: {
  strategy: Strategy;
  years: number[];
  start: number;
  isBest: boolean;
  selected: boolean;
  open: boolean;
  onToggle: () => void;
  laptop: boolean;
  selectedYear: number | null;
  onSelectYear: (year: number) => void;
  onOpenYears: () => void;
}) {
  const t = useTranslations("Results.rotations");
  const ts = useTranslations("Status");
  const tc = useTranslations("Crops");
  const locale = useAppLocale();
  const name = useRotationName()(strategy);
  const poor = poorSeasons(strategy);
  const panelId = `rotation-${strategy.id}`;
  const stripLabel = t("stripLabel", { name, poor: t("poor", { count: poor, start }) });
  // The current rotation is already named "Your rotation now", so it needs no tag of its own.
  const tags = [isBest ? t("best") : null].filter(Boolean);

  return (
    <li
      className={`border-l-[3px] border-t border-t-line py-5 pl-4 first:border-t-0 ${selected ? "border-l-field" : "border-l-transparent"}`}
    >
      <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-8">
        <div className="flex flex-col gap-2">
          <div>
            <h3 className="text-lg font-semibold leading-snug">{name}</h3>
            {tags.length > 0 || selected ? (
              <p className="text-sm text-ink-muted">
                {[...tags, selected ? t("shown") : null].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
          <CropSequence sequence={strategy.sequence} />
          <p className="tabular-nums">
            <span className="sr-only">{t("scoreLabel")}: </span>
            <span className="font-semibold">{t("score", { score: formatNumber(strategy.score.total, locale, 0) })}</span>
            <span className="text-ink-muted"> · {t("poorShort", { count: poor })}</span>
          </p>
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-1.5">
          {laptop ? (
            <>
              <SeasonStrip
                outcomes={strategy.replay}
                years={years}
                label={stripLabel}
                size="lg"
                animate
                selectedYear={selectedYear}
                onSelectYear={onSelectYear}
                cellLabel={(o) =>
                  t("cellLabel", {
                    year: o.year,
                    crop: tc(o.crop),
                    status: ts(o.status),
                    evidence: t(`evidence.${o.evidence_level}`),
                  })
                }
              />
              <SeasonAxis years={years} selectedYear={selectedYear} />
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenYears}
              aria-label={t("openYears", { name })}
              aria-haspopup="dialog"
              className="-mx-2 flex min-h-11 flex-col justify-center gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-sunken"
            >
              <SeasonStrip outcomes={strategy.replay} years={years} label={stripLabel} size="sm" animate className="w-full" />
              <span aria-hidden="true" className="flex w-full justify-between text-xs tabular-nums text-ink-muted">
                <span>{years[0]}</span>
                <span>{years.at(-1)}</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="press -ml-3 mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 font-medium text-field hover:bg-surface-sunken"
      >
        {open ? t("hideDetails") : t("showDetails")}
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="pt-3">
        {open ? <Explanation strategy={strategy} /> : null}
      </div>
    </li>
  );
}

/** Laptop: the three outcomes of one season, side by side, with their reasons. */
function YearPanel({ year, ranked, onClose }: { year: number; ranked: Strategy[]; onClose: () => void }) {
  const t = useTranslations("Results.rotations");
  const nameOf = useRotationName();
  const ref = useRef<HTMLElement>(null);
  // Bring the outcomes into view without moving focus away from the strip.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [year]);
  return (
    <section ref={ref} aria-labelledby="year-panel" aria-live="polite" className="scroll-mb-6 border-t border-line pt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 id="year-panel" className="text-xl font-semibold tabular-nums">
          {t("yearTitle", { year })}
        </h3>
        <Button variant="quiet" onClick={onClose} aria-label={t("closeYear", { year })}>
          <CrossIcon size={18} />
        </Button>
      </div>
      <ul className="mt-4 grid grid-cols-3 gap-8">
        {ranked.map((strategy) => {
          const outcome = strategy.replay.find((o) => o.year === year);
          return (
            <li key={strategy.id} className="flex flex-col gap-3">
              <p className="font-semibold">{nameOf(strategy)}</p>
              {outcome ? <OutcomeDetails outcome={outcome} /> : <StatusBadge status="no_data" />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function OutcomeDetails({ outcome }: { outcome: SeasonOutcome }) {
  const t = useTranslations("Results.rotations");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <CropChip crop={outcome.crop} size="sm" />
        <StatusBadge status={outcome.status} />
      </div>
      <p className="text-sm text-ink-muted">{t("evidenceLine", { level: t(`evidence.${outcome.evidence_level}`) })}</p>
      {outcome.reasons.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("noReasons")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {outcome.reasons.map((reason) => (
            <li key={reason.code} className="flex items-baseline justify-between gap-3">
              <span>{l(reason.label)}</span>
              {reason.value != null ? (
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatQuantity(reason.value, reason.unit, locale, unitLabel)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Phone: every season top to bottom, newest first, the three rotations side by side. */
function YearsList({ ranked, years, highlightId }: { ranked: Strategy[]; years: number[]; highlightId: string | null }) {
  const t = useTranslations("Results.rotations");
  const ts = useTranslations("Status");
  const tc = useTranslations("CropsShort");
  const l = useLocalized();
  const nameOf = useRotationName();
  const byYear = ranked.map((s) => new Map(s.replay.map((o) => [o.year, o])));

  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <colgroup>
        <col className="w-14" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="sticky -top-4 z-10 border-b border-line bg-surface pb-2 text-left align-bottom font-normal text-ink-muted">
            {t("year")}
          </th>
          {ranked.map((s) => (
            <th
              key={s.id}
              scope="col"
              className={`sticky -top-4 z-10 border-b border-line bg-surface px-1 pb-2 text-left align-bottom font-semibold leading-tight ${
                s.id === highlightId ? "text-ink" : "text-ink-muted"
              }`}
            >
              {nameOf(s)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...years].reverse().map((year) => (
          <tr key={year} className="border-b border-line">
            <th scope="row" className="py-2.5 text-left align-top font-semibold tabular-nums">
              {year}
            </th>
            {byYear.map((map, i) => {
              const outcome = map.get(year);
              const status = outcome?.status ?? "no_data";
              const mark = STATUS_MARK[status];
              const reason = outcome && status !== "good" ? outcome.reasons[0] : undefined;
              return (
                <td key={ranked[i].id} className="px-1 py-2.5 align-top">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-bold leading-none ${mark.swatch} ${
                        outcome?.evidence_level === "low" ? "hatch" : ""
                      }`}
                    >
                      {mark.mark}
                    </span>
                    <span className={status === "good" ? "text-ink-muted" : "font-medium"}>{ts(status)}</span>
                  </span>
                  {outcome ? <span className="block text-xs text-ink-muted">{tc(outcome.crop)}</span> : null}
                  {reason ? <span className="mt-0.5 block text-xs leading-snug">{l(reason.label)}</span> : null}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
