"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type LngLatBoundsLike,
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

/**
 * Satellite basemap: EOxCloudless 2025, a cloud-free Sentinel-2 mosaic (10 m) by EOX IT Services.
 * Licence CC BY-NC-SA 4.0 for non-commercial use, open WMTS without a key; the attribution must
 * be clearly visible on the map. Native tiles stop at zoom 15 and are overzoomed beyond.
 * To change the source, change these three constants (and TILE_HOSTS in public/sw.js).
 */
const SATELLITE_TILES =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg";
const SATELLITE_MAX_ZOOM = 15;
export const SATELLITE_ATTRIBUTION = {
  text: "EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)",
  href: "https://cloudless.eox.at",
} as const;
const SATELLITE = "fs-satellite";

export type Basemap = "map" | "satellite";

/** MapLibre's hint for cooperative gestures, in the page language (MapLibre ships English only). */
const GESTURE_HELP_RO = {
  "CooperativeGesturesHandler.WindowsHelpText": "Folosiți Ctrl + rotița ca să măriți harta",
  "CooperativeGesturesHandler.MacHelpText": "Folosiți ⌘ + rotița ca să măriți harta",
  "CooperativeGesturesHandler.MobileHelpText": "Folosiți două degete ca să mutați harta",
};

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

/** Satellite imagery under the labels, so place and road names stay readable on top of it. */
function addSatellite(map: MapLibreMap, visible: boolean) {
  const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
  map.addSource(SATELLITE, {
    type: "raster",
    tiles: [SATELLITE_TILES],
    tileSize: 256,
    maxzoom: SATELLITE_MAX_ZOOM,
    attribution: `<a href="${SATELLITE_ATTRIBUTION.href}" target="_blank" rel="noopener">${SATELLITE_ATTRIBUTION.text}</a>`,
  });
  map.addLayer({ id: SATELLITE, type: "raster", source: SATELLITE, paint: { "raster-fade-duration": 0 } }, firstLabel);
  applyBasemap(map, visible ? "satellite" : "map");
}

function applyBasemap(map: MapLibreMap, basemap: Basemap) {
  if (!map.getLayer(SATELLITE)) return;
  const satellite = basemap === "satellite";
  map.setLayoutProperty(SATELLITE, "visibility", satellite ? "visible" : "none");
  // Extruded buildings would stand on top of the photo; the photo already shows them.
  for (const layer of map.getStyle().layers) {
    if (layer.type === "fill-extrusion") map.setLayoutProperty(layer.id, "visibility", satellite ? "none" : "visible");
  }
}

/** Switches a map made with `useMap(…, { satellite })` between the street map and satellite imagery. */
export function setBasemap(map: MapLibreMap, basemap: Basemap) {
  if (map.getLayer(SATELLITE)) applyBasemap(map, basemap);
  else map.once("load", () => applyBasemap(map, basemap));
}

/**
 * Creates a 3D MapLibre map in the referenced container and tears it down on unmount.
 * The camera tilts as the user zooms in until they tilt or rotate it themselves.
 */
export function useMap(
  center: LngLatLike,
  zoom: number,
  /**
   * `satellite`: add the satellite layer, shown at start; switch it with `setBasemap`. Off by default.
   * `cooperativeGestures`: the page scrolls past the map; zoom needs Ctrl/⌘ + wheel, pan needs two
   * fingers. For maps that sit in a scrolling page; off where the map is the task (drawing a field).
   * `bounds`: land on a view that shows all of it (on a narrow phone, below `zoom`), never closer than `zoom`.
   * `flat`: no terrain, tilt or rotation — for data layers drawn over a wide area, which a tilt distorts.
   */
  options: { satellite?: boolean; cooperativeGestures?: boolean; bounds?: LngLatBoundsLike; flat?: boolean } = {},
) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  /** True when the browser cannot draw a map (no WebGL): callers show a message instead. */
  const [failed, setFailed] = useState(false);
  const initial = useRef({
    center,
    zoom,
    satellite: options.satellite ?? false,
    cooperativeGestures: options.cooperativeGestures ?? false,
    bounds: options.bounds,
    flat: options.flat ?? false,
  });

  useEffect(() => {
    if (!container.current) return;
    setWorkerUrl(WORKER_URL);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
        container: container.current,
        style: dark ? STYLE_DARK : STYLE_LIGHT,
        center: initial.current.center,
        zoom: initial.current.zoom - 1.5,
        pitch: 0,
        maxPitch: 70,
        attributionControl: { compact: true },
        cooperativeGestures: initial.current.cooperativeGestures,
        locale: document.documentElement.lang === "ro" ? GESTURE_HELP_RO : undefined,
      });
    } catch {
      // MapLibre throws when WebGL is unavailable (old devices, GPU off, some headless browsers).
      // The page must keep working without the map; `map` stays null and `failed` tells the caller.
      // Only known once construction is tried, so this state change has to happen in the effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
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
      if (initial.current.flat) return;
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
      if (!initial.current.flat) addThreeD(instance, dark);
      if (initial.current.satellite) addSatellite(instance, true);
      // Arrival: settle from a wider, flat view into the working view, slightly tilted.
      const { bounds } = initial.current;
      const fit = bounds
        ? instance.cameraForBounds(bounds, { padding: { top: 80, bottom: 48, left: 32, right: 32 }, maxZoom: initial.current.zoom })
        : undefined;
      instance.flyTo({
        center: fit?.center ?? initial.current.center,
        zoom: fit?.zoom ?? initial.current.zoom,
        pitch: initial.current.flat ? 0 : Math.max(35, pitchForZoom(initial.current.zoom)),
        bearing: initial.current.flat ? 0 : -12,
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

  return { container, map, failed };
}
