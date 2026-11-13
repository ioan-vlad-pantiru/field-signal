"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { SeasonOutcome, Strategy } from "@/lib/contracts";
import { formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { StatusBadge } from "@/components/ui/badges";
import { CropChip } from "@/components/ui/crop-chip";
import { Sheet } from "@/components/ui/sheet";
import { STATUS_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";

interface Selection {
  strategy: Strategy;
  outcome: SeasonOutcome;
}

/**
 * Hero visual: how each strategy would have fared in every past season.
 * Rows = strategies, columns = seasons; hatched cells have weak evidence.
 */
export function ReplayGrid({ strategies }: { strategies: Strategy[] }) {
  const t = useTranslations("Results.replay");
  const ts = useTranslations("Status");
  const tc = useTranslations("Crops");
  const l = useLocalized();
  const [selected, setSelected] = useState<Selection | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const years = [...new Set(strategies.flatMap((s) => s.replay.map((r) => r.year)))].sort(
    (a, b) => a - b,
  );

  // Start scrolled to the most recent seasons, which matter most to a farmer.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  return (
    <div className="min-w-0">
      <div
        ref={scroller}
        className="relative overflow-x-auto rounded-2xl border border-border bg-surface"
        role="region"
        aria-label={t("scrollLabel")}
        tabIndex={0}
      >
        <table className="border-separate border-spacing-1 p-1">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface" />
              {years.map((year) => (
                <th
                  key={year}
                  scope="col"
                  className="w-10 text-center text-xs font-medium text-muted tabular-nums"
                >
                  {String(year).slice(2)}
                  <span className="sr-only">{year}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {strategies.map((strategy) => {
              const byYear = new Map(strategy.replay.map((r) => [r.year, r]));
              return (
                <tr key={strategy.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 max-w-28 bg-surface pr-2 text-left text-sm font-medium leading-tight shadow-[6px_0_0_var(--surface)]"
                  >
                    {l(strategy.name)}
                  </th>
                  {years.map((year) => {
                    const outcome = byYear.get(year);
                    if (!outcome) return <td key={year} className="h-10 w-10" />;
                    const tone = STATUS_TONE[outcome.status];
                    const Icon = TONE_ICONS[tone];
                    const weak = outcome.evidence_level === "low";
                    return (
                      <td key={year} className="p-0">
                        <button
                          type="button"
                          onClick={() => setSelected({ strategy, outcome })}
                          aria-label={t("cellLabel", {
                            year,
                            crop: tc(outcome.crop),
                            status: ts(outcome.status),
                            evidence: t(`evidence.${outcome.evidence_level}`),
                          })}
                          className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-md ${TONE_CLASSES[tone].solid}`}
                        >
                          {weak ? <span aria-hidden="true" className="hatch absolute inset-0" /> : null}
                          <Icon size={16} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label={t("legend")}>
        {(["good", "watch", "bad", "no_data"] as const).map((status) => {
          const tone = STATUS_TONE[status];
          const Icon = TONE_ICONS[tone];
          return (
            <li key={status} className="flex items-center gap-1.5">
              <span className={`flex h-6 w-6 items-center justify-center rounded ${TONE_CLASSES[tone].solid}`}>
                <Icon size={14} />
              </span>
              {ts(status)}
            </li>
          );
        })}
        <li className="flex items-center gap-1.5">
          <span className="hatch h-6 w-6 rounded border border-border" aria-hidden="true" />
          {t("weakEvidence")}
        </li>
      </ul>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? t("sheetTitle", { year: selected.outcome.year }) : null}
      >
        {selected ? <CellDetails {...selected} /> : null}
      </Sheet>
    </div>
  );
}

function CellDetails({ strategy, outcome }: Selection) {
  const t = useTranslations("Results.replay");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">{l(strategy.name)}</p>
      <div className="flex flex-wrap gap-2">
        <CropChip crop={outcome.crop} />
        <StatusBadge status={outcome.status} />
      </div>
      <p className="text-sm text-muted">
        {t("evidenceLine", { level: t(`evidence.${outcome.evidence_level}`) })}
      </p>
      <div>
        <h3 className="mb-2 font-semibold">{t("reasons")}</h3>
        {outcome.reasons.length === 0 ? (
          <p className="text-muted">{t("noReasons")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {outcome.reasons.map((reason) => (
              <li
                key={reason.code}
                className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2"
              >
                <span>{l(reason.label)}</span>
                {reason.value != null ? (
                  <span className="font-semibold tabular-nums">
                    {formatQuantity(reason.value, reason.unit, locale, unitLabel)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
