"use client";

import { useEffect, useRef } from "react";
import { Marker } from "maplibre-gl";
import type { CropOutlook, Zone } from "@/lib/contracts";
import { useMap } from "@/components/map/use-map";
import { RISK_TONE } from "@/components/ui/tone";

const MARKER_SYMBOL = { good: "✓", watch: "!", bad: "✕", nodata: "–" } as const;
/** Fits the ~20 km Sântimbru–Aiud sourcing area on a phone, with room for the 3D tilt. */
const REGION_ZOOM = 9.1;

function centroidOf(zones: Zone[]): { lat: number; lon: number } {
  if (zones.length === 0) return { lat: 46.3, lon: 23.75 };
  const sum = zones.reduce((acc, z) => ({ lat: acc.lat + z.centroid.lat, lon: acc.lon + z.centroid.lon }), { lat: 0, lon: 0 });
  return { lat: sum.lat / zones.length, lon: sum.lon / zones.length };
}

/** One button-marker per zone, coloured and labelled by availability risk for the chosen crop. */
export function ZoneMap({
  zones,
  outlookFor,
  markerLabel,
  onSelect,
  label,
}: {
  zones: Zone[];
  outlookFor: (zone: Zone) => CropOutlook | undefined;
  markerLabel: (zone: Zone, outlook: CropOutlook | undefined) => string;
  onSelect: (zone: Zone) => void;
  label: string;
}) {
  const center = centroidOf(zones);
  const { container, map } = useMap([center.lon, center.lat], REGION_ZOOM);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!map) return;
    const markers = zones.map((zone, index) => {
      const outlook = outlookFor(zone);
      const tone = outlook ? RISK_TONE[outlook.availability.level] : "nodata";
      const el = document.createElement("button");
      el.type = "button";
      el.className = `zone-marker zone-marker--${tone}`;
      el.style.setProperty("--i", String(index));
      const symbol = document.createElement("span");
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = MARKER_SYMBOL[tone];
      el.append(symbol);
      el.setAttribute("aria-label", markerLabel(zone, outlook));
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(zone);
      });
      return new Marker({ element: el }).setLngLat([zone.centroid.lon, zone.centroid.lat]).addTo(map);
    });
    return () => markers.forEach((m) => m.remove());
  }, [map, zones, outlookFor, markerLabel]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className="h-72 w-full overflow-hidden rounded-2xl border border-line bg-surface-sunken sm:h-96"
    />
  );
}
