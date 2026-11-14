"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { LngLatBounds, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { getParcels } from "@/lib/api";
import type { Parcel } from "@/lib/contracts";
import { useParcelBrush } from "@/components/map/parcel-brush";
import { setBasemap, useMap, type Basemap } from "@/components/map/use-map";

/** pick: APIA parcels on screen, tap or drag to add to / remove from the farm. fields: select farm parcels. */
export type FarmMapMode = "pick" | "fields";

const APIA = "farm-apia";
const FARM = "farm-parcels";
const SELECTED = "farm-selected";
/** APIA outlines appear from this zoom; farm parcels show at any zoom. */
const PARCEL_ZOOM = 13.5;

type Collection = Extract<Parameters<GeoJSONSource["setData"]>[0], { type: "FeatureCollection" }>;

function collection(parcels: Parcel[], props: (p: Parcel) => Record<string, unknown> = () => ({})): Collection {
  return {
    type: "FeatureCollection",
    features: parcels.map((p) => {
      const ring = p.boundary.map((c): [number, number] => [c.lon, c.lat]);
      return {
        type: "Feature",
        id: p.id,
        properties: { id: p.id, ...props(p) },
        geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      };
    }),
  };
}

function whenReady(map: MapLibreMap, source: string, run: () => void) {
  if (map.getSource(source)) run();
  else map.once("idle", () => (map.getSource(source) ? run() : whenReady(map, source, run)));
}

