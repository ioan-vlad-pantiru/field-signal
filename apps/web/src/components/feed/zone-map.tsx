"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Marker, type LngLatBoundsLike } from "maplibre-gl";
import type { CropOutlook, Zone } from "@/lib/contracts";
import { useMap } from "@/components/map/use-map";
import { RISK_TONE } from "@/components/ui/tone";

const MARKER_SYMBOL = { good: "✓", watch: "!", bad: "✕", nodata: "–" } as const;
/** Fits the ~20 km Sântimbru–Aiud sourcing area on a phone, with room for the 3D tilt. */
const REGION_ZOOM = 9.1;
/** The drawn marker is 34 px; the invisible ring widens the touch target to 44 px. */
const HIT_AREA = "after:absolute after:-inset-[5px] after:rounded-full after:content-['']";
/** The commune open in the details: a ring around its marker, matching its selected table row. */
const SELECTED = ["outline-solid", "outline-3", "outline-offset-2", "outline-ink", "z-[1]"];

/** The box around every commune, so a narrow phone can zoom out until all of them show. */
function boundsOf(zones: Zone[]): LngLatBoundsLike | undefined {
  if (zones.length < 2) return undefined;
  const lons = zones.map((z) => z.centroid.lon);
  const lats = zones.map((z) => z.centroid.lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

function centroidOf(zones: Zone[]): { lat: number; lon: number } {
  if (zones.length === 0) return { lat: 46.3, lon: 23.75 };
  const sum = zones.reduce((acc, z) => ({ lat: acc.lat + z.centroid.lat, lon: acc.lon + z.centroid.lon }), { lat: 0, lon: 0 });
  return { lat: sum.lat / zones.length, lon: sum.lon / zones.length };
}

/**
 * One button-marker per zone, coloured and labelled by availability risk for the chosen crop.
 * The selected zone's marker gets a ring and `aria-pressed`.
 */
export function ZoneMap({
  zones,
  outlookFor,
  markerLabel,
  onSelect,
  selectedId,
  label,
  className = "",
}: {
  zones: Zone[];
  outlookFor: (zone: Zone) => CropOutlook | undefined;
  markerLabel: (zone: Zone, outlook: CropOutlook | undefined) => string;
  onSelect: (zone: Zone) => void;
  selectedId: string | null;
  label: string;
  className?: string;
}) {
  const center = centroidOf(zones);
  const t = useTranslations("Feed");
  const { container, map, failed } = useMap([center.lon, center.lat], REGION_ZOOM, {
    cooperativeGestures: true,
    bounds: boundsOf(zones),
  });
  const onSelectRef = useRef(onSelect);
  const elements = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!map) return;
    const byId = elements.current;
    const markers = zones.map((zone, index) => {
      const outlook = outlookFor(zone);
      const tone = outlook ? RISK_TONE[outlook.availability.level] : "nodata";
      const el = document.createElement("button");
      el.type = "button";
      el.className = `zone-marker zone-marker--${tone} ${HIT_AREA}`;
      el.style.setProperty("--i", String(index));
      const symbol = document.createElement("span");
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = MARKER_SYMBOL[tone];
      el.append(symbol);
      el.setAttribute("aria-label", markerLabel(zone, outlook));
      el.setAttribute("aria-pressed", "false");
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(zone);
      });
      byId.set(zone.id, el);
      return new Marker({ element: el }).setLngLat([zone.centroid.lon, zone.centroid.lat]).addTo(map);
    });
    return () => {
      markers.forEach((m) => m.remove());
      byId.clear();
    };
  }, [map, zones, outlookFor, markerLabel]);

  // Runs after the marker effect above, so a crop change keeps the ring on the selected zone.
  useEffect(() => {
    for (const [id, el] of elements.current) {
      const selected = id === selectedId;
      for (const c of SELECTED) el.classList.toggle(c, selected);
      el.setAttribute("aria-pressed", String(selected));
    }
  }, [map, zones, outlookFor, markerLabel, selectedId]);

  if (failed) {
    // No WebGL: the table holds the same communes and risks, so say so instead of an empty box.
    return (
      <div
        role="status"
        className={`flex w-full items-center justify-center bg-surface-sunken p-6 text-center text-ink-muted ${className}`}
      >
        {t("mapUnavailable")}
      </div>
    );
  }

  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className={`w-full overflow-hidden bg-surface-sunken ${className}`}
    />
  );
}
