"use client";

import { useEffect, useRef } from "react";
import { Marker, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { Crop, LatLon } from "@/lib/contracts";
import { CROP_COLORS, CROP_HEIGHT_M } from "@/lib/crops";
import type { FieldLayout, Hex } from "@/lib/field-plan";
import { polygonCentroid, radiusMetres } from "@/lib/geo";
import { findNonFarmland, type NonFarmland } from "@/lib/land-cover";
import { useMap } from "@/components/map/use-map";

/** Crops are a few metres tall at most; exaggerate so the difference reads from above. */
const HEIGHT_EXAGGERATION = 12;
/** Hexagons are drawn slightly inset so the gaps show the grid between extruded cells. */
const INSET = 0.92;
const GROW_MS = 700;
/** Plots smaller than this many hectares get letter-only labels. */
const COMPACT_BELOW = 6;
const HEXES = "fs-hexes";
const BLOCKED_COLOR = "#8d958c";

export interface PlotView {
  id: string;
  crop: Crop;
  label: string;
}

type HexData = Extract<Parameters<GeoJSONSource["setData"]>[0], { type: "FeatureCollection" }>;

function inset(hex: Hex): [number, number][] {
  const [cx, cy] = hex.center;
  return hex.ring.map(([x, y]) => [cx + (x - cx) * INSET, cy + (y - cy) * INSET]);
}

function hexData(layout: FieldLayout, plots: PlotView[]): HexData {
  const plotOf = new Map<string, number>();
  layout.plots.forEach((plot, i) => plot.hexIds.forEach((id) => plotOf.set(id, i)));
  return {
    type: "FeatureCollection",
    features: layout.hexes.map((hex) => {
      const plot = plotOf.get(hex.id);
      const crop = plot === undefined ? null : plots[plot].crop;
      return {
        type: "Feature",
        properties: crop
          ? { kind: "crop", color: CROP_COLORS[crop], h: CROP_HEIGHT_M[crop] * HEIGHT_EXAGGERATION }
          : { kind: "blocked", color: BLOCKED_COLOR, h: 0 },
        geometry: { type: "Polygon", coordinates: [inset(hex)] },
      };
    }),
  };
}

/** Zoom that fits a drawn field of this size in the plan map, with room for the 3D tilt. */
function zoomFor(boundary: LatLon[]): number {
  const radius = radiusMetres(polygonCentroid(boundary), boundary);
  return Math.max(12, Math.min(16.5, 14.6 - Math.log2(Math.max(radius, 1) / 370)));
}

function whenStyleReady(map: MapLibreMap, run: () => void) {
  if (map.isStyleLoaded()) run();
  else map.once("load", run);
}

/**
 * The farmer's field as 1 ha hexagons on the 3D map: crop hexagons coloured and raised by crop,
 * hexagons on roads, buildings, water or woods flat and grey. Reports those once tiles are in.
 */
export function FieldPlanMap({
  center,
  layout,
  plots,
  boundary,
  onNonFarmland,
  label,
}: {
  center: LatLon;
  layout: FieldLayout;
  plots: PlotView[];
  /** The farmer's drawn field, outlined on top of the hexagons. */
  boundary: LatLon[] | null;
  onNonFarmland: (found: Map<string, NonFarmland>) => void;
  label: string;
}) {
  const focus = boundary ? polygonCentroid(boundary) : center;
  const { container, map } = useMap([focus.lon, focus.lat], boundary ? zoomFor(boundary) : 14.6);
  const markers = useRef<Marker[]>([]);
  const report = useRef(onNonFarmland);

  useEffect(() => {
    report.current = onNonFarmland;
  }, [onNonFarmland]);

  // Layers once per map, then one land-cover pass when the camera has settled.
  useEffect(() => {
    if (!map) return;
    let checked = false;
    const check = () => {
      if (checked || map.isMoving()) return;
      checked = true;
      report.current(findNonFarmland(map, layout.hexes, [HEXES]));
    };
    whenStyleReady(map, () => {
      map.addSource(HEXES, { type: "geojson", data: hexData(layout, plots) });
      map.addLayer({
        id: "fs-hex-blocked",
        type: "fill",
        source: HEXES,
        filter: ["==", ["get", "kind"], "blocked"],
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 },
      });
      map.addLayer({
        id: "fs-hex-blocked-line",
        type: "line",
        source: HEXES,
        filter: ["==", ["get", "kind"], "blocked"],
        paint: { "line-color": BLOCKED_COLOR, "line-width": 1.5, "line-dasharray": [2, 1.5] },
      });
      map.addLayer({
        id: "fs-hex-crop",
        type: "fill-extrusion",
        source: HEXES,
        filter: ["==", ["get", "kind"], "crop"],
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": ["get", "h"],
          "fill-extrusion-opacity": 0.92,
        },
      });
      if (boundary) {
        const ring = boundary.map((c): [number, number] => [c.lon, c.lat]);
        map.addSource("fs-boundary", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [...ring, ring[0]] } },
        });
        map.addLayer({
          id: "fs-boundary",
          type: "line",
          source: "fs-boundary",
          paint: { "line-color": "#ffffff", "line-width": 3, "line-dasharray": [2, 1] },
        });
      }
      map.on("idle", check);
    });
    return () => {
      map.off("idle", check);
      markers.current.forEach((m) => m.remove());
      markers.current = [];
    };
    // Layers are set up once; data updates happen in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // New season, strategy or land cover: recolour, move the plot labels, and grow the crops in.
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    whenStyleReady(map, () => {
      const source = map.getSource<GeoJSONSource>(HEXES);
      if (!source) return;
      source.setData(hexData(layout, plots));

      markers.current.forEach((m) => m.remove());
      // Small plots sit close together: label them with the letter only (the legend names the crop).
      const compact = layout.plots.some((plot) => plot.hexIds.length > 0 && plot.hexIds.length < COMPACT_BELOW);
      markers.current = layout.plots
        .filter((plot) => plot.hexIds.length > 0)
        .map((plot) => {
          const el = document.createElement("div");
          el.className = "plot-label";
          el.setAttribute("aria-hidden", "true");
          const view = plots.find((p) => p.id === plot.id);
          el.textContent = view && !compact ? `${plot.id} · ${view.label}` : plot.id;
          return new Marker({ element: el }).setLngLat(plot.centroid).addTo(map);
        });

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const start = performance.now();
      const grow = (now: number) => {
        const t = reduced ? 1 : Math.min(1, (now - start) / GROW_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        map.setPaintProperty("fs-hex-crop", "fill-extrusion-height", ["*", ["get", "h"], eased]);
        if (t < 1) frame = requestAnimationFrame(grow);
      };
      frame = requestAnimationFrame(grow);
    });
    return () => cancelAnimationFrame(frame);
  }, [map, layout, plots]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      className="h-80 w-full overflow-hidden rounded-[20px] border border-line bg-surface-sunken sm:h-[28rem]"
    />
  );
}
