"use client";

import { useTranslations } from "next-intl";
import type { FieldAnalysis } from "@/lib/contracts";
import type { Shift } from "@/lib/results";
import { Disclosure } from "@/components/ui/disclosure";
import { Sheet } from "@/components/ui/sheet";
import { Caveats, IndicatorList, Soil, Sources } from "./evidence";
import { Glossary } from "./glossary";
import { ShiftList } from "./shift";

/**
 * The data behind the answer, one tap from the verdict or a rotation: what changed at this place,
 * what was measured, the soil, what to keep in mind, the terms, and every source.
 */
export function DataSheet({
  open,
  onClose,
  analysis,
  shifts,
}: {
  open: boolean;
  onClose: () => void;
  analysis: FieldAnalysis;
  shifts: Shift[];
}) {
  const t = useTranslations("Results.evidence");
  return (
    <Sheet open={open} onClose={onClose} snap title={t("title")} subtitle={t("period", { start: analysis.period_start, end: analysis.period_end })}>
      <div className="flex flex-col pb-2">
        {shifts.length > 0 ? (
          <Disclosure summary={t("changed")} defaultOpen>
            <ShiftList shifts={shifts} />
          </Disclosure>
        ) : null}
        <Disclosure summary={t("measured")} defaultOpen={shifts.length === 0}>
          <IndicatorList analysis={analysis} />
        </Disclosure>
        <Disclosure summary={t("soil")}>
          <Soil soil={analysis.soil} />
        </Disclosure>
        <Disclosure summary={t("caveats")}>
          <Caveats analysis={analysis} />
        </Disclosure>
        <Disclosure summary={t("terms")}>
          <Glossary />
        </Disclosure>
        <Disclosure summary={t("sources")}>
          <Sources analysis={analysis} />
        </Disclosure>
      </div>
    </Sheet>
  );
}
