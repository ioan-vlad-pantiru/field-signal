"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { mockStocks } from "@/lib/mocks";
import { useLocalized } from "@/lib/localized";
import { AMBER_DAYS, RED_DAYS, TARGET_DAYS, WEIGHTS, assessPath, type PathId } from "@/lib/stocks";
import { buttonClass } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { NoticeBar } from "@/components/ui/notice-bar";
import { Segmented } from "@/components/ui/segmented";
import { InventoryTable } from "./inventory-table";
import { SupplierPanel } from "./supplier-panel";

const PATHS: readonly PathId[] = ["A", "B"];

/** Buyer tab: days of stock cover per ingredient, and which countries can refill it to 90 days. */
export function StocksView({ initialPath = "A", onPath }: { initialPath?: PathId; onPath?: (path: PathId) => void }) {
  const t = useTranslations("Stocks");
  const l = useLocalized();
  const s = mockStocks;
  const [path, setPath] = useState<PathId>(initialPath);
  // null = the most exposed row (assessPath sorts by days of cover, lowest first).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = assessPath(s, path);
  const selected = rows.find((a) => a.row.id === selectedId) ?? rows[0];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mt-2 max-w-[60ch] text-lg text-ink-muted">{t("intro")}</p>
      </header>

      <NoticeBar>
        {t("demo")} {l(s.scenario)}
      </NoticeBar>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Segmented
          label={t("pathLabel")}
          value={path}
          onChange={(next) => {
            setPath(next);
            setSelectedId(null);
            onPath?.(next);
          }}
          className="w-full sm:w-auto"
          options={PATHS.map((p) => ({
            value: p,
            // Phones drop the "(…)" part; screen readers always get the full name.
            label: (
              <>
                <span aria-hidden className="sm:hidden">{l(s.paths[p].name).split(" (")[0]}</span>
                <span className="sr-only sm:not-sr-only">{l(s.paths[p].name)}</span>
              </>
            ),
          }))}
        />
        <p className="text-sm text-ink-muted">
          {t("context", { date: s.as_of, year: s.marketing_year, window: l(s.window) })}
        </p>
      </div>

      <InventoryTable rows={rows} selectedId={selected?.row.id ?? null} onSelect={setSelectedId} />

      {selected ? <SupplierPanel scenario={s} path={path} assessment={selected} /> : null}

      <Disclosure summary={<span className="text-lg font-semibold">{t("methodTitle")}</span>}>
        <ul className="flex max-w-[70ch] list-disc flex-col gap-2 pl-5 text-ink-muted">
          <li>{t("method.cover", { red: RED_DAYS, amber: AMBER_DAYS })}</li>
          <li>{t("method.shortfall", { target: TARGET_DAYS })}</li>
          <li>
            {t("method.score", {
              coverage: Math.round(WEIGHTS.coverage * 100),
              reliability: Math.round(WEIGHTS.reliability * 100),
              logistics: Math.round(WEIGHTS.logistics * 100),
              friction: Math.round(WEIGHTS.friction * 100),
            })}
          </li>
          <li>{t("method.coverage")}</li>
          <li>{t("method.reliability")}</li>
          <li>{t("method.logistics")}</li>
          <li>{t("method.friction")}</li>
          <li>{t("method.allocation")}</li>
          <li>{t("method.assumptions")}</li>
        </ul>
      </Disclosure>

      <div className="no-print">
        <Link
          href={{ pathname: "/stocks/report", query: { path } }}
          locale="ro"
          className={buttonClass("primary", "lg", "w-full sm:w-auto")}
        >
          {t("report")}
        </Link>
      </div>
    </div>
  );
}
