"use client";

import { useEffect, useRef } from "react";
import { LngLatBounds, Marker } from "maplibre-gl";
import type { CropOutlook, Zone } from "@/lib/contracts";
import { useMap } from "@/components/map/use-map";
import { RISK_TONE } from "@/components/ui/tone";

const MARKER_SYMBOL = { good: "✓", watch: "!", bad: "✕", nodata: "–" } as const;

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
  const center = zones[0]?.centroid ?? { lat: 46.3, lon: 23.75 };
  const { container, map } = useMap([center.lon, center.lat], 9);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!map || zones.length === 0) return;
    const bounds = new LngLatBounds();
    zones.forEach((z) => bounds.extend([z.centroid.lon, z.centroid.lat]));
    map.fitBounds(bounds, { padding: 48, maxZoom: 11, duration: 0 });
  }, [map, zones]);

  useEffect(() => {
    if (!map) return;
    const markers = zones.map((zone) => {
      const outlook = outlookFor(zone);
      const tone = outlook ? RISK_TONE[outlook.availability.level] : "nodata";
      const el = document.createElement("button");
      el.type = "button";
      el.className = `zone-marker zone-marker--${tone}`;
      el.textContent = MARKER_SYMBOL[tone];
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
      className="h-72 w-full overflow-hidden rounded-2xl border border-border bg-surface-muted sm:h-96"
    />
  );
}
