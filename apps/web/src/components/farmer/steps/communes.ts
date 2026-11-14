"use client";

import { useEffect, useState } from "react";
import { getSourcingRegion } from "@/lib/api";
import type { LatLon, SourcingRegion } from "@/lib/contracts";
import { mockSourcingRegion } from "@/lib/mocks";

/** A commune the farmer can jump to: the sourcing zones' names and centroids, no geocoder. */
export interface Commune {
  name: string;
  county: string;
  point: LatLon;
}

function toCommunes(region: SourcingRegion): Commune[] {
  return region.zones
    .map((zone) => ({ name: zone.name, county: zone.county, point: zone.centroid }))
    .sort((a, b) => a.name.localeCompare(b.name, "ro"));
}

/** The bundled zones at once, replaced by the API's list when it answers. */
export function useCommunes(): Commune[] {
  const [communes, setCommunes] = useState(() => toCommunes(mockSourcingRegion));
  useEffect(() => {
    let live = true;
    getSourcingRegion()
      .then((loaded) => {
        if (live && loaded.origin === "api" && loaded.data.zones.length > 0) setCommunes(toCommunes(loaded.data));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return communes;
}

/** Lower case without diacritics, so "santimbru" finds "Sântimbru". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function searchCommunes(communes: Commune[], query: string, limit = 6): Commune[] {
  const q = fold(query);
  if (!q) return [];
  const starts = communes.filter((c) => fold(c.name).startsWith(q));
  const contains = communes.filter((c) => !fold(c.name).startsWith(q) && fold(`${c.name} ${c.county}`).includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** The closest commune centroid, if it is within `maxKm`. */
export function nearestCommune(communes: Commune[], point: LatLon, maxKm = 30): Commune | null {
  let best: Commune | null = null;
  let bestKm = Infinity;
  for (const c of communes) {
    const dy = (c.point.lat - point.lat) * 111.32;
    const dx = (c.point.lon - point.lon) * 111.32 * Math.cos((point.lat * Math.PI) / 180);
    const km = Math.hypot(dx, dy);
    if (km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return bestKm <= maxKm ? best : null;
}
