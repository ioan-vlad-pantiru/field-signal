"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { useMap } from "@/components/map/use-map";
import { Chip, ChipRow } from "@/components/ui/chip";
import { Segmented } from "@/components/ui/segmented";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { TONE_CLASSES, type Tone } from "@/components/ui/tone";

const OUTLOOK = "/data/yield-outlook.json";
const BORDERS = "/data/nuts3.geojson";
const COUNTRIES = "/data/countries.geojson";
/** The 136 NUTS3 zones we forecast for: the Alps to the Black Sea. */
const BOUNDS: [number, number, number, number] = [9, 41, 30, 50];
const FILL = "outlook-fill";
const EDGE = "outlook-edge";
const COUNTRY = "outlook-country";
const TONES: Tone[] = ["good", "watch", "bad"];


/** `[p10, p50, p90, normal]` in t/ha. */
type Reading = [number, number, number, number];
interface Outlook {
  years: number[];
  crops: string[];
  zones: Record<string, string>;
  values: Record<string, Record<string, Record<string, Reading>>>;
}

type Collection = Extract<Parameters<GeoJSONSource["setData"]>[0], { type: "FeatureCollection" }>;
type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; outlook: Outlook; borders: Collection; countries: Collection | null };

/**
 * How much of the typical harvest a bad weather year takes away (p10 against p50). P50 is now the
 * regional average yield, so comparing it with the normal would paint nearly every zone yellow.
 */
const SMALL_LOSS = 0.1;
const MEDIUM_LOSS = 0.2;

function lossOf(reading: Reading): number {
  return 1 - reading[0] / reading[1];
}

function toneOf(reading: Reading): Tone {
  const loss = lossOf(reading);
  return loss < SMALL_LOSS ? "good" : loss < MEDIUM_LOSS ? "watch" : "bad";
}

/**
 * Buyers › Region: one map of the zones we forecast, coloured by predicted yield against each
 * zone's own normal, with a year and a crop switch and the tapped zone's numbers.
 */
