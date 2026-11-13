"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type LngLatLike,
  type RasterDEMSourceSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// OpenFreeMap: free vector tiles, no API key. Tiles need the network; the rest of the
// screen (zone list, form) keeps working without them.
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
// Copied from node_modules by scripts/copy-maplibre-worker.mjs.
const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";
// Mapzen/AWS Terrain Tiles (Terrarium encoding): open elevation data, no key.
const TERRAIN_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";

const TERRAIN_EXAGGERATION = 1.5;
const BUILDINGS_MIN_ZOOM = 14;

/** Camera tilt for a zoom level: flat when zoomed out, ~60° close in, so relief and buildings read in 3D. */
function pitchForZoom(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - 10) / 5));
  return Math.round(t * 60);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Terrain + hillshade, sky and 3D buildings, added once the base style has loaded. */
function addThreeD(map: MapLibreMap, dark: boolean) {
  const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  const dem: RasterDEMSourceSpecification = {
    type: "raster-dem",
    tiles: [TERRAIN_TILES],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 14,
  };
  map.addSource("fs-terrain", dem);
  map.addSource("fs-hillshade", dem);
  map.addLayer(
    {
      id: "fs-hillshade",
      type: "hillshade",
      source: "fs-hillshade",
      paint: {
        "hillshade-exaggeration": dark ? 0.35 : 0.45,
        "hillshade-shadow-color": dark ? "#000000" : "#3d4a40",
        "hillshade-highlight-color": dark ? "#2c3a31" : "#ffffff",
      },
    },
    firstLabel,
  );
  map.setTerrain({ source: "fs-terrain", exaggeration: TERRAIN_EXAGGERATION });
  map.setSky({
    "sky-color": dark ? "#0d1310" : "#cfe3f2",
    "horizon-color": dark ? "#1c2620" : "#f2f4ee",
    "fog-color": dark ? "#0d1310" : "#f2f4ee",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
  });

  // The light style ships its own 3D buildings; the dark one does not.
  const hasBuildings = map.getStyle().layers.some((layer) => layer.type === "fill-extrusion");
  if (!hasBuildings) {
    map.addLayer(
      {
        id: "fs-buildings",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: BUILDINGS_MIN_ZOOM,
        paint: {
          "fill-extrusion-color": dark ? "#2c3a31" : "#d9ddd3",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], BUILDINGS_MIN_ZOOM, 0, 15, 0.85],
        },
      },
      firstLabel,
    );
  }
}

/**
 * Creates a 3D MapLibre map in the referenced container and tears it down on unmount.
 * The camera tilts as the user zooms in until they tilt or rotate it themselves.
 */
export function useMap(center: LngLatLike, zoom: number) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const initial = useRef({ center, zoom });

  useEffect(() => {
    if (!container.current) return;
    setWorkerUrl(WORKER_URL);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const instance = new MapLibreMap({
      container: container.current,
      style: dark ? STYLE_DARK : STYLE_LIGHT,
      center: initial.current.center,
      zoom: initial.current.zoom - 1.5,
      pitch: 0,
      maxPitch: 70,
      attributionControl: { compact: true },
    });
    instance.addControl(
      new NavigationControl({ showCompass: true, visualizePitch: true }),
      "top-right",
    );

    let userTilted = false;
    instance.on("pitchstart", (event) => {
      if (event.originalEvent) userTilted = true;
    });
    instance.on("rotatestart", (event) => {
      if (event.originalEvent) userTilted = true;
    });
    instance.on("zoomend", (event) => {
      // Only follow zooms the user made, not our own camera moves.
      if (userTilted || !("originalEvent" in event && event.originalEvent)) return;
      const target = pitchForZoom(instance.getZoom());
      if (Math.abs(instance.getPitch() - target) > 4) {
        instance.easeTo({ pitch: target, duration: prefersReducedMotion() ? 0 : 700 });
      }
    });

    instance.once("load", () => {
      // Compact attribution starts expanded and covers a phone-sized map; keep it behind its (i) button.
      instance
        .getContainer()
        .querySelector(".maplibregl-compact-show")
        ?.classList.remove("maplibregl-compact-show");
      addThreeD(instance, dark);
      // Arrival: settle from a wider, flat view into the working view, slightly tilted.
      instance.flyTo({
        center: initial.current.center,
        zoom: initial.current.zoom,
        pitch: Math.max(35, pitchForZoom(initial.current.zoom)),
        bearing: -12,
        duration: prefersReducedMotion() ? 0 : 1800,
        essential: false,
      });
    });

    setMap(instance);
    return () => {
      setMap(null);
      instance.remove();
    };
  }, []);

  return { container, map };
}
