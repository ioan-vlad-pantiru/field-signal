"use client";

import { useEffect, useRef } from "react";
import { LngLatBounds, Marker, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { LatLon } from "@/lib/contracts";
import { useMap } from "@/components/map/use-map";

/** draw: tap adds a field corner · locked: a drawn field is set. */
export type MapMode = "draw" | "locked";

const DRAW = "fs-draw";
const DRAW_ZOOM = 14;

type DrawData = Extract<Parameters<GeoJSONSource["setData"]>[0], { type: "FeatureCollection" }>;

function drawData(corners: LatLon[], closed: boolean): DrawData {
  const coords = corners.map((c): [number, number] => [c.lon, c.lat]);
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
  return { type: "FeatureCollection", features };
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
  onAddCorner,
  label,
}: {
  value: LatLon;
  mode: MapMode;
  corners: LatLon[];
  closed: boolean;
  onAddCorner: (point: LatLon) => void;
  label: string;
}) {
  // Fields are tens of hectares: open at field scale so a few taps trace one parcel.
  const { container, map } = useMap([value.lon, value.lat], DRAW_ZOOM);
  const marker = useRef<Marker | null>(null);
  const handlers = useRef({ onAddCorner, mode });

  useEffect(() => {
    handlers.current = { onAddCorner, mode };
  }, [onAddCorner, mode]);

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
      const point = round(event.lngLat.lng, event.lngLat.lat);
      if (handlers.current.mode === "draw") handlers.current.onAddCorner(point);
    });
    whenStyleReady(map, () => {
      const field = token("--field", "#1f6b45");
      map.addSource(DRAW, { type: "geojson", data: drawData([], false) });
      map.addLayer({
        id: "fs-draw-area",
        type: "fill",
        source: DRAW,
        filter: ["==", ["get", "kind"], "area"],
        paint: { "fill-color": field, "fill-opacity": 0.22 },
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

  useEffect(() => {
    if (!map) return;
    whenStyleReady(map, () => {
      map.getSource<GeoJSONSource>(DRAW)?.setData(drawData(corners, closed));
      if (closed && corners.length >= 3) {
        const bounds = new LngLatBounds();
        corners.forEach((c) => bounds.extend([c.lon, c.lat]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 700 });
      }
    });
  }, [map, corners, closed]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className="h-72 w-full overflow-hidden rounded-2xl border border-line bg-surface-sunken sm:h-96"
    />
  );
}
