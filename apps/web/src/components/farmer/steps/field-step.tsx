"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { LatLon } from "@/lib/contracts";
import { IconButton } from "@/components/ui/button";
import { LocateIcon, PinIcon, SearchIcon } from "@/components/ui/icons";
import { searchCommunes, type Commune } from "./communes";

export const MIN_FIELD_HA = 1;
export const MAX_FIELD_HA = 1200;
/** Zoom for a commune picked in the search: the village and its fields around it. */
export const COMMUNE_ZOOM = 13.5;
/** Zoom for the farmer's own location: close enough to see parcels. */
export const LOCATION_ZOOM = 15;

/** The search pill floating on the map; matches drop down under it. */
export function PlaceSearch({ communes, onPick }: { communes: Commune[]; onPick: (commune: Commune) => void }) {
  const t = useTranslations("Field.search");
  const id = useId();
  const [query, setQuery] = useState("");
  const results = searchCommunes(communes, query);

  function pick(commune: Commune) {
    setQuery(commune.name);
    onPick(commune);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter picks the first match instead of submitting the form.
    if (event.key === "Escape") setQuery("");
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (results[0]) pick(results[0]);
  }

  const showResults = query.trim() !== "" && !(results.length === 1 && results[0].name === query);

  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor={`${id}-q`} className="sr-only">
        {t("label")}
      </label>
      <SearchIcon size={18} className="pointer-events-none absolute left-4 top-[1.375rem] z-[1] -translate-y-1/2 text-ink-muted" />
      <input
        id={`${id}-q`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("placeholder")}
        autoComplete="off"
        role="combobox"
        aria-expanded={showResults && results.length > 0}
        aria-controls={`${id}-list`}
        aria-describedby={`${id}-status`}
        className="min-h-tap w-full rounded-pill bg-glass pl-11 pr-4 text-base shadow-float outline-offset-2 backdrop-blur-md placeholder:text-ink-muted focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
      />
      <p id={`${id}-status`} aria-live="polite" className="sr-only">
        {showResults ? (results.length === 0 ? t("none") : t("results", { count: results.length })) : ""}
      </p>
      {showResults ? (
        <ul
          id={`${id}-list`}
          className="absolute inset-x-0 top-full z-10 mt-2 max-h-72 overflow-y-auto rounded-[var(--radius-lg)] bg-surface-raised p-1.5 shadow-float"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-ink-muted">{t("none")}</li>
          ) : (
            results.map((commune) => (
              <li key={`${commune.name}-${commune.point.lat}`}>
                <button
                  type="button"
                  onClick={() => pick(commune)}
                  className="press flex min-h-tap w-full items-center gap-2 rounded-[var(--radius-md)] px-3 text-left hover:bg-surface-sunken"
                >
                  <PinIcon size={18} className="shrink-0 text-ink-muted" />
                  <span className="font-semibold">{commune.name}</span>
                  <span className="text-sm text-ink-muted">{commune.county}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** Round "use my location" button; says once, quietly, when the location is not available. */
export function LocateButton({ onFound, onFailed }: { onFound: (point: LatLon) => void; onFailed: (failed: boolean) => void }) {
  const t = useTranslations("Field.locate");
  const [busy, setBusy] = useState(false);

  function locate() {
    if (!("geolocation" in navigator)) {
      onFailed(true);
      return;
    }
    setBusy(true);
    onFailed(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        onFound({ lat: position.coords.latitude, lon: position.coords.longitude });
      },
      () => {
        setBusy(false);
        onFailed(true);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <IconButton label={busy ? t("busy") : t("button")} variant="float" onClick={locate} disabled={busy} aria-busy={busy}>
      <LocateIcon size={20} className={busy ? "animate-pulse motion-reduce:animate-none" : ""} />
    </IconButton>
  );
}
