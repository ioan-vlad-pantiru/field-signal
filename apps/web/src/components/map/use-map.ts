"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type LngLatLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// OpenFreeMap: free vector tiles, no API key. Tiles need the network; the rest of the
// screen (zone list, form) keeps working without them.
const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
// Copied from node_modules by scripts/copy-maplibre-worker.mjs.
const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";

/** Creates a MapLibre map in the referenced container and tears it down on unmount. */
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
      zoom: initial.current.zoom,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    // Compact attribution starts expanded and covers a phone-sized map; keep it behind its (i) button.
    instance.once("load", () =>
      instance
        .getContainer()
        .querySelector(".maplibregl-compact-show")
        ?.classList.remove("maplibregl-compact-show"),
    );
    setMap(instance);
    return () => {
      setMap(null);
      instance.remove();
    };
  }, []);

  return { container, map };
}
