"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Placeholder map centred on Romania. Swap the style for a real basemap later.
const DEMO_STYLE = "https://demotiles.maplibre.org/style.json";

export function RomaniaMap({ label }: { label: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = new MapLibreMap({
      container: container.current,
      style: DEMO_STYLE,
      center: [24.97, 45.94],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl(), "top-right");
    return () => map.remove();
  }, []);

  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className="h-72 w-full overflow-hidden rounded-lg border border-foreground/10 sm:h-96"
    />
  );
}
