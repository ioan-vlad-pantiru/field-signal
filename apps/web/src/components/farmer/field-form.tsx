"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Crop, FieldRequest, LatLon, Parcel } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { mergeParcels } from "@/lib/api";
import { fieldAreaHa, fieldCentroid, fieldRings, polygonAreaHa, polygonCentroid } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { SATELLITE_ATTRIBUTION, type Basemap } from "@/components/map/use-map";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, PlusIcon, SelectDragIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Stepper } from "@/components/ui/stepper";
import { MAX_FIELDS, type DraftField, type SubmittedField } from "./draft-field";
import { FieldMap, type MapFocus, type MapMode } from "./field-map";
import { FieldList } from "./steps/field-list";
import type { Commune } from "./steps/communes";
import { FieldStep, MAX_FIELD_HA, MIN_FIELD_HA } from "./steps/field-step";
import { PrioritiesStep, levelsFrom, weightsFrom, type PriorityLevels } from "./steps/priorities-step";
import { RotationStep, START_ROTATION } from "./steps/rotation-step";
import { SaveToAccount } from "./steps/save-to-account";

const DEFAULT_POINT: LatLon = { lat: 46.3, lon: 23.75 };
const STEPS = ["field", "rotation", "priorities"] as const;
export type FormStep = 0 | 1 | 2;

