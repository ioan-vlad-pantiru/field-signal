"use client";

import { useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { AMBER_DAYS, RED_DAYS, TARGET_DAYS, type CoverStatus, type RowAssessment } from "@/lib/stocks";
import { TONE_CLASSES, TONE_ICONS, type Tone } from "@/components/ui/tone";

const COVER_TONE: Record<CoverStatus, Tone> = { red: "bad", amber: "watch", ok: "good" };

/** Status as icon + text, never colour alone. */
export function CoverBadge({ status }: { status: CoverStatus }) {
  const t = useTranslations("Stocks.status");
  const tone = COVER_TONE[status];
  const Icon = TONE_ICONS[tone];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-medium ${TONE_CLASSES[tone].soft} ${TONE_CLASSES[tone].text}`}
    >
      <Icon size={16} />
      <span className="text-ink">{t(status)}</span>
    </span>
  );
}

export function InventoryTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: RowAssessment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("Stocks");
  const locale = useAppLocale();
  const l = useLocalized();
  const tonnes = (value: number) => t("tonnes", { value: formatNumber(value, locale, 0) });
  // Secondary columns show from tablets up; on phones they sit under the ingredient name.
  const secondary = "hidden px-2 py-2 text-right tabular-nums md:table-cell";

  return (
    <section aria-labelledby="stocks-inventory" className="flex flex-col gap-3">
      <div>
        <h2 id="stocks-inventory" className="text-xl font-semibold tracking-tight">
          {t("inventoryTitle")}
        </h2>
        <p className="mt-1 text-ink-muted">{t("inventoryHint")}</p>
      </div>
      <table className="w-full text-left">
        <caption className="sr-only">{t("inventoryCaption")}</caption>
        <thead className="text-sm text-ink-muted">
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-2 font-medium">
              {t("col.ingredient")}
            </th>
            <th scope="col" className={`${secondary} font-medium`}>
              {t("col.stock")}
            </th>
            <th scope="col" className={`${secondary} font-medium`}>
              {t("col.use")}
            </th>
            <th scope="col" className={`${secondary} font-medium`}>
              {t("col.incoming")}
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              {t("col.cover")}
            </th>
            <th scope="col" className="hidden py-2 pl-2 font-medium md:table-cell">
              {t("col.status")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const selected = a.row.id === selectedId;
            const name = l(a.row.name);
            return (
              <tr
                key={a.row.id}
                onClick={() => onSelect(a.row.id)}
                className={`cursor-pointer border-b border-line ${selected ? "bg-surface-sunken" : "hover:bg-surface-sunken"}`}
              >
                <td className="py-1 pr-2">
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(a.row.id);
                    }}
                    className="min-h-11 w-full rounded-lg py-1 pl-1 text-left"
                  >
                    <span className={`block ${selected ? "font-semibold" : "font-medium"}`}>{name}</span>
                    <span className="block text-sm tabular-nums text-ink-muted md:hidden">
                      {t("rowDetail", {
                        stock: tonnes(a.row.stock_t),
                        use: tonnes(a.row.monthly_use_t),
                        incoming: tonnes(a.row.incoming_t),
                      })}
                    </span>
                  </button>
                </td>
                <td className={secondary}>{tonnes(a.row.stock_t)}</td>
                <td className={secondary}>{tonnes(a.row.monthly_use_t)}</td>
                <td className={secondary}>{tonnes(a.row.incoming_t)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right font-semibold tabular-nums">
                  {Number.isFinite(a.cover_days) ? t("days", { days: Math.floor(a.cover_days) }) : "—"}
                  {/* Phones: the status sits under the days, so the name column keeps its width. */}
                  <span className="mt-1 flex justify-end font-normal md:hidden">
                    <CoverBadge status={a.status} />
                  </span>
                </td>
                <td className="hidden py-1 pl-2 md:table-cell">
                  <CoverBadge status={a.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-sm text-ink-muted">
        {t("legend", { red: RED_DAYS, amber: AMBER_DAYS, target: TARGET_DAYS })}
      </p>
    </section>
  );
}
