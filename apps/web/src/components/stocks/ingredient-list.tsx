"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { TARGET_DAYS, type RowAssessment } from "@/lib/stocks";
import { ChevronRightIcon } from "@/components/ui/icons";
import { at } from "./runway";

/**
 * Every ingredient on the line, most exposed first: stock and use, a days-of-cover meter with the
 * 90-day notch, and the days. Only critical rows take colour. A row opens that ingredient's suppliers.
 */
export function IngredientList({
  rows,
  onOpen,
  className = "",
}: {
  rows: RowAssessment[];
  onOpen: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations("Stocks");
  const locale = useAppLocale();
  const l = useLocalized();
  const tonnes = (value: number) => t("tonnes", { value: formatNumber(value, locale, 0) });

  return (
    <section aria-labelledby="stocks-list" className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3">
        <h2 id="stocks-list" className="text-xl font-semibold tracking-[-0.016em]">
          {t("inventoryTitle")}
        </h2>
        <p className="text-xs text-ink-muted">{t("listCaption", { target: TARGET_DAYS })}</p>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((a, i) => {
          const days = Math.floor(a.cover_days);
          const red = a.status === "red";
          return (
            <li key={a.row.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onOpen(a.row.id)}
                className="press grid w-full grid-cols-[minmax(0,1fr)_4.5rem_0.75rem] items-center gap-x-4 gap-y-3 py-4 text-left sm:grid-cols-[minmax(0,1fr)_minmax(5rem,9rem)_4.75rem_0.75rem]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{l(a.row.name)}</span>
                  <span className="block text-sm text-ink-muted tabular-nums">
                    {t("rowMeta", { stock: tonnes(a.row.stock_t), use: tonnes(a.row.monthly_use_t) })}
                  </span>
                </span>
                <span aria-hidden="true" className="relative col-span-full row-start-2 h-1.5 rounded-full bg-surface-sunken sm:col-span-1 sm:row-start-auto">
                  <span
                    className={`grow-x absolute inset-y-0 left-0 rounded-full ${red ? "bg-status-bad" : "bg-ink-muted"}`}
                    style={{ width: at(days), "--i": i } as CSSProperties}
                  />
                  <span className="absolute -inset-y-1 left-3/4 w-px bg-ink-muted" />
                </span>
                <span className="text-right tabular-nums">
                  <span aria-hidden="true" className={`block text-xl font-semibold leading-tight tracking-[-0.02em] ${red ? "text-status-bad" : ""}`}>
                    {days}
                  </span>
                  <span className="sr-only">{t("days", { days })}, </span>
                  <span className="block text-xs text-ink-muted">{t(`status.${a.status}`)}</span>
                </span>
                <ChevronRightIcon size={14} className="text-ink-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
