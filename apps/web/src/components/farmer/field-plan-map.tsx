"use client";

import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Marker, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { Crop, LatLon } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { polygonCentroid, radiusMetres } from "@/lib/geo";
import { useTranslations } from "next-intl";
import { SATELLITE_ATTRIBUTION, useMap } from "@/components/map/use-map";

/** The season's crop fades in over the field: draped on the 3D terrain, never cut by a hill. */
const FADE_MS = 600;
const FILL_OPACITY = 0.6;
const FIELD = "fs-field";
/** Camera over the field: tilted enough to read the crop, turned a little like the arrival view. */
const FIT_PITCH = 50;
const FIT_BEARING = -12;
/** Without a drawn outline the field is a disc of this radius around the pin. */
const PIN_RADIUS_M = 180;

type FieldData = Extract<Parameters<GeoJSONSource["setData"]>[0], { type: "Feature" }>;

function ring(outline: LatLon[]): [number, number][] {
  const r = outline.map((c): [number, number] => [c.lon, c.lat]);
  return [...r, r[0]];
}

/** A disc around the pin, for a field opened without an outline. */
function disc(center: LatLon): LatLon[] {
  const dLat = PIN_RADIUS_M / 111_320;
  const dLon = dLat / Math.cos((center.lat * Math.PI) / 180);
  return Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI;
    return { lat: center.lat + dLat * Math.sin(a), lon: center.lon + dLon * Math.cos(a) };
  });
}

function fieldData(outlines: LatLon[][], crop: Crop): FieldData {
  return {
    type: "Feature",
    properties: { color: CROP_COLORS[crop] },
    geometry: { type: "MultiPolygon", coordinates: outlines.map((o) => [ring(o)]) },
  };
}

/** Zoom that fits a field of this size in the plan map, with room for the 3D tilt. */
function zoomFor(boundary: LatLon[]): number {
  const radius = radiusMetres(polygonCentroid(boundary), boundary);
  return Math.max(12, Math.min(16.5, 14.6 - Math.log2(Math.max(radius, 1) / 370)));
}

function boundsOf(outlines: LatLon[][]): LngLatBounds | null {
  const points = outlines.flat().map((c): [number, number] => [c.lon, c.lat]);
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
  const metresPerPixel = Math.max(widthM / (w * 0.45), heightM / (h * 0.4));
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
 * The farmer's own field on the 3D satellite map, following its outline (every part): filled in
 * the colour of the season's crop and outlined, both draped on the terrain so they follow the
 * ground on slopes, with the crop named on the field.
 */
export function FieldPlanMap({
  center,
  boundary,
  parts = [],
  crop,
  cropLabel,
  label,
  fitKey,
  onUnavailable,
}: {
  center: LatLon;
  /** The farmer's drawn field; null draws a disc around the pin. */
  boundary: LatLon[] | null;
  /** Further pieces of the same field. */
  parts?: LatLon[][];
  /** The season's crop, on the whole field. */
  crop: Crop;
  cropLabel: string;
  label: string;
  /** Re-frame the field when this changes, such as the selected rotation. */
  fitKey: string;
  /** Told when the browser cannot draw the map, so the caller can drop the map legend. */
  onUnavailable?: (unavailable: boolean) => void;
}) {
  const t = useTranslations("Results.plan");
  const outlines = boundary ? [boundary, ...parts] : [disc(center)];
  const focus = boundary ? polygonCentroid(boundary) : center;
  const { container, map, failed } = useMap([focus.lon, focus.lat], zoomFor(outlines[0]), {
    satellite: true,
    cooperativeGestures: true,
  });
  const marker = useRef<Marker | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  // Layers once per map: the raised field, its outline, and a soft ground shadow.
  useEffect(() => {
    if (!map) return;
    whenStyleReady(map, () => {
      map.addSource(FIELD, { type: "geojson", data: fieldData(outlines, crop) });
      // Fill and outline are draped on the terrain, so they follow every slope of the field.
      // A raised (fill-extrusion) field sits at one height and a hillside cuts through it.
      map.addLayer({
        id: "fs-field-crop",
        type: "fill",
        source: FIELD,
        paint: { "fill-color": ["get", "color"], "fill-opacity": FILL_OPACITY },
      });
      map.addLayer({
        id: "fs-field-outline",
        type: "line",
        source: FIELD,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 3, "line-opacity": 0.95 },
      });
    });
    return () => {
      marker.current?.remove();
      marker.current = null;
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
        // Tainted or lost context: print shows the season list alone.
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
  const bounds = boundsOf(outlines);
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

  // New season or rotation: recolour, rename the crop on the field, and fade the crop in.
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    whenStyleReady(map, () => {
      const source = map.getSource<GeoJSONSource>(FIELD);
      if (!source) return;
      source.setData(fieldData(outlines, crop));

      marker.current?.remove();
      const el = document.createElement("div");
      el.className = "plot-label";
      el.setAttribute("aria-hidden", "true");
      const dot = document.createElement("span");
      dot.className = "plot-label-dot";
      dot.style.background = CROP_COLORS[crop];
      el.append(dot, document.createTextNode(cropLabel));
      const at = polygonCentroid(outlines[0]);
      marker.current = new Marker({ element: el }).setLngLat([at.lon, at.lat]).addTo(map);

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const start = performance.now();
      const fade = (now: number) => {
        const k = reduced ? 1 : Math.min(1, (now - start) / FADE_MS);
        const eased = 1 - Math.pow(1 - k, 3);
        map.setPaintProperty("fs-field-crop", "fill-opacity", FILL_OPACITY * (0.25 + 0.75 * eased));
        if (k < 1) frame = requestAnimationFrame(fade);
      };
      frame = requestAnimationFrame(fade);
    });
    return () => cancelAnimationFrame(frame);
    // `outlines` is rebuilt every render from the same props; the crop drives the update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, crop, cropLabel, boundsKey]);

  if (failed) {
    return (
      <p role="status" className="rounded-[var(--radius-lg)] bg-surface-sunken px-4 py-3 text-ink-muted">
        {t("mapUnavailable")}
      </p>
    );
  }

  return (
    <div className="relative print:break-inside-avoid" style={{ viewTransitionName: "none" }}>
      <div
        ref={container}
        role="img"
        aria-label={label}
        className="h-[min(56svh,26rem)] w-full overflow-hidden rounded-[var(--radius-xl)] bg-surface-sunken shadow-1 sm:h-[28rem] print:hidden"
      />
      {snapshot ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL of the live map, print only
        <img src={snapshot} alt={label} className="hidden h-[5.5cm] w-full rounded-[var(--radius-lg)] object-cover print:block" />
      ) : null}
      {/* The imagery licence asks for a clearly visible credit, not one behind the (i) button. */}
      <p className="absolute bottom-2 left-2 z-[1] flex max-w-[calc(100%-3.5rem)] print:static print:mt-1 print:max-w-none print:bg-transparent print:px-0">
        {/* One line on screen (full text on hover and in print), so it never covers the field. */}
        <a
          href={SATELLITE_ATTRIBUTION.href}
          target="_blank"
          rel="noopener"
          title={SATELLITE_ATTRIBUTION.text}
          className="truncate rounded-xs bg-glass px-1.5 text-[11px] leading-4 text-ink underline-offset-2 hover:underline print:whitespace-normal"
        >
          {SATELLITE_ATTRIBUTION.text}
        </a>
      </p>
    </div>
  );
}