export function YieldOutlook({
  crop,
  onCrop,
  year,
  onYear,
}: {
  crop: string;
  onCrop: (crop: string) => void;
  year: string | null;
  onYear: (year: string) => void;
}) {
  const t = useTranslations("Outlook");
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(OUTLOOK).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch(BORDERS).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      // The country outlines are a nicety: a missing file must not take the map down.
      fetch(COUNTRIES)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([outlook, borders, countries]) => active && setState({ status: "ready", outlook, borders, countries }))
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status !== "ready") {
    return (
      <div className="flex flex-col gap-5">
        <ScreenHeader title={t("title")} />
        {state.status === "loading" ? (
          <>
            <p role="status" aria-live="polite" className="sr-only">
              {t("loading")}
            </p>
            <Skeleton className="h-tap w-64 rounded-pill" />
            <Skeleton className="h-[min(70svh,720px)]" />
          </>
        ) : (
          <ErrorState
            onRetry={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            {t("error")}
          </ErrorState>
        )}
      </div>
    );
  }

  const { outlook, borders, countries } = state;
  const shownYear = year ?? String(outlook.years[0]);
  const shownCrop = outlook.crops.includes(crop) ? crop : outlook.crops[0];
  const readings = outlook.values[shownYear][shownCrop];
  const reading = selected ? readings[selected] : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <ScreenHeader title={t("title")} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
        <Segmented
          label={t("yearLabel")}
          value={shownYear}
          onChange={onYear}
          options={outlook.years.map((y) => ({ value: String(y), label: String(y) }))}
          className="w-fit"
        />
        <CropSwitch crops={outlook.crops} value={shownCrop} onChange={onCrop} />
      </div>
      {shownCrop === "rapeseed" ? <p className="text-sm text-ink-muted">{t("rapeseedNote")}</p> : null}
      <OutlookMap
        borders={borders}
        countries={countries}
        readings={readings}
        zoneName={(id) => outlook.zones[id] ?? id}
        label={t("mapLabel", { crop: t(`crops.${shownCrop}`), year: shownYear })}
        selected={selected}
        onSelect={(id) => setSelected(id === selected ? null : id)}
      />
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {TONES.map((tone) => (
          <li key={tone} className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-3 rounded-full ${TONE_CLASSES[tone].solid}`} />
            {t(`legend.${tone}`)}
          </li>
        ))}
      </ul>
      {selected ? (
        <ZoneCard name={outlook.zones[selected] ?? selected} reading={reading} />
      ) : (
        <p className="text-sm text-ink-muted">{t("detail.empty")}</p>
      )}
    </div>
  );
}

function CropSwitch({ crops, value, onChange }: { crops: string[]; value: string; onChange: (crop: string) => void }) {
  const t = useTranslations("Outlook");
  return (
    <ChipRow label={t("cropLabel")}>
      {crops.map((crop) => (
        <Chip key={crop} selected={crop === value} onClick={() => onChange(crop)}>
          {t(`crops.${crop}`)}
        </Chip>
      ))}
    </ChipRow>
  );
}

/** The tapped zone's typical year, its bad year, and how far the two are apart. */
function ZoneCard({ name, reading }: { name: string; reading: Reading | undefined }) {
  const t = useTranslations("Outlook");
  const locale = useAppLocale();
  const n = (value: number, digits = 1) => formatNumber(value, locale, digits);
  return (
    <div className="rounded-[var(--radius-lg)] bg-surface p-4 shadow-1">
      <h2 className="text-lg font-semibold">{name}</h2>
      {reading ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-ink-muted">{t("detail.typical")}</dt>
          <dd className="font-semibold tabular-nums">{n(reading[1])} t/ha</dd>
          <dt className="text-ink-muted">{t("detail.lowest")}</dt>
          <dd className="tabular-nums">{n(reading[0])} t/ha</dd>
          <dt className="text-ink-muted">{t("detail.spread")}</dt>
          <dd className={`font-semibold tabular-nums ${TONE_CLASSES[toneOf(reading)].text}`}>
            -{n(lossOf(reading) * 100, 0)} %
          </dd>
          <dt className="col-span-2 text-ink-muted sm:col-span-4">
            {t("detail.range", { low: n(reading[0]), high: n(reading[2]) })}
          </dt>
        </dl>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">{t("detail.none")}</p>
      )}
    </div>
  );
}

/** The borders as a choropleth: a `match` on the zone id, and a click that reports the zone. */
function OutlookMap({
  borders,
  countries,
  readings,
  zoneName,
  label,
  selected,
  onSelect,
}: {
  borders: Collection;
  countries: Collection | null;
  readings: Record<string, Reading>;
  zoneName: (id: string) => string;
  label: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("Outlook");
  const colors = useMapColors();
  const { container, map, failed } = useMap([19.5, 46], 3.6, { cooperativeGestures: true, bounds: BOUNDS, flat: true });
  const [hovered, setHovered] = useState<string | null>(null);
  // Bumped once the layers exist, so the paint effects below run then and not before.
  const [drawn, setDrawn] = useState(0);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const fillColor = useMemo(() => {
    const entries = Object.entries(readings).flatMap(([id, reading]) => [id, colors[toneOf(reading)]]);
    return ["match", ["get", "id"], ...entries, colors.nodata];
  }, [readings, colors]);

  useEffect(() => {
    if (!map) return;
    // `useMap` returns the map before its style has loaded; a source added now would be dropped.
    const setup = () => {
      map.addSource("outlook", { type: "geojson", data: borders });
      map.addLayer({ id: FILL, type: "fill", source: "outlook", paint: { "fill-opacity": 0.62 } });
      map.addLayer({ id: EDGE, type: "line", source: "outlook", paint: { "line-color": colors.edge, "line-width": 0.6 } });
      // Country outlines on top of the zone lines, so the countries read as one block.
      if (countries) {
        map.addSource("countries", { type: "geojson", data: countries });
        map.addLayer({
          id: COUNTRY,
          type: "line",
          source: "countries",
          paint: { "line-color": colors.country, "line-width": 2 },
        });
      }
      map.on("mousemove", FILL, move);
      map.on("mouseleave", FILL, leave);
      map.on("click", FILL, click);
      // The crop's colours arrive in the paint effect below, once the layer exists.
      setDrawn((n) => n + 1);
    };
    const zoneAt = (event: MapMouseEvent) => map.queryRenderedFeatures(event.point, { layers: [FILL] })[0]?.properties?.id as string | undefined;
    const move = (event: MapMouseEvent) => setHovered(zoneAt(event) ?? null);
    const leave = () => setHovered(null);
    const click = (event: MapMouseEvent) => {
      const id = zoneAt(event);
      if (id) onSelectRef.current(id);
    };
    if (map.isStyleLoaded()) setup();
    else map.once("load", setup);
    return () => {
      map.off("load", setup);
      map.off("mousemove", FILL, move);
      map.off("mouseleave", FILL, leave);
      map.off("click", FILL, click);
      for (const layer of [COUNTRY, EDGE, FILL]) if (map.getLayer(layer)) map.removeLayer(layer);
      if (map.getSource("countries")) map.removeSource("countries");
      if (map.getSource("outlook")) map.removeSource("outlook");
    };
  }, [map, borders, countries, colors]);

  useEffect(() => {
    if (!map?.getLayer(FILL)) return;
    map.setPaintProperty(FILL, "fill-color", fillColor as never);
    map.setPaintProperty(EDGE, "line-width", ["case", ["in", ["get", "id"], ["literal", selected ? [selected] : []]], 2.5, 0.6]);
    map.setPaintProperty(EDGE, "line-color", ["case", ["in", ["get", "id"], ["literal", selected ? [selected] : []]], colors.ink, colors.edge]);
  }, [map, fillColor, selected, colors, drawn]);

  useEffect(() => {
    if (map) map.getCanvas().style.cursor = hovered ? "pointer" : "";
  }, [map, hovered]);

  if (failed) {
    return (
      <div role="status" className="flex h-[min(70svh,720px)] items-center justify-center rounded-[var(--radius-xl)] bg-surface-sunken p-6 text-center text-ink-muted">
        {t("mapUnavailable")}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={container}
        role="region"
        aria-label={label}
        className="h-[min(70svh,720px)] w-full overflow-hidden rounded-[var(--radius-xl)] bg-surface-sunken"
      />
      {hovered ? (
        <p className="pointer-events-none absolute bottom-3 left-3 rounded-pill bg-surface/90 px-3 py-1 text-sm font-medium shadow-1">
          {zoneName(hovered)}
        </p>
      ) : null}
    </div>
  );
}

/** Tone colours as plain hex: MapLibre paints outside React, so it cannot read Tailwind classes. */
function useMapColors() {
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
      good: color("--status-good", "#2e7a45"),
      watch: color("--status-watch", "#a35f00"),
      bad: color("--status-bad", "#b23a2e"),
      nodata: color("--surface-sunken", "#ecefe8"),
      edge: color("--surface", "#ffffff"),
      ink: color("--ink", "#111512"),
      country: color("--ink-muted", "#586158"),
    } satisfies Record<Tone | "nodata" | "edge" | "ink" | "country", string>;
  }, []);
}
