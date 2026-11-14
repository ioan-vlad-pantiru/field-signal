"use client";

import { useEffect, useMemo } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { useTranslations } from "next-intl";
import type { SavedField } from "@/lib/contracts";
import { useMap } from "@/components/map/use-map";

const SOURCE = "fs-account-fields";

function bounds(fields: readonly SavedField[]) {
  const pts = fields.flatMap((f) => f.boundary);
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

function geojson(fields: readonly SavedField[]) {
  return {
    type: "FeatureCollection" as const,
    features: fields.map((f) => ({
      type: "Feature" as const,
      properties: { id: f.id, name: f.name },
      geometry: {
        type: "Polygon" as const,
        coordinates: [[...f.boundary, f.boundary[0]].map((p) => [p.lon, p.lat])],
      },
    })),
  };
}

function addLayers(map: MapLibreMap, data: ReturnType<typeof geojson>, onPick: (id: string) => void) {
  map.addSource(SOURCE, { type: "geojson", data, promoteId: "id" });
  map.addLayer({
    id: `${SOURCE}-fill`,
    type: "fill",
    source: SOURCE,
    paint: { "fill-color": "#5fcf8f", "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.5, 0.22] },
  });
  map.addLayer({
    id: `${SOURCE}-line`,
    type: "line",
    source: SOURCE,
    paint: {
      "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ffffff", "#5fcf8f"],
      "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 2],
    },
  });
  map.on("click", `${SOURCE}-fill`, (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") onPick(id);
  });
  map.on("mouseenter", `${SOURCE}-fill`, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", `${SOURCE}-fill`, () => (map.getCanvas().style.cursor = ""));
}

/** Every saved field on a satellite map; selected fields are outlined in white. Click picks one. */
export default function FieldsMap({
  fields,
  selected,
  onPick,
}: {
  fields: readonly SavedField[];
  selected: ReadonlySet<string>;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("Account.fields");
  const start = useMemo(() => bounds(fields), [fields]);
  const { container, map, failed } = useMap(start.center, start.zoom, { satellite: true, cooperativeGestures: true });
  const data = useMemo(() => geojson(fields), [fields]);

  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
      if (source) source.setData(data);
      else addLayers(map, data, onPick);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [map, data, onPick]);

  useEffect(() => {
    if (!map) return;
    const paint = () => {
      if (!map.getSource(SOURCE)) return;
      for (const f of fields) map.setFeatureState({ source: SOURCE, id: f.id }, { selected: selected.has(f.id) });
    };
    if (map.isStyleLoaded() && map.getSource(SOURCE)) paint();
    else map.once("idle", paint);
  }, [map, fields, selected]);

  if (failed) return null;
  return (
    <div
      ref={container}
      role="img"
      aria-label={t("mapLabel", { count: fields.length })}
      className="h-64 w-full overflow-hidden rounded-2xl border border-line bg-surface-sunken sm:h-80"
    />
  );
}
