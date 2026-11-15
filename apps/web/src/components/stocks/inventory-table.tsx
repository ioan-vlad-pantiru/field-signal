"use client";

import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import type { CoverStatus, RowAssessment } from "@/lib/stocks";
import { TONE_CLASSES, TONE_ICONS, type Tone } from "@/components/ui/tone";

const COVER_TONE: Record<CoverStatus, Tone> = { red: "bad", amber: "watch", ok: "good" };

/** Status as icon + word, never colour alone. */
export function CoverBadge({ status }: { status: CoverStatus }) {
  const t = useTranslations("Stocks.status");
  const tone = COVER_TONE[status];
  const Icon = TONE_ICONS[tone];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-1 text-sm ${TONE_CLASSES[tone].soft} ${TONE_CLASSES[tone].text}`}
    >
      <Icon size={16} />
      <span className="text-ink">{t(status)}</span>
    </span>
  );
}

function useCoverDays() {
  const t = useTranslations("Stocks");
  return (a: RowAssessment) => (Number.isFinite(a.cover_days) ? t("days", { days: Math.floor(a.cover_days) }) : "—");
}

/** Phones: one card per ingredient, most exposed first: name and status, days of cover on the right. */
export function InventoryCards({
  rows,
  onOpen,
  className = "",
}: {
  rows: RowAssessment[];
  onOpen: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations("Stocks");
  const l = useLocalized();
  const days = useCoverDays();
  return (
    <ul className={`flex flex-col gap-2 ${className}`} aria-label={t("inventoryCaption")}>
      {rows.map((a) => (
        <li key={a.row.id}>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => onOpen(a.row.id)}
            className="press flex min-h-16 w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-surface px-4 py-3 text-left shadow-1"
          >
            <span className="flex min-w-0 flex-col gap-1.5">
              <span className="truncate font-semibold">{l(a.row.name)}</span>
              <CoverBadge status={a.status} />
            </span>
            <span className="shrink-0 font-display text-2xl font-semibold tabular-nums">{days(a)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Tablets and laptops: stock, use, incoming and cover per ingredient. A row opens its suppliers. */
export function InventoryTable({
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
  const days = useCoverDays();
  const tonnes = (value: number) => t("tonnes", { value: formatNumber(value, locale, 0) });
  const num = "px-2 py-2 text-right tabular-nums";
  const head = "px-2 py-3 font-normal";

  return (
    <div className={`overflow-hidden rounded-[var(--radius-lg)] bg-surface px-2 shadow-1 ${className}`}>
      <table className="w-full text-left">
        <caption className="sr-only">{t("inventoryCaption")}</caption>
        <thead className="text-sm text-ink-muted">
          <tr className="border-b border-line">
            <th scope="col" className={head}>
              {t("col.ingredient")}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {t("col.stock")}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {t("col.use")}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {t("col.incoming")}
            </th>
            <th scope="col" className={`${head} text-right`}>
              {t("col.cover")}
            </th>
            <th scope="col" className={head}>
              {t("col.status")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr
              key={a.row.id}
              onClick={() => onOpen(a.row.id)}
              className="cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-sunken"
            >
              <td className="px-2 py-1">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(a.row.id);
                  }}
                  className="min-h-tap w-full rounded-[var(--radius-sm)] text-left font-semibold hover:underline"
                >
                  {l(a.row.name)}
                </button>
              </td>
              <td className={num}>{tonnes(a.row.stock_t)}</td>
              <td className={num}>{tonnes(a.row.monthly_use_t)}</td>
              <td className={num}>{tonnes(a.row.incoming_t)}</td>
              <td className={`${num} whitespace-nowrap font-semibold`}>{days(a)}</td>
              <td className="px-2 py-1">
                <CoverBadge status={a.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