/**
 * The farmer's three steps (field, rotation, what matters) beside one map. Laptop: map on the
 * left, sticky; phone: map on top and a sticky action bar under the panel.
 * After the rotation, "Add another field" keeps the field and starts the next one; priorities are
 * shared, and all fields are analysed together.
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
  onSavedToAccount,
  onSubmit,
}: {
  /** Fields to start with (resumed or opened from My fields); the last one is the one being edited. */
  initialFields: DraftField[];
  initialPriorities?: FieldRequest["priorities"];
  initialIrrigated?: boolean;
  initialStep?: FormStep;
  /** Where the map opens when there is no earlier request (e.g. a point passed from the feed screen). */
  startPoint?: LatLon | null;
  /** The place name known so far (feed link or saved field), replaced by a commune picked in the search. */
  initialPlace?: string | null;
  communes: Commune[];
  /** Shown above the step, such as the place pinned from the feed screen. */
  notice?: ReactNode;
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
  const [step, setStep] = useState<FormStep>(last ? initialStep : 0);
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
  const drawing = step === 0 && mode === "draw";
  const others = useMemo(() => added.flatMap((f) => fieldRings(f)), [added]);
  /** No field being edited (nothing drawn yet) but some already kept: the farmer can go on with those. */
  const onlyAdded = !boundary && corners.length === 0 && added.length > 0;
  const canAddAnother = boundary !== null && added.length + 1 < MAX_FIELDS;
  const total = added.length + (boundary ? 1 : 0);

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
    go(0);
  }

  function editAdded(index: number) {
    const field = current();
    setAdded((prev) => [...prev.filter((_, i) => i !== index), ...(field ? [field] : [])]);
    load(added[index]);
    go(0);
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

  /** The selected parcels become one field, as if their outline had been drawn and Done pressed.
   * Parcels that do not touch stay separate pieces of the same field. */
  async function applySelected() {
    if (selected.length === 0 || joining) return;
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
        return;
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
      return;
    }
    setPickNote(null);
    setSelected([]);
    setCorners(outline);
    setParts(pieces);
    const c = fieldCentroid({ boundary: outline, parts: pieces });
    setPoint({ lat: Number(c.lat.toFixed(4)), lon: Number(c.lon.toFixed(4)) });
    setMode("locked");
  }

  function go(next: FormStep) {
    setStep(next);
    // On a phone the panel sits under the map: bring the new step's title into view.
    document.getElementById("field-step-panel")?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!boundary && !onlyAdded) return;
    if (step < 2) {
      // With nothing new drawn, the kept fields already have their rotations: straight to priorities.
      go(boundary ? ((step + 1) as FormStep) : 2);
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

  const stepLabels = STEPS.map((s) => t(`steps.${s}`));

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-10"
    >
      <div
        className={`relative lg:sticky lg:top-[5.25rem] lg:h-[calc(100svh-7.5rem)] lg:min-h-[480px] ${
          step === 0 ? "h-[max(55svh,320px)]" : "h-[max(28svh,200px)]"
        }`}
      >
        <FieldMap
          value={point}
          mode={drawing ? "draw" : "locked"}
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
        {mapFailed ? null : (
        <div className="absolute left-2 top-2 z-[1]">
          <Segmented
            label={t("basemap.label")}
            options={[
              { value: "satellite", label: t("basemap.satellite") },
              { value: "map", label: t("basemap.map") },
            ]}
            value={basemap}
            onChange={setBasemap}
            className="shadow-2"
          />
        </div>
        )}
        {drawing && !mapFailed && parcelsShown && corners.length === 0 ? (
          <button
            type="button"
            aria-pressed={brush}
            onClick={() => setBrush((on) => !on)}
            className={`press absolute bottom-9 left-2 z-[1] inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold shadow-2 ${
              brush ? "bg-field-strong text-on-field" : "bg-surface/95 text-ink"
            }`}
          >
            <SelectDragIcon size={18} />
            {t("parcel.brush")}
          </button>
        ) : null}
        {drawing && !mapFailed ? (
          // Phone: the panel starts below the map, so the map itself says what to do and how big the field is.
          <p
            aria-hidden="true"
            className="absolute left-2 top-16 z-[1] max-w-[calc(100%-4rem)] rounded-lg bg-surface/90 px-2.5 py-1 text-sm tabular-nums text-ink shadow-2 lg:hidden"
          >
            {selected.length > 0
              ? t("parcel.selected", { count: selected.length, ha: formatNumber(selectedHa, locale, 1) })
              : t(parcelsShown ? (brush ? "parcel.brushHint" : "parcel.mapHint") : "parcel.zoomHint")}
          </p>
        ) : null}
        {basemap === "satellite" && !mapFailed ? (
          // Licence: the credit stays visible, on one small line; the full text is also behind the (i) control.
          <p className="absolute bottom-2 left-2 right-10 z-[1] flex">
            <a
              href={SATELLITE_ATTRIBUTION.href}
              target="_blank"
              rel="noopener"
              title={SATELLITE_ATTRIBUTION.text}
              className="truncate rounded-md bg-surface/90 px-1.5 py-px text-[11px] leading-4 text-ink underline-offset-2 hover:underline"
            >
              {SATELLITE_ATTRIBUTION.text}
            </a>
          </p>
        ) : null}
      </div>

      <div id="field-step-panel" className="flex min-w-0 flex-col gap-6">
        <Stepper label={t("steps.label")} steps={stepLabels} current={step} onSelect={(i) => go(i as FormStep)} />
        {notice}
        {added.length > 0 ? (
          <FieldList fields={added} onEdit={editAdded} onRemove={removeAdded} />
        ) : null}
        {added.length > 0 && !onlyAdded ? (
          <p className="-mb-3 text-sm font-semibold text-field">
            {t("multi.editing", { field: meta.name ?? t("multi.fieldN", { n: added.length + 1 }) })}
          </p>
        ) : null}

        {step === 0 ? (
          <FieldStep
            communes={communes}
            onFocus={(p, zoom, name) => {
              setFocus((prev) => ({ point: p, zoom, seq: (prev?.seq ?? 0) + 1 }));
              setPlace(name);
            }}
            mode={mode}
            areaHa={areaHa}
            parcelsShown={parcelsShown}
            brush={brush}
            pickNote={pickNote}
            selectedCount={selected.length}
            selectedHa={selectedHa}
            joining={joining}
            onUseSelected={applySelected}
            onAddSeparate={selected.length > 1 && total < MAX_FIELDS ? addSeparate : undefined}
            onClearSelected={() => {
              setSelected([]);
              setPickNote(null);
            }}
            onRestart={() => {
              setCorners([]);
              setParts([]);
              setMode("draw");
              setMeta({ accountId: null, name: null });
            }}
          />
        ) : null}
        {step === 1 ? <RotationStep rotation={rotation} onChange={setRotation} /> : null}
        {boundary && step < 2 ? (
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
        {step === 2 ? (
          <PrioritiesStep levels={levels} onLevels={setLevels} irrigated={irrigated} onIrrigated={setIrrigated} />
        ) : null}

        {step > 0 && canAddAnother ? (
          <div className="flex flex-col items-start gap-1 border-t border-line pt-5">
            <Button variant="secondary" onClick={addAnother}>
              <PlusIcon size={18} />
              {t("multi.addAnother")}
            </Button>
            <p className="text-sm text-ink-muted">{t("multi.addAnotherHint")}</p>
          </div>
        ) : null}

        {/* Always in view: above the phone bottom navigation, at the viewport bottom from 640 px. */}
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-line bg-surface px-4 py-3 shadow-3 sm:bottom-0 lg:mx-0 lg:px-0 lg:shadow-none">
          {!boundary && !onlyAdded ? (
            <p className="mb-2 text-center text-sm font-medium text-ink-muted" aria-live="polite">
              {t("needField")}
            </p>
          ) : null}
          <div className="flex gap-2">
            {step > 0 ? (
              <Button variant="secondary" size="lg" onClick={() => go((step - 1) as FormStep)}>
                <ArrowLeftIcon />
                <span className="max-sm:sr-only">{t("back")}</span>
              </Button>
            ) : null}
            <Button type="submit" size="lg" disabled={!boundary && !onlyAdded} className="flex-1">
              {step === 2
                ? total > 1
                  ? t("multi.analyze", { count: total })
                  : t("analyze")
                : onlyAdded
                  ? t("multi.continueWith", { count: added.length })
                  : t("continue")}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
