"use client";

import { useEffect, useMemo } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { useTranslations } from "next-intl";
import type { Loaded } from "@/lib/api";
import type { FieldAnalysis, LatLon } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { fieldAreaHa, fieldRings } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { verdict, type VerdictKind } from "@/lib/results";
import { useMap } from "@/components/map/use-map";
import { Button } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { ScreenHeader } from "@/components/ui/screen-header";
import { FieldThumb } from "@/components/fields/field-thumb";
import { DemoBanner } from "@/components/ui/states";
import type { SubmittedField } from "../draft-field";
import { useFieldLabel } from "../steps/field-list";
import { useRotationName } from "./rotation-name";

const SOURCE = "fs-results-fields";

type FieldCollection = Extract<Parameters<GeoJSONSource["setData"]>[0], { type: "FeatureCollection" }>;

/** Map colour per verdict: green where another rotation did better, grey where yours is best. */
const KIND_COLOR: Record<VerdictKind, string> = {
  fewer: "#5fcf8f",
  same: "#e9b456",
  more: "#e9b456",
  keep: "#c9d2c8",
};

function frame(boundaries: LatLon[][]) {
  const pts = boundaries.flat();
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lons);
  const east = Math.max(...lons);
  const span = Math.max(east - west, (north - south) * 1.4, 0.004);
  return {
    center: [(west + east) / 2, (south + north) / 2] as [number, number],
    zoom: Math.min(Math.max(Math.log2(360 / span) - 0.5, 7), 15.5),
  };
}

function addLayers(map: MapLibreMap, data: FieldCollection, onPick: (index: number) => void) {
  map.addSource(SOURCE, { type: "geojson", data });
  map.addLayer({
    id: `${SOURCE}-fill`,
    type: "fill",
    source: SOURCE,
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.45 },
  });
  map.addLayer({
    id: `${SOURCE}-line`,
    type: "line",
    source: SOURCE,
    paint: { "line-color": "#ffffff", "line-width": 2 },
  });
  map.on("click", `${SOURCE}-fill`, (e: MapLayerMouseEvent) => {
    const index = e.features?.[0]?.properties?.index;
    if (typeof index === "number") onPick(index);
  });
  map.on("mouseenter", `${SOURCE}-fill`, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", `${SOURCE}-fill`, () => (map.getCanvas().style.cursor = ""));
}

/**
 * Every analysed field at once: a map coloured by the answer, and one line per field. Picking a
 * field (on the map or in the list) opens its own results.
 */
export function ResultsOverview({
  fields,
  results,
  onOpen,
}: {
  fields: SubmittedField[];
  results: Loaded<FieldAnalysis>[];
  onOpen: (index: number) => void;
}) {
  const t = useTranslations("Results.overview");
  const locale = useAppLocale();
  const label = useFieldLabel();
  const nameOf = useRotationName();
  const verdicts = useMemo(() => results.map((r) => verdict(r.data.strategies)), [results]);
  const start = frame(fields.flatMap((f) => fieldRings(f)));
  const { container, map, failed } = useMap(start.center, start.zoom, { satellite: true, cooperativeGestures: true });
  const totalHa = fields.reduce((sum, f) => sum + fieldAreaHa(f), 0);
  const better = verdicts.filter((v) => v.kind === "fewer");
  const betterHa = fields.reduce((sum, f, i) => sum + (verdicts[i].kind === "fewer" ? fieldAreaHa(f) : 0), 0);
  const mock = results.find((r) => r.data.mock);

  const data = useMemo<FieldCollection>(
    () => ({
      type: "FeatureCollection",
      features: fields.map((f, i) => ({
        type: "Feature",
        properties: { index: i, color: KIND_COLOR[verdicts[i].kind] },
        geometry: {
          type: "MultiPolygon",
          coordinates: fieldRings(f).map((ring) => [[...ring, ring[0]].map((p) => [p.lon, p.lat])]),
        },
      })),
    }),
    [fields, verdicts],
  );

  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
      if (source) source.setData(data);
      else addLayers(map, data, onOpen);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [map, data, onOpen]);

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        title={t("title", { count: fields.length })}
        meta={
          better.length === 0
            ? t("summaryNone", { ha: formatNumber(totalHa, locale, 0) })
            : t("summary", { count: better.length, total: fields.length, ha: formatNumber(betterHa, locale, 0) })
        }
      />
      {mock ? <DemoBanner origin={mock.origin} /> : null}

      {failed ? null : (
        <div className="-mx-gutter flex flex-col gap-2 sm:mx-0">
          <div
            ref={container}
            role="img"
            aria-label={t("mapLabel", { count: fields.length })}
            className="h-[min(50svh,460px)] min-h-72 w-full overflow-hidden bg-surface-sunken sm:rounded-[var(--radius-xl)] sm:shadow-1"
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 px-gutter text-sm text-ink-muted sm:px-0">
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-xs" style={{ background: KIND_COLOR.fewer }} />
              {t("legendFewer")}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-xs" style={{ background: KIND_COLOR.same }} />
              {t("legendOther")}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-xs" style={{ background: KIND_COLOR.keep }} />
              {t("legendKeep")}
            </li>
          </ul>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {fields.map((field, i) => {
          const v = verdicts[i];
          return (
            <li key={i} className="rise" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
              <div className={cardClass(false, "flex items-center gap-3 p-3")}>
                <FieldThumb boundary={field.boundary} parts={field.parts} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{label(field, i)}</p>
                  <p className="text-sm tabular-nums text-ink-muted">{t("area", { ha: formatNumber(fieldAreaHa(field), locale, 1) })}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm">
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[v.kind] }} />
                    <span className="truncate">
                      {v.kind === "keep" ? t("rowKeep", { poor: v.currentPoor }) : t("rowBest", { name: nameOf(v.best), best: v.bestPoor, current: v.currentPoor })}
                    </span>
                  </p>
                </div>
                <Button variant="tonal" onClick={() => onOpen(i)}>
                  {t("open")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
