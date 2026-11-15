"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Crop, FieldRequest, LatLon, Parcel } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { mergeParcels } from "@/lib/api";
import { fieldAreaHa, fieldCentroid, fieldRings, polygonAreaHa, polygonCentroid } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { SATELLITE_ATTRIBUTION, type Basemap } from "@/components/map/use-map";
import { ActionBar } from "@/components/ui/action-bar";
import { Button, IconButton } from "@/components/ui/button";
import { AlertIcon, ArrowLeftIcon, LayersIcon, PlusIcon, SatelliteIcon, SelectDragIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { MAX_FIELDS, type DraftField, type SubmittedField } from "./draft-field";
import { FieldMap, type MapFocus, type MapMode } from "./field-map";
import { FieldList } from "./steps/field-list";
import type { Commune } from "./steps/communes";
import { COMMUNE_ZOOM, LocateButton, LOCATION_ZOOM, MAX_FIELD_HA, MIN_FIELD_HA, PlaceSearch } from "./steps/field-step";
import { PrioritiesStep, levelsFrom, weightsFrom, type PriorityLevels } from "./steps/priorities-step";
import { RotationEditor, START_ROTATION } from "./steps/rotation-step";
import { SaveToAccount } from "./steps/save-to-account";

const DEFAULT_POINT: LatLon = { lat: 46.3, lon: 23.75 };
/** 0: the map (choose the field) · 1 and 2: the setup sheet open (rotation and priorities). */
export type FormStep = 0 | 1 | 2;

/** A floating chip on the map. */
function MapChip({ children, tone = "glass" }: { children: ReactNode; tone?: "glass" | "watch" }) {
  return (
    <p
      className={`pointer-events-auto flex min-h-tap w-fit max-w-full items-center gap-2 rounded-pill px-4 text-sm font-semibold shadow-float backdrop-blur-md ${
        tone === "watch" ? "bg-status-watch-tint text-ink" : "bg-glass text-ink"
      }`}
    >
      {children}
    </p>
  );
}

/**
 * Choose the field on a full-bleed map (APIA parcels), then set the rotation and what matters in
 * one sheet. Search, locate, basemap and drag-to-select float on the map; the one primary action
 * sits in the thumb zone. "Add another field" keeps this field and starts the next; priorities are
 * shared and all fields are analysed together.
 */
export function FieldForm({
  initialFields,
  initialPriorities,
  initialIrrigated = false,
  initialStep = 0,
  startPoint,
  initialPlace = null,
  communes,
  notice,
  onBack,
  onSavedToAccount,
  onSubmit,
}: {
  /** Fields to start with (resumed or opened from My fields); the last one is the one being edited. */
  initialFields: DraftField[];
  initialPriorities?: FieldRequest["priorities"];
  initialIrrigated?: boolean;
  initialStep?: FormStep;
  /** Where the map opens when there is no earlier request (e.g. a point passed from the buyer map). */
  startPoint?: LatLon | null;
  /** The place name known so far (buyer link or saved field), replaced by a commune picked in the search. */
  initialPlace?: string | null;
  communes: Commune[];
  /** Shown on the map, such as the place pinned from the buyer map. */
  notice?: ReactNode;
  /** Back to My fields, when the farmer came from there. */
  onBack?: () => void;
  /** A field was saved to My fields from the form. */
  onSavedToAccount?: () => void;
  /** Every field with its request; the API receives each field's centroid. */
  onSubmit: (fields: SubmittedField[]) => void;
}) {
  const t = useTranslations("Field");
  const locale = useAppLocale();

  const last = initialFields.at(-1) ?? null;
  /** Fields kept for this analysis, besides the one being edited. */
  const [added, setAdded] = useState<DraftField[]>(() => initialFields.slice(0, -1));
  const [setupOpen, setSetupOpen] = useState(initialFields.length > 0 && initialStep > 0);
  const [listOpen, setListOpen] = useState(false);
  const [point, setPoint] = useState<LatLon>(last?.point ?? startPoint ?? DEFAULT_POINT);
  const [rotation, setRotation] = useState<Crop[]>(last ? [...last.rotation] : START_ROTATION);
  const [levels, setLevels] = useState<PriorityLevels>(() => levelsFrom(initialPriorities));
  const [irrigated, setIrrigated] = useState(initialIrrigated);
  const [corners, setCorners] = useState<LatLon[]>(last?.boundary ?? []);
  /** Further pieces of the field: picked parcels that do not touch the main outline. */
  const [parts, setParts] = useState<LatLon[][]>(last?.parts ?? []);
  const [mode, setMode] = useState<MapMode>(last ? "locked" : "draw");
  /** My fields id and name of the field being edited, if it came from there. */
  const [meta, setMeta] = useState({ accountId: last?.accountId ?? null, name: last?.name ?? null });
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [place, setPlace] = useState<string | null>(last ? last.place : initialPlace);
  const [parcelsShown, setParcelsShown] = useState(false);
  /** APIA parcels the farmer tapped, to become one field. */
  const [selected, setSelected] = useState<Parcel[]>([]);
  const [joining, setJoining] = useState(false);
  /** Drag-to-select is on: dragging over the map selects parcels instead of moving it. */
  const [brush, setBrush] = useState(false);
  /** Why the selected parcels could not be used, if they could not. */
  const [pickNote, setPickNote] = useState<string | null>(null);

  const areaHa = fieldAreaHa({ boundary: corners, parts });
  const selectedHa = selected.reduce((sum, p) => sum + p.area_ha, 0);
  const boundary = mode === "locked" && corners.length >= 3 ? corners : null;
  const drawing = mode === "draw";
  const others = useMemo(() => added.flatMap((f) => fieldRings(f)), [added]);
  /** No field being edited (nothing chosen yet) but some already kept: the farmer can go on with those. */
  const onlyAdded = !boundary && corners.length === 0 && added.length > 0;
  const canAddAnother = boundary !== null && added.length + 1 < MAX_FIELDS;
  const total = added.length + (boundary ? 1 : 0);
  const ready = boundary !== null || onlyAdded;

  function current(): DraftField | null {
    return boundary ? { boundary, parts, point, rotation, place, ...meta } : null;
  }

  /** Load a field into the editor (empty for a new one). */
  function load(field: DraftField | null) {
    setSelected([]);
    setPickNote(null);
    setCorners(field?.boundary ?? []);
    setParts(field?.parts ?? []);
    setMode(field ? "locked" : "draw");
    if (field) setPoint(field.point);
    if (field) setRotation([...field.rotation]);
    if (field) setPlace(field.place);
    setMeta({ accountId: field?.accountId ?? null, name: field?.name ?? null });
  }

  function addAnother() {
    const field = current();
    if (!field) return;
    setAdded((prev) => [...prev, field]);
    // The next field starts where this one is, with the same rotation as a first guess; zoom out a
    // little so the neighbouring parcels are in view.
    load(null);
    setFocus((prev) => ({ point, zoom: 15, seq: (prev?.seq ?? 0) + 1 }));
    setSetupOpen(false);
  }

  function editAdded(index: number) {
    const field = current();
    setAdded((prev) => [...prev.filter((_, i) => i !== index), ...(field ? [field] : [])]);
    load(added[index]);
    setListOpen(false);
    setSetupOpen(false);
  }

  function removeAdded(index: number) {
    setAdded((prev) => prev.filter((_, i) => i !== index));
  }

  function tapParcel(parcel: Parcel) {
    setPickNote(null);
    setSelected((prev) =>
      prev.some((p) => p.id === parcel.id) ? prev.filter((p) => p.id !== parcel.id) : [...prev, parcel].slice(-40),
    );
  }

  function brushParcels(parcels: Parcel[], action: "add" | "remove") {
    setPickNote(null);
    setSelected((prev) => {
      if (action === "remove") {
        const drop = new Set(parcels.map((p) => p.id));
        return prev.filter((p) => !drop.has(p.id));
      }
      const have = new Set(prev.map((p) => p.id));
      return [...prev, ...parcels.filter((p) => !have.has(p.id))].slice(-40);
    });
  }

  /** Each selected parcel of at least MIN_FIELD_HA becomes its own field; smaller ones stay selected. */
  function addSeparate() {
    const room = MAX_FIELDS - added.length - (boundary ? 1 : 0);
    const big = selected.filter((p) => polygonAreaHa(p.boundary) >= MIN_FIELD_HA);
    const taken = big.slice(0, Math.max(0, room));
    const left = selected.filter((p) => !taken.includes(p));
    setAdded((prev) => [
      ...prev,
      ...taken.map((p): DraftField => {
        const outline = p.boundary.map((c) => ({ lat: c.lat, lon: c.lon }));
        const c = polygonCentroid(outline);
        return {
          boundary: outline,
          parts: [],
          point: { lat: Number(c.lat.toFixed(4)), lon: Number(c.lon.toFixed(4)) },
          rotation: [...rotation],
          place,
          accountId: null,
          name: null,
        };
      }),
    ]);
    setSelected(left);
    setPickNote(
      left.length === 0
        ? null
        : taken.length < big.length
          ? t("parcel.separateFull", { max: MAX_FIELDS })
          : t("parcel.separateSmall", { count: left.length, min: MIN_FIELD_HA }),
    );
  }

  /** The selected parcels become one field. Parcels that do not touch stay separate pieces of it. */
  async function applySelected(): Promise<boolean> {
    if (selected.length === 0 || joining) return false;
    let outline: LatLon[];
    let pieces: LatLon[][] = [];
    if (selected.length === 1) {
      outline = selected[0].boundary.map((c) => ({ lat: c.lat, lon: c.lon }));
    } else {
      setJoining(true);
      const result = await mergeParcels(selected.map((p) => p.id));
      setJoining(false);
      if (!result.ok) {
        setPickNote(t("parcel.failed"));
        return false;
      }
      outline = result.data.boundary.map((c) => ({ lat: c.lat, lon: c.lon }));
      pieces = (result.data.parts ?? []).map((ring) => ring.map((c) => ({ lat: c.lat, lon: c.lon })));
    }
    const ha = fieldAreaHa({ boundary: outline, parts: pieces });
    if (ha < MIN_FIELD_HA || ha > MAX_FIELD_HA) {
      const size = formatNumber(ha, locale, 1);
      setPickNote(
        ha < MIN_FIELD_HA
          ? t("parcel.tooSmall", { ha: size, min: MIN_FIELD_HA })
          : t("parcel.tooBig", { ha: size, max: formatNumber(MAX_FIELD_HA, locale, 0) }),
      );
      return false;
    }
    setPickNote(null);
    setSelected([]);
    setBrush(false);
    setCorners(outline);
    setParts(pieces);
    const c = fieldCentroid({ boundary: outline, parts: pieces });
    setPoint({ lat: Number(c.lat.toFixed(4)), lon: Number(c.lon.toFixed(4)) });
    setMode("locked");
    return true;
  }

  function restart() {
    setCorners([]);
    setParts([]);
    setMode("draw");
    setMeta({ accountId: null, name: null });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!setupOpen && drawing && selected.length > 0) {
      // One primary action: Continue makes the selected parcels the field, then opens the setup.
      if (await applySelected()) setSetupOpen(true);
      return;
    }
    if (!ready) return;
    if (!setupOpen) {
      setSetupOpen(true);
      return;
    }
    const field = current();
    const priorities = weightsFrom(levels);
    onSubmit(
      [...added, ...(field ? [field] : [])].map((f) => ({
        request: {
          location: f.point,
          current_rotation: f.rotation as FieldRequest["current_rotation"],
          priorities,
          irrigated,
        },
        boundary: f.boundary,
        parts: f.parts,
        place: f.place,
        accountId: f.accountId,
        name: f.name,
      })),
    );
  }

  const hint = !parcelsShown ? t("parcel.zoomHint") : brush ? t("parcel.brushHint") : t("parcel.mapHint");
  const editingName = meta.name ?? place ?? t("multi.fieldN", { n: added.length + 1 });

  return (
    <form onSubmit={submit} className="flex flex-col">
      {/* Full-bleed on phones: the map runs edge to edge, from the top to just above the action bar. */}
      <div
        className="field-map-frame relative -mx-gutter -mt-[max(1rem,env(safe-area-inset-top))] h-[calc(100dvh-var(--bar-space)-6.5rem)] min-h-[420px] overflow-hidden sm:mx-0 sm:mt-0 sm:h-[calc(100dvh-14rem)] sm:rounded-[var(--radius-xl)] sm:shadow-2"
        style={{ viewTransitionName: "none" }}
      >
        <FieldMap
          value={point}
          mode={drawing && !setupOpen ? "draw" : "locked"}
          corners={corners}
          closed={mode === "locked"}
          others={others}
          parts={parts}
          onTapParcel={tapParcel}
          selected={selected}
          brush={brush}
          onBrushParcels={brushParcels}
          onParcelsShown={setParcelsShown}
          label={t("mapLabel")}
          basemap={basemap}
          focus={focus}
          onUnavailable={() => setMapFailed(true)}
          className="h-full"
        />

        {mapFailed ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="max-w-xs text-ink-muted">{t("mapUnavailable")}</p>
          </div>
        ) : (
          <>
            {/* Top: back, search, locate. */}
            <div className="pointer-events-none absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[2] flex items-start gap-2 [&>*]:pointer-events-auto">
              {onBack ? (
                <IconButton label={t("toFields")} variant="float" onClick={onBack}>
                  <ArrowLeftIcon size={20} />
                </IconButton>
              ) : null}
              {drawing ? (
                <PlaceSearch
                  communes={communes}
                  onPick={(c) => {
                    setFocus((prev) => ({ point: c.point, zoom: COMMUNE_ZOOM, seq: (prev?.seq ?? 0) + 1 }));
                    setPlace(c.name);
                  }}
                />
              ) : (
                <div className="flex-1" />
              )}
              {drawing ? (
                <LocateButton
                  onFound={(p) => setFocus((prev) => ({ point: p, zoom: LOCATION_ZOOM, seq: (prev?.seq ?? 0) + 1 }))}
                  onFailed={setLocateFailed}
                />
              ) : null}
            </div>

            {/* Right: basemap and drag-to-select. */}
            <div className="absolute right-3 top-[4.25rem] z-[1] flex flex-col gap-2">
              <IconButton
                label={basemap === "satellite" ? t("basemap.map") : t("basemap.satellite")}
                variant="float"
                onClick={() => setBasemap((b) => (b === "satellite" ? "map" : "satellite"))}
              >
                {basemap === "satellite" ? <LayersIcon size={20} /> : <SatelliteIcon size={20} />}
              </IconButton>
              {drawing && parcelsShown ? (
                <IconButton
                  label={t("parcel.brush")}
                  variant={brush ? "active" : "float"}
                  aria-pressed={brush}
                  onClick={() => setBrush((on) => !on)}
                >
                  <SelectDragIcon size={20} />
                </IconButton>
              ) : null}
            </div>

            {/* Bottom: what to do now, or what is selected. */}
            <div className="pointer-events-none absolute inset-x-3 bottom-8 z-[1] flex flex-col items-start gap-2">
              {notice}
              {locateFailed ? <MapChip tone="watch">{t("locate.failed")}</MapChip> : null}
              {pickNote ? (
                <MapChip tone="watch">
                  <AlertIcon size={16} className="shrink-0 text-status-watch" />
                  <span aria-live="polite">{pickNote}</span>
                </MapChip>
              ) : null}
              {added.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setListOpen(true)}
                  className="press pointer-events-auto inline-flex min-h-tap items-center gap-2 rounded-pill bg-glass px-4 text-sm font-semibold shadow-float backdrop-blur-md"
                >
                  <span className="flex size-6 items-center justify-center rounded-full bg-field text-xs text-on-field tabular-nums">{total}</span>
                  {t("multi.count", { count: total })}
                </button>
              ) : null}
              {drawing && selected.length > 0 ? (
                <div className="pointer-events-auto flex w-full max-w-md flex-col gap-2 rounded-[var(--radius-lg)] bg-glass p-2 shadow-float backdrop-blur-md">
                  <p className="px-2 pt-1 font-semibold tabular-nums" aria-live="polite">
                    {t("parcel.selected", { count: selected.length, ha: formatNumber(selectedHa, locale, 1) })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selected.length > 1 && total < MAX_FIELDS ? (
                      <Button variant="secondary" onClick={addSeparate} disabled={joining}>
                        {t("parcel.separate")}
                      </Button>
                    ) : null}
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setSelected([]);
                        setPickNote(null);
                      }}
                      disabled={joining}
                    >
                      {t("parcel.clear")}
                    </Button>
                  </div>
                </div>
              ) : drawing ? (
                <MapChip>
                  <span aria-live="polite">{hint}</span>
                </MapChip>
              ) : boundary ? (
                <div className="pointer-events-auto flex flex-wrap items-center gap-2">
                  <MapChip>
                    <span className="font-display text-lg tabular-nums" aria-live="polite">
                      {t("area", { ha: formatNumber(areaHa, locale, 1) })}
                    </span>
                    <span className="max-w-40 truncate font-normal text-ink-muted">{editingName}</span>
                  </MapChip>
                  <Button variant="secondary" onClick={restart}>
                    {t("parcel.restart")}
                  </Button>
                  {canAddAnother ? (
                    <IconButton label={t("multi.addAnother")} variant="float" onClick={addAnother}>
                      <PlusIcon size={20} />
                    </IconButton>
                  ) : null}
                </div>
              ) : null}
            </div>

            {basemap === "satellite" ? (
              // Licence: the credit stays visible, on one small line.
              <p className="absolute bottom-1.5 left-3 right-12 z-[1] flex">
                <a
                  href={SATELLITE_ATTRIBUTION.href}
                  target="_blank"
                  rel="noopener"
                  title={SATELLITE_ATTRIBUTION.text}
                  className="truncate rounded-xs bg-glass px-1.5 text-[11px] leading-4 text-ink underline-offset-2 hover:underline"
                >
                  {SATELLITE_ATTRIBUTION.text}
                </a>
              </p>
            ) : null}
          </>
        )}
      </div>

      <ActionBar note={ready || selected.length > 0 ? undefined : t("needField")}>
        <Button type="submit" size="lg" disabled={(!ready && selected.length === 0) || joining} className="flex-1">
          {joining
            ? t("parcel.joining")
            : selected.length > 0 && drawing
              ? t("parcel.use")
              : onlyAdded
                ? t("multi.continueWith", { count: added.length })
                : t("continue")}
        </Button>
      </ActionBar>

      <Sheet
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        title={total > 1 ? t("setup.titleMany", { count: total }) : boundary ? editingName : t("setup.title")}
        subtitle={boundary ? t("area", { ha: formatNumber(areaHa, locale, 1) }) : undefined}
        snap
        footer={
          <div className="flex gap-2">
            {canAddAnother ? (
              <IconButton label={t("multi.addAnother")} variant="filled" onClick={addAnother} className="size-14">
                <PlusIcon size={20} />
              </IconButton>
            ) : null}
            <Button type="submit" size="lg" className="flex-1">
              {total > 1 ? t("multi.analyze", { count: total }) : t("analyze")}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-6 pb-2">
          {boundary ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink-muted">{t("setup.rotation")}</h3>
              <RotationEditor rotation={rotation} onChange={setRotation} />
            </section>
          ) : null}
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-ink-muted">{t("setup.priorities")}</h3>
            <PrioritiesStep levels={levels} onLevels={setLevels} irrigated={irrigated} onIrrigated={setIrrigated} />
          </section>
          {boundary ? (
            <SaveToAccount
              name={meta.name ?? ""}
              onName={(name) => setMeta((m) => ({ ...m, name: name || null }))}
              accountId={meta.accountId}
              onSaved={(accountId, name) => {
                setMeta({ accountId, name });
                onSavedToAccount?.();
              }}
              fallbackName={place}
              draft={{
                request: {
                  location: point,
                  current_rotation: rotation as FieldRequest["current_rotation"],
                  priorities: weightsFrom(levels),
                  irrigated,
                },
                boundary,
                near: place,
              }}
            />
          ) : null}
        </div>
      </Sheet>

      <Sheet open={listOpen} onClose={() => setListOpen(false)} title={t("multi.listTitle")}>
        <FieldList fields={added} onEdit={editAdded} onRemove={removeAdded} />
      </Sheet>
    </form>
  );
}
