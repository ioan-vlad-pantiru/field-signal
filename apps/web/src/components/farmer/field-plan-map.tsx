"use client";

import { useEffect, useRef } from "react";
import { Marker, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { Crop, LatLon } from "@/lib/contracts";
import { CROP_COLORS, CROP_HEIGHT_M } from "@/lib/crops";
import type { FieldLayout } from "@/lib/field-plan";
import { useMap } from "@/components/map/use-map";

/** Crops are a few metres tall at most; exaggerate so the difference reads from above. */
const HEIGHT_EXAGGERATION = 12;
const GROW_MS = 700;
const PLOTS = "fs-plots";
const OUTLINE = "fs-field-outline";

export interface PlotView {
  id: string;
  crop: Crop;
  label: string;
}

type PlotsData = Extract<Parameters<GeoJSONSource["setData"]>[0], { type: "FeatureCollection" }>;

function plotsGeoJSON(layout: FieldLayout, plots: PlotView[]): PlotsData {
  return {
    type: "FeatureCollection",
    features: layout.plots.map((plot, i) => ({
      type: "Feature",
      properties: {
        color: CROP_COLORS[plots[i].crop],
        h: CROP_HEIGHT_M[plots[i].crop] * HEIGHT_EXAGGERATION,
      },
      geometry: { type: "Polygon", coordinates: [plot.ring] },
    })),
  };
}

function whenStyleReady(map: MapLibreMap, run: () => void) {
  if (map.isStyleLoaded()) run();
  else map.once("load", run);
}

/** The farmer's field on the 3D map, one coloured, extruded plot per rotation strip. */
export function FieldPlanMap({
  center,
  layout,
  plots,
  label,
}: {
  center: LatLon;
  layout: FieldLayout;
  plots: PlotView[];
  label: string;
}) {
  const { container, map } = useMap([center.lon, center.lat], 14.7);
  const markers = useRef<Marker[]>([]);

  // Layers and plot labels, once per map.
  useEffect(() => {
    if (!map) return;
    whenStyleReady(map, () => {
      map.addSource(PLOTS, { type: "geojson", data: plotsGeoJSON(layout, plots) });
      map.addSource(OUTLINE, {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: layout.outline } },
      });
      map.addLayer({
        id: PLOTS,
        type: "fill-extrusion",
        source: PLOTS,
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": ["get", "h"],
          "fill-extrusion-opacity": 0.92,
        },
      });
      map.addLayer({
        id: OUTLINE,
        type: "line",
        source: OUTLINE,
        paint: { "line-color": "#ffffff", "line-width": 3 },
      });
      markers.current = layout.plots.map((plot) => {
        const el = document.createElement("div");
        el.className = "plot-label";
        el.setAttribute("aria-hidden", "true");
        return new Marker({ element: el }).setLngLat(plot.centroid).addTo(map);
      });
    });
    return () => {
      markers.current.forEach((m) => m.remove());
      markers.current = [];
    };
    // The layout only changes with a new analysis, which remounts this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // New season or strategy: recolour the plots and let them grow up from the ground.
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    whenStyleReady(map, () => {
      const source = map.getSource<GeoJSONSource>(PLOTS);
      if (!source) return;
      source.setData(plotsGeoJSON(layout, plots));
      markers.current.forEach((marker, i) => {
        marker.getElement().textContent = `${plots[i].id} · ${plots[i].label}`;
      });
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const start = performance.now();
      const grow = (now: number) => {
        const t = reduced ? 1 : Math.min(1, (now - start) / GROW_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        map.setPaintProperty(PLOTS, "fill-extrusion-height", ["*", ["get", "h"], eased]);
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
