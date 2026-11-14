"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { LatLon } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { AlertIcon, PinIcon } from "@/components/ui/icons";
import type { MapMode } from "../field-map";
import { searchCommunes, type Commune } from "./communes";

export const MIN_FIELD_HA = 1;
export const MAX_FIELD_HA = 1200;
/** Zoom for a commune picked in the search: the village and its fields around it. */
const COMMUNE_ZOOM = 13.5;
/** Zoom for the farmer's own location: close enough to see parcels. */
const LOCATION_ZOOM = 15;

function PlaceSearch({
  communes,
  onPick,
  action,
}: {
  communes: Commune[];
  onPick: (commune: Commune) => void;
  /** Shown beside the search box, wrapping under it on narrow screens. */
  action?: ReactNode;
}) {
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
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (results[0]) pick(results[0]);
  }

  const showResults =
    query.trim() !== "" && !(results.length === 1 && results[0].name === query);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-q`} className="font-medium">
        {t("label")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("placeholder")}
          autoComplete="off"
          aria-describedby={`${id}-status`}
          className="min-h-11 min-w-48 flex-1 rounded-xl border border-line bg-surface px-3 text-base outline-offset-2 placeholder:text-ink-muted focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
        />
        {action}
      </div>
      <p
        id={`${id}-status`}
        aria-live="polite"
        className={
          showResults && results.length === 0
            ? "text-sm text-ink-muted"
            : "sr-only"
        }
      >
        {showResults
          ? results.length === 0
            ? t("none")
            : t("results", { count: results.length })
          : ""}
      </p>
      {showResults && results.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {results.map((commune) => (
            <li key={`${commune.name}-${commune.point.lat}`}>
              <button
                type="button"
                onClick={() => pick(commune)}
                className="press flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left hover:bg-surface-sunken"
              >
                <PinIcon size={18} className="shrink-0 text-ink-muted" />
                <span className="font-medium">{commune.name}</span>
                <span className="text-ink-muted">{commune.county}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LocateButton({
  onFound,
  onFailed,
}: {
  onFound: (point: LatLon) => void;
  onFailed: (failed: boolean) => void;
}) {
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
        onFound({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      // Refused, unavailable or too slow: say so once, quietly, and let them search instead.
      () => {
        setBusy(false);
        onFailed(true);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <Button variant="secondary" onClick={locate} disabled={busy}>
      <PinIcon size={18} />
      {busy ? t("busy") : t("button")}
    </Button>
  );
}

export function FieldStep({
  communes,
  onFocus,
  mode,
  corners,
  areaHa,
  onUndo,
  onClear,
  onDone,
  onEdit,
  onRestart,
}: {
  communes: Commune[];
  onFocus: (point: LatLon, zoom: number) => void;
  mode: MapMode;
  corners: LatLon[];
  areaHa: number;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
  onEdit: () => void;
  onRestart: () => void;
}) {
  const t = useTranslations("Field");
  const locale = useAppLocale();
  const [locateFailed, setLocateFailed] = useState(false);
  const tooSmall = corners.length >= 3 && areaHa < MIN_FIELD_HA;
  const tooBig = areaHa > MAX_FIELD_HA;
  const canFinish = corners.length >= 3 && !tooSmall && !tooBig;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("field.title")}
        </h1>
        <p className="mt-1 text-ink-muted">{t("field.hint")}</p>
      </header>

      {mode === "draw" ? (
        <div className="flex flex-col gap-1">
          <PlaceSearch
            communes={communes}
            onPick={(c) => onFocus(c.point, COMMUNE_ZOOM)}
            action={
              <LocateButton
                onFound={(point) => onFocus(point, LOCATION_ZOOM)}
                onFailed={setLocateFailed}
              />
            }
          />
          <p aria-live="polite" className="text-sm text-ink-muted">
            {locateFailed ? t("locate.failed") : ""}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="text-sm text-ink-muted">
          {mode === "draw" ? t("draw.hint") : t("draw.yourField")}
        </p>
        <p aria-live="polite">
          <span className="block font-display text-4xl font-semibold tabular-nums tracking-tight">
            {t("draw.area", { ha: formatNumber(areaHa, locale, 1) })}
          </span>
          <span className="block text-ink-muted tabular-nums">
            {t("draw.cornerCount", { corners: corners.length })}
          </span>
        </p>
        {tooSmall || tooBig ? (
          <p className="flex items-start gap-2 font-medium text-status-bad">
            <AlertIcon size={18} className="mt-0.5 shrink-0" />
            {tooSmall
              ? t("draw.tooSmall", { min: MIN_FIELD_HA })
              : t("draw.tooBig", {
                  max: formatNumber(MAX_FIELD_HA, locale, 0),
                })}
          </p>
        ) : null}
        {mode === "draw" ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={corners.length === 0}
              onClick={onUndo}
            >
              {t("draw.undo")}
            </Button>
            <Button
              variant="secondary"
              disabled={corners.length === 0}
              onClick={onClear}
            >
              {t("draw.clear")}
            </Button>
            <Button disabled={!canFinish} onClick={onDone}>
              {t("draw.done")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onEdit}>
              {t("draw.edit")}
            </Button>
            <Button variant="secondary" onClick={onRestart}>
              {t("draw.restart")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
