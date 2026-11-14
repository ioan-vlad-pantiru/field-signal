"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { LngLatBounds, Marker, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { getParcels } from "@/lib/api";
import type { LatLon, Parcel } from "@/lib/contracts";
import { useParcelBrush } from "@/components/map/parcel-brush";
import { setBasemap, useMap, type Basemap } from "@/components/map/use-map";

/** draw: tap adds a field corner · locked: a drawn field is set. */
export type MapMode = "draw" | "locked";

/** A place to move the camera to, e.g. a commune from the search or the farmer's location. */
export interface MapFocus {
  point: LatLon;
  zoom: number;
  /** Changes on every request, so asking for the same place twice still moves the map. */
  seq: number;
}

const DRAW = "fs-draw";
const PARCELS = "fs-parcels";
const PICKED = "fs-parcels-picked";
/** Parcel outlines appear from this zoom: closer in, a screen holds a few hundred parcels at most. */
const PARCEL_ZOOM = 13.5;
const OTHERS = "fs-others";
const DRAW_ZOOM = 14;

type DrawData = Extract<Parameters<GeoJSONSource["setData"]>[0], { type: "FeatureCollection" }>;

function drawData(corners: LatLon[], closed: boolean, parts: LatLon[][] = []): DrawData {
  const coords = corners.map((c): [number, number] => [c.lon, c.lat]);
  // Further pieces of the same field: filled and outlined like it, without corner handles.
  const pieces: DrawData["features"] = parts.flatMap((part) => {
    const ring = part.map((c): [number, number] => [c.lon, c.lat]);
    const closedRing = [...ring, ring[0]];
    return [
      { type: "Feature", properties: { kind: "area" }, geometry: { type: "Polygon", coordinates: [closedRing] } },
      { type: "Feature", properties: { kind: "edge" }, geometry: { type: "LineString", coordinates: closedRing } },
    ];
  });
  const features: DrawData["features"] = coords.map((c, i) => ({
    type: "Feature",
    properties: { kind: "corner", first: i === 0 },
    geometry: { type: "Point", coordinates: c },
  }));
  if (coords.length >= 3) {
    features.unshift({
      type: "Feature",
      properties: { kind: "area" },
      geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] },
    });
  }
  if (coords.length >= 2) {
    features.push({
      type: "Feature",
      properties: { kind: "edge" },
      geometry: { type: "LineString", coordinates: closed ? [...coords, coords[0]] : coords },
    });
  }
  return { type: "FeatureCollection", features: [...pieces, ...features] };
}

function parcelsData(parcels: Parcel[]): DrawData {
  return {
    type: "FeatureCollection",
    features: parcels.map((p) => {
      const ring = p.boundary.map((c): [number, number] => [c.lon, c.lat]);
      return {
        type: "Feature",
        id: p.id,
        properties: { id: p.id },
        geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      };
    }),
  };
}

/** Fields already added to this analysis, drawn quieter than the one being edited. */
function othersData(fields: LatLon[][]): DrawData {
  return {
    type: "FeatureCollection",
    features: fields
      .filter((f) => f.length >= 3)
      .map((f) => {
        const ring = f.map((c): [number, number] => [c.lon, c.lat]);
        return {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
        };
      }),
  };
}

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function whenStyleReady(map: MapLibreMap, run: () => void) {
  if (map.isStyleLoaded()) run();
  else map.once("load", run);
}

/**
 * The field step's map. In "draw" mode each tap adds a corner of the farmer's field, drawn live
 * as an outline and fill; once locked, a pin marks the field's centre.
 */