export function FarmMap({
  mode,
  parcels,
  colourOf,
  selected,
  brush,
  onStroke,
  onTap,
  fitSeq,
  basemap,
  start,
  label,
  className = "",
}: {
  mode: FarmMapMode;
  /** The farm's parcels. */
  parcels: Parcel[];
  /** Fill colour per farm parcel (its field's colour); white when not in a field. */
  colourOf: (parcel: Parcel) => string;
  /** Highlighted parcels: selected for moving (fields mode). */
  selected: Set<number>;
  brush: boolean;
  /** A drag passed over these parcels: add or remove (pick: from the farm; fields: from the selection). */
  onStroke: (parcels: Parcel[], action: "add" | "remove") => void;
  onTap: (parcel: Parcel) => void;
  /** Changes when the camera should fit the farm (after an import, say). */
  fitSeq: number;
  basemap: Basemap;
  start: [number, number];
  label: string;
  className?: string;
}) {
  const t = useTranslations("Farm");
  const { container, map, failed } = useMap(start, 14, { satellite: true });
  /** Every parcel the map can report by id: APIA parcels on screen and the farm's own. */
  const known = useRef(new Map<number, Parcel>());
  const inFarm = useRef(new Set<number>());
  const state = useRef({ mode, selected, onTap, brush });
  useEffect(() => {
    state.current = { mode, selected, onTap, brush };
  }, [mode, selected, onTap, brush]);

  useEffect(() => {
    inFarm.current = new Set(parcels.map((p) => p.id));
    parcels.forEach((p) => known.current.set(p.id, p));
  }, [parcels]);

  // Layers, once per map.
  useEffect(() => {
    if (!map) return;
    const setup = () => {
      if (map.getSource(APIA)) return;
      map.addSource(APIA, {
        type: "geojson",
        data: collection([]),
        attribution: "Parcele: APIA LPIS 2025 (data.gov.ro, CC BY 4.0)",
      });
      map.addLayer({ id: "farm-apia-area", type: "fill", source: APIA, paint: { "fill-color": "#ffffff", "fill-opacity": 0.08 } });
      map.addLayer({
        id: "farm-apia-edge",
        type: "line",
        source: APIA,
        paint: { "line-color": "#ffffff", "line-width": 1.1, "line-opacity": 0.8 },
      });
      map.addSource(FARM, { type: "geojson", data: collection([]) });
      map.addLayer({
        id: "farm-parcels-area",
        type: "fill",
        source: FARM,
        paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.55 },
      });
      map.addLayer({ id: "farm-parcels-edge", type: "line", source: FARM, paint: { "line-color": "#ffffff", "line-width": 1.6 } });
      map.addSource(SELECTED, { type: "geojson", data: collection([]) });
      map.addLayer({ id: "farm-selected-edge-casing", type: "line", source: SELECTED, paint: { "line-color": "#111111", "line-width": 5 } });
      map.addLayer({ id: "farm-selected-edge", type: "line", source: SELECTED, paint: { "line-color": "#ffd23f", "line-width": 3 } });
    };
    if (map.isStyleLoaded()) setup();
    else map.once("load", setup);
    map.on("click", (event) => {
      // While drag-to-select is on, the brush handles taps itself.
      if (state.current.brush) return;
      // The farm's own parcels first (shown at any zoom), then APIA parcels to add while picking.
      const layers = (state.current.mode === "pick" ? ["farm-parcels-area", "farm-apia-area"] : ["farm-parcels-area"]).filter(
        (id) => map.getLayer(id),
      );
      if (layers.length === 0) return;
      const hit = map.queryRenderedFeatures(event.point, { layers })[0];
      const parcel = hit ? known.current.get(Number(hit.properties?.id)) : undefined;
      if (parcel) state.current.onTap(parcel);
    });
  }, [map]);

  useParcelBrush(map, brush, {
    layer: mode === "pick" ? "farm-apia-area" : "farm-parcels-area",
    parcel: (id) => known.current.get(id),
    isSelected: (id) => (mode === "pick" ? inFarm.current.has(id) : selected.has(id)),
    onStroke,
    onTap,
  });

  // APIA parcels around the view, while adding parcels.
  useEffect(() => {
    if (!map) return;
    let controller: AbortController | null = null;
    const show = (list: Parcel[]) => {
      list.forEach((p) => known.current.set(p.id, p));
      whenReady(map, APIA, () => map.getSource<GeoJSONSource>(APIA)?.setData(collection(list)));
    };
    const refresh = () => {
      controller?.abort();
      if (mode !== "pick" || map.getZoom() < PARCEL_ZOOM) {
        show([]);
        return;
      }
      const b = map.getBounds();
      controller = new AbortController();
      getParcels({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, controller.signal)
        .then((result) => show(result?.parcels ?? []))
        .catch(() => {});
    };
    if (map.isStyleLoaded()) refresh();
    else map.once("load", refresh);
    map.on("moveend", refresh);
    return () => {
      controller?.abort();
      map.off("moveend", refresh);
    };
  }, [map, mode]);

  useEffect(() => {
    if (!map) return;
    whenReady(map, FARM, () =>
      map.getSource<GeoJSONSource>(FARM)?.setData(collection(parcels, (p) => ({ colour: colourOf(p) }))),
    );
  }, [map, parcels, colourOf]);

  useEffect(() => {
    if (!map) return;
    const list = parcels.filter((p) => selected.has(p.id));
    whenReady(map, SELECTED, () => map.getSource<GeoJSONSource>(SELECTED)?.setData(collection(list)));
  }, [map, parcels, selected]);

  useEffect(() => {
    if (!map || fitSeq === 0 || parcels.length === 0) return;
    const bounds = new LngLatBounds();
    parcels.forEach((p) => p.boundary.forEach((c) => bounds.extend([c.lon, c.lat])));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.fitBounds(bounds, { padding: 48, maxZoom: 16, pitch: 0, duration: reduced ? 0 : 900 });
    // Only when asked to fit, not on every parcel change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitSeq]);

  useEffect(() => {
    if (map) setBasemap(map, basemap);
  }, [map, basemap]);

  if (failed) {
    return (
      <div role="status" className={`flex items-center justify-center rounded-2xl border border-line bg-surface-sunken p-6 text-center text-ink-muted ${className}`}>
        {t("mapUnavailable")}
      </div>
    );
  }
  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className={`w-full overflow-hidden rounded-2xl border border-line bg-surface-sunken ${className}`}
    />
  );
}
