"use client";

import { useTranslations } from "next-intl";
import { formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import type { Shift } from "@/lib/results";
import { useUnitLabel } from "@/lib/use-unit-label";
import { Sparkline } from "@/components/ui/charts";
import { SourceChip } from "@/components/ui/source-chip";

const ARROW = { up: "↑", down: "↓", steady: "→" } as const;

/** What changed at this place: early and recent means, stated with both periods, no causes. */
export function ShiftList({ shifts }: { shifts: Shift[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-8 md:grid-cols-3">
      {shifts.map((shift) => (
        <ShiftItem key={shift.indicator.id} shift={shift} />
      ))}
    </ul>
  );
}

function ShiftItem({ shift }: { shift: Shift }) {
  const t = useTranslations("Results.shift");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();
  const { indicator, early, recent, direction } = shift;
  const fmt = (v: number) => formatQuantity(v, indicator.unit, locale, unitLabel);
  const name = l(indicator.label);
  const years = indicator.series.map((p) => p.year);

  return (
    <li className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">{name}</h3>
        <p className="text-sm text-ink-muted">
          <span aria-hidden="true">{ARROW[direction]} </span>
          {t(direction)}
        </p>
      </div>
      <p className="tabular-nums">
        {t("statement", {
          recent: fmt(recent.mean),
          recentStart: recent.start,
          recentEnd: recent.end,
          early: fmt(early.mean),
          earlyStart: early.start,
          earlyEnd: early.end,
        })}
      </p>
      <div>
        <Sparkline
          series={indicator.series}
          baseline={early.mean}
          label={t("sparklineLabel", { name, from: years[0], to: years.at(-1) ?? "" })}
        />
        <div aria-hidden="true" className="flex justify-between text-xs tabular-nums text-ink-muted">
          <span>{years[0]}</span>
          <span>{years.at(-1)}</span>
        </div>
      </div>
      <SourceChip source={indicator.source} />
    </li>
  );
}
