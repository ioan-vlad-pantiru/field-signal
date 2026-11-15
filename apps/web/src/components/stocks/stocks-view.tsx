"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { mockStocks } from "@/lib/mocks";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { TARGET_DAYS, assessPath, type PathId } from "@/lib/stocks";
import { PrintIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui/states";
import { IngredientList } from "./ingredient-list";
import { CAPSULE, StocksHero } from "./stocks-hero";
import { SupplierPanel } from "./supplier-panel";

const PATHS: readonly PathId[] = ["A", "B"];

/**
 * Buyers › Stocks: the ingredient that runs out first, every ingredient's days of cover, and which
 * countries can refill each one to 90 days. The data are a built-in demo scenario, so there is nothing
 * to load. Wide screens put the hero beside the list; it stays in view while the list scrolls.
 */
export function StocksView({ path, onPath }: { path: PathId; onPath: (path: PathId) => void }) {
  const t = useTranslations("Stocks");
  const l = useLocalized();
  const locale = useAppLocale();
  const s = mockStocks;
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = assessPath(s, path);
  const open = rows.find((a) => a.row.id === openId) ?? null;
  // "2026-11-15" read as a calendar date; the runway counts days from it.
  const asOf = new Date(`${s.as_of.slice(0, 10)}T00:00:00Z`);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[2.5rem] font-bold leading-[1.08] tracking-[-0.032em]">{t("title")}</h1>
        <Link
          href={{ pathname: "/stocks/report", query: { path } }}
          locale="ro"
          aria-label={t("reportLabel")}
          title={t("reportLabel")}
          className={`no-print ${CAPSULE}`}
        >
          <PrintIcon size={18} />
          {t("report")}
        </Link>
      </header>

      <div className="grid gap-y-10 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-20">
        <Segmented
          label={t("pathLabel")}
          value={path}
          onChange={(next) => {
            setOpenId(null);
            onPath(next);
          }}
          // "Smart Feed (pet food)" → "Smart Feed"; the report keeps the full name.
          options={PATHS.map((p) => ({ value: p, label: l(s.paths[p].name).split(" (")[0] }))}
          className="w-full sm:w-80 lg:col-start-1 lg:row-start-1"
        />
        {rows.length === 0 ? (
          <EmptyState>{t("empty")}</EmptyState>
        ) : (
          <>
            <StocksHero
              scenario={s}
              rows={rows}
              asOf={asOf}
              onOpen={setOpenId}
              className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
            />
            {/* Keyed by line so the meters grow again on a switch. */}
            <IngredientList key={path} rows={rows} onOpen={setOpenId} className="lg:col-start-1 lg:row-start-2" />
          </>
        )}
      </div>

      <Sheet
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? l(open.row.name) : ""}
        subtitle={
          open
            ? open.shortfall_t > 0
              ? t("shortfall", { tonnes: t("tonnes", { value: formatNumber(open.shortfall_t, locale, 0) }), target: TARGET_DAYS })
              : t("noShortfall", { target: TARGET_DAYS })
            : undefined
        }
        snap
      >
        {open ? <SupplierPanel key={open.row.id} scenario={s} path={path} assessment={open} asOf={asOf} /> : null}
      </Sheet>
    </div>
  );
}