export function FieldMap({
  value,
  mode,
  corners,
  closed,
  parts = [],
  others = [],
  onAddCorner,
  onTapParcel,
  selected = [],
  brush = false,
  onBrushParcels,
  onParcelsShown,
  label,
  basemap,
  focus,
  onUnavailable,
  className = "",
}: {
  value: LatLon;
  mode: MapMode;
  corners: LatLon[];
  closed: boolean;
  /** Further pieces of the field being edited (parcels that do not touch). */
  parts?: LatLon[][];
  /** Other fields in the same analysis, shown for orientation. */
  others?: LatLon[][];
  onAddCorner: (point: LatLon) => void;
  /** Tapping a declared APIA parcel selects or unselects it (only before any corner is placed). */
  onTapParcel?: (parcel: Parcel) => void;
  /** Parcels selected so far, highlighted. */
  selected?: Parcel[];
  /** Drag-to-select: dragging over parcels selects them instead of moving the map. */
  brush?: boolean;
  /** Parcels a drag passed over: added, or removed when the drag started on a selected parcel. */
  onBrushParcels?: (parcels: Parcel[], action: "add" | "remove") => void;
  /** Whether parcel outlines are on screen, so the panel can say "tap your parcel". */
  onParcelsShown?: (shown: boolean) => void;
  label: string;
  basemap: Basemap;
  focus: MapFocus | null;
  /** Called once if the browser cannot draw the map (no WebGL). */
  onUnavailable?: () => void;
  className?: string;
}) {
  // Fields are tens of hectares: open at field scale so a few taps trace one parcel.
  const t = useTranslations("Field");
  const { container, map, failed } = useMap([value.lon, value.lat], DRAW_ZOOM, { satellite: basemap === "satellite" });
  const marker = useRef<Marker | null>(null);
  // Outlines stay on screen while drawing by hand (a tap in a gap starts a corner); they can be
  // picked again once the corners are undone or cleared.
  const showParcels = mode === "draw" && onTapParcel !== undefined;
  const pickable = showParcels && corners.length === 0;
  const brushing = pickable && brush && onBrushParcels !== undefined;
  const selectedIds = useRef(new Set<number>());
  const handlers = useRef({ onAddCorner, onTapParcel, onBrushParcels, onParcelsShown, mode, pickable, brushing });
  /** The parcels on screen, by id, with their full outlines. */
  const loaded = useRef(new Map<number, Parcel>());

  useEffect(() => {
    handlers.current = { onAddCorner, onTapParcel, onBrushParcels, onParcelsShown, mode, pickable, brushing };
  }, [onAddCorner, onTapParcel, onBrushParcels, onParcelsShown, mode, pickable, brushing]);

  useEffect(() => {
    selectedIds.current = new Set(selected.map((p) => p.id));
  }, [selected]);

  useEffect(() => {
    if (!map) return;
    const pin = new Marker({ color: "#1f6b45", draggable: false, className: "field-pin" })
      .setLngLat([value.lon, value.lat])
      .addTo(map);
    const round = (lng: number, lat: number): LatLon => ({
      lat: Number(lat.toFixed(5)),
      lon: Number(lng.toFixed(5)),
    });
    map.on("click", (event) => {
      const h = handlers.current;
      // In drag-to-select, taps are handled with the drag (see the brush effect).
      if (h.mode !== "draw" || h.brushing) return;
      if (h.pickable && map.getLayer("fs-parcels-area")) {
        const hit = map.queryRenderedFeatures(event.point, { layers: ["fs-parcels-area"] })[0];
        const parcel = hit ? loaded.current.get(Number(hit.properties?.id)) : undefined;
        if (parcel) {
          h.onTapParcel?.(parcel);
          return;
        }
      }
      h.onAddCorner(round(event.lngLat.lng, event.lngLat.lat));
    });
    map.on("mousemove", "fs-parcels-area", () => {
      if (handlers.current.pickable && !handlers.current.brushing) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "fs-parcels-area", () => {
      if (handlers.current.brushing) return;
      map.getCanvas().style.cursor = handlers.current.mode === "draw" ? "crosshair" : "";
    });
    whenStyleReady(map, () => {
      const field = token("--field", "#1f6b45");
      map.addSource(PARCELS, {
        type: "geojson",
        data: parcelsData([]),
        attribution: "Parcele: APIA LPIS 2025 (data.gov.ro, CC BY 4.0)",
      });
      map.addLayer({
        id: "fs-parcels-area",
        type: "fill",
        source: PARCELS,
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "fs-parcels-edge",
        type: "line",
        source: PARCELS,
        paint: { "line-color": "#ffffff", "line-width": 1.2, "line-opacity": 0.85 },
      });
      map.addSource(PICKED, { type: "geojson", data: parcelsData([]) });
      map.addLayer({
        id: "fs-parcels-picked-area",
        type: "fill",
        source: PICKED,
        paint: { "fill-color": field, "fill-opacity": 0.45 },
      });
      map.addLayer({
        id: "fs-parcels-picked-edge",
        type: "line",
        source: PICKED,
        paint: { "line-color": "#ffffff", "line-width": 2.5 },
      });
      map.addSource(OTHERS, { type: "geojson", data: othersData([]) });
      map.addLayer({
        id: "fs-others-area",
        type: "fill",
        source: OTHERS,
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "fs-others-edge",
        type: "line",
        source: OTHERS,
        paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 1.5] },
      });
      map.addSource(DRAW, { type: "geojson", data: drawData([], false) });
      map.addLayer({
        id: "fs-draw-area",
        type: "fill",
        source: DRAW,
        filter: ["==", ["get", "kind"], "area"],
        paint: { "fill-color": field, "fill-opacity": 0.28 },
      });
      // A white casing keeps the green outline visible on dark satellite imagery.
      map.addLayer({
        id: "fs-draw-casing",
        type: "line",
        source: DRAW,
        filter: ["==", ["get", "kind"], "edge"],
        paint: { "line-color": "#ffffff", "line-width": 6 },
      });
      map.addLayer({
        id: "fs-draw-edge",
        type: "line",
        source: DRAW,
        filter: ["==", ["get", "kind"], "edge"],
        paint: { "line-color": field, "line-width": 3 },
      });
      map.addLayer({
        id: "fs-draw-corner",
        type: "circle",
        source: DRAW,
        filter: ["==", ["get", "kind"], "corner"],
        paint: {
          "circle-radius": ["case", ["get", "first"], 8, 6],
          "circle-color": "#ffffff",
          "circle-stroke-color": field,
          "circle-stroke-width": 3,
        },
      });
    });
    marker.current = pin;
    return () => {
      pin.remove();
      marker.current = null;
    };
    // The marker and layers are created once per map; updates happen in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    const pin = marker.current;
    if (!pin) return;
    pin.setLngLat([value.lon, value.lat]);
    // Replay the drop animation on the pin's icon each time it moves.
    const icon = pin.getElement().firstElementChild as HTMLElement | null;
    if (icon) {
      icon.style.animation = "none";
      void icon.offsetWidth;
      icon.style.animation = "";
    }
  }, [value]);

  // While drawing, the pin steps aside; the drawn field speaks for itself.
  useEffect(() => {
    const pin = marker.current;
    if (pin) pin.getElement().style.visibility = mode === "draw" ? "hidden" : "visible";
    if (!map) return;
    map.getCanvas().style.cursor = mode === "draw" ? "crosshair" : "";
    // Fields are tens of hectares: zoom in to field scale so a few taps trace one parcel.
    if (mode === "draw" && map.getZoom() < DRAW_ZOOM) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      map.easeTo({ center: [value.lon, value.lat], zoom: DRAW_ZOOM, duration: reduced ? 0 : 800 });
    }
    // Only when the mode changes; the pin position is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mode]);

  // Load the declared parcels around the view while the farmer is still looking for their field.
  useEffect(() => {
    if (!map) return;
    let controller: AbortController | null = null;
    const show = (parcels: Parcel[]) => {
      loaded.current = new Map(parcels.map((p) => [p.id, p]));
      map.getSource<GeoJSONSource>(PARCELS)?.setData(parcelsData(parcels));
      handlers.current.onParcelsShown?.(parcels.length > 0);
    };
    const refresh = () => {
      controller?.abort();
      if (!showParcels || map.getZoom() < PARCEL_ZOOM) {
        show([]);
        return;
      }
      const b = map.getBounds();
      controller = new AbortController();
      getParcels({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, controller.signal)
        .then((result) => {
          const parcels = result?.parcels ?? [];
          // isStyleLoaded() is false while tiles load, so check for the source instead.
          if (map.getSource(PARCELS)) show(parcels);
          else whenStyleReady(map, () => show(parcels));
        })
        .catch(() => {});
    };
    whenStyleReady(map, refresh);
    map.on("moveend", refresh);
    return () => {
      controller?.abort();
      map.off("moveend", refresh);
    };
  }, [map, showParcels]);

  // Drag-to-select: one finger or the mouse paints over parcels; two fingers still zoom and pan.
  useParcelBrush(map, brushing, {
    layer: "fs-parcels-area",
    parcel: (id) => loaded.current.get(id),
    isSelected: (id) => selectedIds.current.has(id),
    onStroke: (parcels, action) => handlers.current.onBrushParcels?.(parcels, action),
    onTap: (parcel) => handlers.current.onTapParcel?.(parcel),
  });

  useEffect(() => {
    if (!map) return;
    const update = () => map.getSource<GeoJSONSource>(PICKED)?.setData(parcelsData(selected));
    if (map.getSource(PICKED)) update();
    else whenStyleReady(map, update);
  }, [map, selected]);

  useEffect(() => {
    if (map) setBasemap(map, basemap);
  }, [map, basemap]);

  useEffect(() => {
    if (!map || !focus) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({ center: [focus.point.lon, focus.point.lat], zoom: focus.zoom, duration: reduced ? 0 : 900 });
  }, [map, focus]);

  useEffect(() => {
    if (!map) return;
    whenStyleReady(map, () => {
      map.getSource<GeoJSONSource>(DRAW)?.setData(drawData(corners, closed, parts));
      if (closed && corners.length >= 3) {
        const bounds = new LngLatBounds();
        [corners, ...parts].flat().forEach((c) => bounds.extend([c.lon, c.lat]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 700 });
      }
    });
  }, [map, corners, closed, parts]);

  useEffect(() => {
    if (!map) return;
    const update = () => map.getSource<GeoJSONSource>(OTHERS)?.setData(othersData(others));
    // The source exists once the layers are set up; until then, wait for the style to load.
    if (map.getSource(OTHERS)) update();
    else whenStyleReady(map, update);
  }, [map, others]);

  useEffect(() => {
    if (failed) onUnavailable?.();
    // Only when the map fails; the callback identity does not matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  if (failed) {
    return (
      <div
        role="status"
        className={`flex w-full items-center justify-center rounded-2xl border border-line bg-surface-sunken p-6 text-center text-ink-muted ${className}`}
      >
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
