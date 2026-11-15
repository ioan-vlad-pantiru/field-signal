"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { Loaded } from "@/lib/api";
import type { Crop, CropOutlook, SourcingRegion, Zone } from "@/lib/contracts";
import { useAppLocale } from "@/lib/localized";
import { IconButton } from "@/components/ui/button";
import { CrossIcon, PinIcon } from "@/components/ui/icons";
import { ListGroup, ListRow } from "@/components/ui/list";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Sheet } from "@/components/ui/sheet";
import { DemoBanner, EmptyState } from "@/components/ui/states";
import { CommuneCards } from "./commune-cards";
import { CommuneTable } from "./commune-table";
import { ComparePill } from "./compare-pill";
import { CropFilter } from "./crop-filter";
import { FullMap } from "./full-map";
import { RecommendationCard } from "./recommendation-card";
import { RegionMore } from "./region-more";
import { useMediaQuery } from "./use-media-query";
import { ZoneCompare } from "./zone-compare";
import { ZoneMap } from "./zone-map";
import { ZoneDetails } from "./zone-sheet";

/** Tailwind's `lg`: from here the map sits beside the list and a commune opens in a side panel. */
const LAPTOP = "(min-width: 1024px)";

/**
 * Buyers › Region. Phones: headline card, crop chips, a collapsed map card, commune cards, then
 * the track record and the data notes as rows. Laptops: the map and the open commune on the left,
 * the same column with the sortable table on the right.
 */
export function RegionView({ result }: { result: Loaded<SourcingRegion> }) {
  const t = useTranslations("Feed");
  const tc = useTranslations("Crops");
  const tr = useTranslations("Risk");
  const locale = useAppLocale();
  const isLaptop = useMediaQuery(LAPTOP);
  const region = result.data;
  const [crop, setCrop] = useState<Crop>(region.reference_crops[0] ?? "maize");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  const outlookFor = useCallback(
    (zone: Zone): CropOutlook | undefined => zone.crops.find((c) => c.crop === crop),
    [crop],
  );
  const markerLabel = useCallback(
    (zone: Zone, outlook: CropOutlook | undefined) =>
      t("markerLabel", { zone: zone.name, risk: outlook ? tr(outlook.availability.level) : t("noCropData") }),
    [t, tr],
  );
  const select = useCallback((zone: Zone) => setSelectedId(zone.id), []);
  // Ticking a third commune drops the one ticked first, so at most two stay ticked.
  const tick = (id: string) =>
    setTicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-2)));

  const zones = region.zones;
  const hasZones = zones.length > 0;
  const selected = zones.find((z) => z.id === selectedId) ?? null;
  const selectedOutlook = selected ? outlookFor(selected) : undefined;
  const cropName = tc(crop).toLocaleLowerCase(locale);
  const [zoneA, zoneB] = ticked.map((id) => zones.find((z) => z.id === id));
  const detailTitle = selected ? t("sheetTitle", { zone: selected.name, crop: tc(crop) }) : "";
  const details = selected ? (
    selectedOutlook ? (
      <ZoneDetails outlook={selectedOutlook} centroid={selected.centroid} place={selected.name} />
    ) : (
      <p>{t("noCropData")}</p>
    )
  ) : null;
  const map = (className: string) => (
    <ZoneMap
      zones={zones}
      outlookFor={outlookFor}
      markerLabel={markerLabel}
      onSelect={select}
      selectedId={selectedId}
      label={t("mapLabel", { crop: cropName })}
      className={className}
    />
  );
  const listProps = { zones, outlookFor, cropName, selectedId, onSelect: select, ticked, onTick: tick };

  return (
    <div className={`flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8 ${ticked.length > 0 ? "pb-20" : ""}`}>
      <div className="flex flex-col gap-5 lg:col-start-2 lg:row-start-1">
        <ScreenHeader
          title={t("title")}
          meta={t("meta", { region: region.region_name, season: region.season, count: zones.length })}
        />
        {region.mock ? <DemoBanner origin={result.origin} /> : null}
        <RecommendationCard recommendation={region.recommendation} />
        <CropFilter
          crops={region.reference_crops}
          value={crop}
          onChange={setCrop}
          zones={zones}
          outlookFor={outlookFor}
          cropName={cropName}
        />

        {hasZones ? (
          <>
            <ListGroup className="lg:hidden">
              <ListRow
                icon={<PinIcon size={18} />}
                label={t("map.open")}
                value={t("map.count", { count: zones.length })}
                onClick={() => setMapOpen(true)}
              />
            </ListGroup>
            <section aria-labelledby="feed-communes" className="flex flex-col gap-3">
              <h2 id="feed-communes" className="text-lg font-semibold">
                {t("communes")}
              </h2>
              <CommuneCards {...listProps} className="md:hidden" />
              <CommuneTable {...listProps} className="max-md:hidden" />
            </section>
          </>
        ) : (
          <EmptyState>{t("noZones")}</EmptyState>
        )}

        <RegionMore region={region} />
      </div>

      {hasZones && isLaptop ? (
        <aside className="sticky top-20 col-start-1 row-start-1 flex h-[calc(100dvh-6rem)] flex-col gap-4 self-start">
          {map("min-h-56 flex-1 rounded-[var(--radius-xl)]")}
          <div className="flex max-h-[55%] min-h-0 flex-col rounded-[var(--radius-lg)] bg-surface p-4 shadow-1">
            {selected ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold">{detailTitle}</h2>
                  <IconButton label={t("closeDetail")} onClick={() => setSelectedId(null)} className="-mr-2 -mt-2">
                    <CrossIcon size={18} />
                  </IconButton>
                </div>
                <div className="mt-3 min-h-0 overflow-y-auto pr-1">{details}</div>
              </>
            ) : (
              <p className="text-sm text-ink-muted">{t("detailEmpty")}</p>
            )}
          </div>
        </aside>
      ) : null}

      <FullMap open={mapOpen && !isLaptop} onClose={() => setMapOpen(false)} title={t("mapTitle", { crop: tc(crop) })}>
        {map("h-full")}
      </FullMap>

      <Sheet open={!isLaptop && selected !== null} onClose={() => setSelectedId(null)} title={detailTitle} snap>
        {details}
      </Sheet>

      <ComparePill count={ticked.length} onCompare={() => setComparing(true)} onClear={() => setTicked([])} />
      <Sheet
        open={comparing && zoneA != null && zoneB != null}
        onClose={() => setComparing(false)}
        title={t("compare.title")}
        subtitle={zoneA && zoneB ? t("compare.subtitle", { a: zoneA.name, b: zoneB.name, crop: tc(crop) }) : undefined}
        snap
      >
        {zoneA && zoneB ? <ZoneCompare zones={zones} crop={crop} ids={[zoneA.id, zoneB.id]} /> : null}
      </Sheet>
    </div>
  );
}
