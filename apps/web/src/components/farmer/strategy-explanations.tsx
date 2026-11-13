"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { formatQuantity } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useUnitLabel } from "@/lib/use-unit-label";
import { AgronomistBadge } from "@/components/ui/badges";
import { Card } from "@/components/ui/card";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 font-semibold">{title}</h4>
      {children}
    </div>
  );
}

/** One strategy at a time, picked from a tab row, so the text stays readable on a phone. */
export function StrategyExplanations({ strategies }: { strategies: Strategy[] }) {
  const t = useTranslations("Results.explain");
  const locale = useAppLocale();
  const l = useLocalized();
  const unitLabel = useUnitLabel();
  const [activeId, setActiveId] = useState(strategies[0].id);
  const active = strategies.find((s) => s.id === activeId) ?? strategies[0];
  const { explanation } = active;

  return (
    <Card>
      <div role="tablist" aria-label={t("tabsLabel")} className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1">
        {strategies.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={s.id === active.id}
            aria-controls="explanation-panel"
            onClick={() => setActiveId(s.id)}
            className={`min-h-11 shrink-0 rounded-full border px-4 font-medium ${
              s.id === active.id
                ? "border-field bg-field text-on-field"
                : "border-line bg-surface hover:border-field"
            }`}
          >
            {l(s.name)}
          </button>
        ))}
      </div>

      <div
        key={active.id}
        id="explanation-panel"
        role="tabpanel"
        aria-labelledby={`tab-${active.id}`}
        className="rise flex flex-col gap-5"
      >
        <Block title={t("why")}>
          <p>{l(explanation.why)}</p>
        </Block>

        <Block title={t("evidence")}>
          <ul className="flex flex-col gap-2">
            {explanation.evidence.map((e, i) => (
              <li key={i} className="rounded-xl bg-surface-sunken px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span>{l(e.text)}</span>
                  {e.value != null ? (
                    <span className="font-semibold tabular-nums">
                      {formatQuantity(e.value, e.unit, locale, unitLabel)}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-ink-muted">{t("source", { source: e.source })}</span>
              </li>
            ))}
          </ul>
        </Block>

        <div className="grid gap-5 sm:grid-cols-2">
          <Block title={t("benefits")}>
            <ul className="list-disc space-y-1 pl-5">
              {explanation.benefits.map((b, i) => (
                <li key={i}>{l(b)}</li>
              ))}
            </ul>
          </Block>
          <Block title={t("gaps")}>
            <ul className="list-disc space-y-1 pl-5">
              {explanation.gaps.map((g, i) => (
                <li key={i}>{l(g)}</li>
              ))}
            </ul>
          </Block>
        </div>

        <Block title={t("risks")}>
          <ul className="flex flex-col gap-2">
            {explanation.risks.map((r, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-xl border border-wheat/40 bg-wheat-tint/40 px-3 py-2">
                <span>{l(r.text)}</span>
                <AgronomistBadge />
              </li>
            ))}
          </ul>
        </Block>

        <p className="text-xs text-ink-muted">{t(`generatedBy.${explanation.generated_by}`)}</p>
      </div>
    </Card>
  );
}
