"use client";

import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Marker, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { Crop, LatLon } from "@/lib/contracts";
import { CROP_COLORS, CROP_HEIGHT_M } from "@/lib/crops";
import type { FieldLayout, Hex } from "@/lib/field-plan";
import { polygonCentroid, radiusMetres } from "@/lib/geo";
import { findNonFarmland, type NonFarmland } from "@/lib/land-cover";
import { useTranslations } from "next-intl";
import { SATELLITE_ATTRIBUTION, useMap } from "@/components/map/use-map";

/** Crops are a few metres tall at most; exaggerate so the difference reads from above. */
const HEIGHT_EXAGGERATION = 12;
/** Hexagons are drawn slightly inset so the gaps show the grid between extruded cells. */
const INSET = 0.92;
const GROW_MS = 700;
/** Plots smaller than this many hectares get letter-only labels. */
const COMPACT_BELOW = 6;
const HEXES = "fs-hexes";
const BLOCKED_COLOR = "#8d958c";
/** Camera over the field: tilted enough to read crop heights, turned a little like the arrival view. */
const FIT_PITCH = 45;
const FIT_BEARING = -12;

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

/** Bounds of the drawn field, or of the hexagons when the outline is illustrative. */
function fieldBounds(layout: FieldLayout, boundary: LatLon[] | null): LngLatBounds | null {
  const points: [number, number][] = boundary
    ? boundary.map((c) => [c.lon, c.lat])
    : layout.hexes.flatMap((hex) => hex.ring.map(([x, y]): [number, number] => [x, y]));
  if (points.length === 0) return null;
  return points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0], points[0]));
}

/**
 * Frame the field with some padding, scaled to the map so it works from phone to laptop.
 * The zoom is worked out from the field's size in metres: MapLibre's cameraForBounds measures the
 * tilted view and leaves a small field as a dot in the middle.
 */
function fitField(map: MapLibreMap, bounds: LngLatBounds) {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const center = bounds.getCenter();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const metresPerDegLat = 111_320;
  const metresPerDegLon = metresPerDegLat * Math.cos((center.lat * Math.PI) / 180);
  const widthM = Math.max((ne.lng - sw.lng) * metresPerDegLon, 50);
  const heightM = Math.max((ne.lat - sw.lat) * metresPerDegLat, 50);
  // Leave room around the field, more in depth: the tilt magnifies the near edge.
  const metresPerPixel = Math.max(widthM / (w * 0.55), heightM / (h * 0.5));
  const zoom = Math.log2((156_543.03 * Math.cos((center.lat * Math.PI) / 180)) / metresPerPixel);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.easeTo({
    center,
    zoom: Math.min(18, Math.max(12, zoom)),
    pitch: FIT_PITCH,
    bearing: FIT_BEARING,
    duration: reduced ? 0 : 900,
  });
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
  fitKey,
  onUnavailable,
}: {
  center: LatLon;
  layout: FieldLayout;
  plots: PlotView[];
  /** The farmer's drawn field, outlined on top of the hexagons. */
  boundary: LatLon[] | null;
  onNonFarmland: (found: Map<string, NonFarmland>) => void;
  label: string;
  /** Re-frame the field when this changes, such as the selected rotation. */
  fitKey: string;
  /** Told when the browser cannot draw the map, so the caller can drop the map legend. */
  onUnavailable?: (unavailable: boolean) => void;
}) {
  const t = useTranslations("Results.plan");
  const focus = boundary ? polygonCentroid(boundary) : center;
  const { container, map, failed } = useMap([focus.lon, focus.lat], boundary ? zoomFor(boundary) : 14.6, {
    satellite: true,
  });
  const markers = useRef<Marker[]>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
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
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.55 },
      });
      map.addLayer({
        id: "fs-hex-blocked-line",
        type: "line",
        source: HEXES,
        filter: ["==", ["get", "kind"], "blocked"],
        paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [2, 1.5] },
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

  useEffect(() => {
    onUnavailable?.(failed);
  }, [failed, onUnavailable]);

  // Keep a picture of the settled map for print: a WebGL canvas often prints blank, and
  // `beforeprint` is too late to wait for a frame. Capture inside a render, while the buffer is live.
  useEffect(() => {
    if (!map) return;
    let skipNext = false;
    const capture = () => {
      try {
        setSnapshot(map.getCanvas().toDataURL("image/jpeg", 0.85));
      } catch {
        // Tainted or lost context: print falls back to the table alone.
      }
    };
    const onIdle = () => {
      if (skipNext) {
        skipNext = false;
        return;
      }
      skipNext = true;
      map.once("render", capture);
      map.triggerRepaint();
    };
    map.on("idle", onIdle);
    return () => {
      map.off("idle", onIdle);
    };
  }, [map]);

  // Fit the camera to the field once the map has loaded (after its arrival move) and per rotation.
  const bounds = fieldBounds(layout, boundary);
  const boundsKey = bounds?.toArray().flat().map((v) => v.toFixed(5)).join(",") ?? "";
  useEffect(() => {
    if (!map || !bounds) return;
    // useMap flies in on load; wait for that move to end so it does not override the fit.
    const fit = () => (map.isMoving() ? map.once("moveend", () => fitField(map, bounds)) : fitField(map, bounds));
    if (map.loaded()) fit();
    else map.once("load", fit);
    // `bounds` is rebuilt every render; `boundsKey` says when it really moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, boundsKey, fitKey]);

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

  if (failed) {
    return (
      <p role="status" className="rounded-[16px] bg-surface-sunken px-4 py-3 text-ink-muted">
        {t("mapUnavailable")}
      </p>
    );
  }

  return (
    <div className="relative print:break-inside-avoid">
      <div
        ref={container}
        role="img"
        aria-label={label}
        className="h-80 w-full overflow-hidden rounded-[16px] border border-line bg-surface-sunken sm:h-[28rem] print:hidden"
      />
      {snapshot ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL of the live map, print only
        <img src={snapshot} alt={label} className="hidden h-[5.5cm] w-full rounded-[16px] object-cover print:block" />
      ) : null}
      {/* The imagery licence asks for a clearly visible credit, not one behind the (i) button. */}
      <p className="absolute bottom-2 left-2 z-[1] print:static print:mt-1 print:bg-transparent print:px-0 max-w-[calc(100%-3.5rem)] rounded-md bg-surface/90 px-2 py-0.5 text-xs leading-snug text-ink">
        <a href={SATELLITE_ATTRIBUTION.href} target="_blank" rel="noopener" className="underline-offset-2 hover:underline">
          {SATELLITE_ATTRIBUTION.text}
        </a>
      </p>
    </div>
  );
}
