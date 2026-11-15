"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { mockStocks } from "@/lib/mocks";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { AMBER_DAYS, RED_DAYS, TARGET_DAYS, WEIGHTS, assessPath, type PathId } from "@/lib/stocks";
import { buttonClass } from "@/components/ui/button";
import { Chip, ChipRow } from "@/components/ui/chip";
import { BookIcon, PrintIcon } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/info-tip";
import { ListGroup, ListRow } from "@/components/ui/list";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Sheet } from "@/components/ui/sheet";
import { DemoBanner, EmptyState } from "@/components/ui/states";
import { GapCard } from "./gap-card";
import { InventoryCards, InventoryTable } from "./inventory-table";
import { SupplierPanel } from "./supplier-panel";

const PATHS: readonly PathId[] = ["A", "B"];

/**
 * Buyers › Stocks: days of cover per ingredient, and which countries can refill it to 90 days.
 * The data are a built-in demo scenario, so there is nothing to load.
 */
export function StocksView({ initialPath = "A", onPath }: { initialPath?: PathId; onPath?: (path: PathId) => void }) {
  const t = useTranslations("Stocks");
  const l = useLocalized();
  const locale = useAppLocale();
  const s = mockStocks;
  const [path, setPath] = useState<PathId>(initialPath);
  const [openId, setOpenId] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const rows = assessPath(s, path);
  const open = rows.find((a) => a.row.id === openId) ?? null;
  // "Smart Feed (pet food)" → "Smart Feed" on the chip; the sheet and report keep the full name.
  const shortName = (p: PathId) => l(s.paths[p].name).split(" (")[0];
  const format = useFormatter();
  // "2026-11-15" read as a calendar date, shown the local way ("15 Nov 2026", "15 nov. 2026").
  const asOf = format.dateTime(new Date(`${s.as_of.slice(0, 10)}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const tonnes = (value: number) => t("tonnes", { value: formatNumber(value, locale, 0) });

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        title={t("title")}
        meta={t("meta", { date: asOf })}
        actions={
          <Link
            href={{ pathname: "/stocks/report", query: { path } }}
            locale="ro"
            aria-label={t("reportLabel")}
            title={t("reportLabel")}
            className={buttonClass("secondary", "md", "px-3")}
          >
            <PrintIcon size={18} />
            {t("report")}
          </Link>
        }
      />
      <DemoBanner origin="api" />

      <ChipRow label={t("pathLabel")}>
        {PATHS.map((p) => (
          <Chip
            key={p}
            selected={p === path}
            title={l(s.paths[p].name)}
            onClick={() => {
              setPath(p);
              setOpenId(null);
              onPath?.(p);
            }}
          >
            {shortName(p)}
          </Chip>
        ))}
      </ChipRow>

      {rows.length === 0 ? (
        <EmptyState>{t("empty")}</EmptyState>
      ) : (
        <>
          <GapCard scenario={s} rows={rows} onOpen={setOpenId} />
          <section aria-labelledby="stocks-inventory" className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 id="stocks-inventory" className="text-lg font-semibold">
                {t("inventoryTitle")}
              </h2>
              <InfoTip label={t("legendLabel")}>
                {t("legend", { red: RED_DAYS, amber: AMBER_DAYS, target: TARGET_DAYS })}
              </InfoTip>
            </div>
            <InventoryCards rows={rows} onOpen={setOpenId} className="md:hidden" />
            <InventoryTable rows={rows} onOpen={setOpenId} className="max-md:hidden" />
          </section>
        </>
      )}

      <ListGroup>
        <ListRow icon={<BookIcon size={18} />} label={t("about")} onClick={() => setAbout(true)} />
      </ListGroup>

      <Sheet
        open={open !== null}
        onClose={() => setOpenId(null)}
        title={open ? t("supplyTitle", { name: l(open.row.name) }) : ""}
        subtitle={
          open
            ? open.shortfall_t > 0
              ? t("shortfall", { tonnes: tonnes(open.shortfall_t), target: TARGET_DAYS })
              : t("noShortfall", { target: TARGET_DAYS })
            : undefined
        }
        snap
      >
        {open ? <SupplierPanel key={open.row.id} scenario={s} path={path} assessment={open} /> : null}
      </Sheet>

      <Sheet open={about} onClose={() => setAbout(false)} title={t("about")} snap>
        <div className="flex flex-col gap-5">
          <section>
            <p>{l(s.scenario)}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {t("context", { date: asOf, year: s.marketing_year, window: l(s.window) })}
            </p>
          </section>
          <section>
            <h3 className="font-semibold">{t("methodTitle")}</h3>
            <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-sm">
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
          </section>
        </div>
      </Sheet>
    </div>
  );
}
