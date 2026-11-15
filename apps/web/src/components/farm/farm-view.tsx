"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { Parcel } from "@/lib/contracts";
import { FIELD_COLOURS, fieldParcels } from "@/lib/farm";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { SATELLITE_ATTRIBUTION, type Basemap } from "@/components/map/use-map";
import { ActionBar } from "@/components/ui/action-bar";
import { Button, IconButton, iconButtonClass } from "@/components/ui/button";
import { ArrowLeftIcon, LayersIcon, SatelliteIcon, SelectDragIcon, UploadIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { FarmMap } from "./farm-map";
import { FieldsPanel } from "./fields-panel";
import { ImportSheet } from "./import-sheet";
import { MoveTargets } from "./move-targets";
import { ParcelDetails } from "./parcel-details";
import { PlanStep, type PlanInputField } from "./plan-step";
import { StepCount } from "./step-count";
import { useFarm } from "./use-farm";

type Stage = "parcels" | "fields" | "plan";
const START: [number, number] = [23.75, 46.3];
/** Unassigned parcels on the fields step. */
const NO_FIELD = "#ffffff";
const PICKED = "#2f7d4f";

/** A floating chip on the map. */
function MapChip({ children }: { children: ReactNode }) {
  return (
    <p className="pointer-events-auto flex min-h-tap w-fit max-w-full items-center gap-2 rounded-pill bg-glass px-4 text-sm font-semibold shadow-float backdrop-blur-md">
      {children}
    </p>
  );
}

/**
 * My fields › Import: a whole farm in three steps, with the map always in front.
 * 1 Parcels: import a file (or a demo) or tap APIA parcels on a full-bleed map.
 * 2 Fields: the suggested fields as cards; select parcels on the map to move them.
 * 3 Plan: what matters, then one plan for the whole farm, with the APIA list as CSV.
 */
export function FarmView() {
  const t = useTranslations("Farm");
  const locale = useAppLocale();
  const farm = useFarm();
  const [stage, setStage] = useState<Stage>("parcels");
  const [brush, setBrush] = useState(false);
  const [parcelsShown, setParcelsShown] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  /** null until the farmer opens or closes it: then it opens by itself for an empty farm. */
  const [importChoice, setImportChoice] = useState<boolean | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  /** The parcel whose details are open. */
  const [inspected, setInspected] = useState<number | null>(null);
  const { parcels, fields, byId, fieldOf, selected, setSelected, addParcels, removeParcels } = farm;
  const importOpen = importChoice ?? farm.restored === "none";
  const ha = (value: number) => formatNumber(value, locale, 1);
  const picking = stage === "parcels";

  function go(next: Stage) {
    setStage(next);
    setSelected(new Set());
    setBrush(false);
    if (next === "fields" && farm.needsGrouping) void farm.suggest();
    if (next !== "plan") farm.refit();
    window.scrollTo({ top: 0 });
  }

  const colourOf = useCallback(
    (p: Parcel) => {
      if (picking) return PICKED;
      const i = fieldOf.get(p.id);
      return i === undefined ? NO_FIELD : FIELD_COLOURS[i % FIELD_COLOURS.length];
    },
    [picking, fieldOf],
  );

  const onStroke = useCallback(
    (list: Parcel[], action: "add" | "remove") => {
      if (picking) {
        if (action === "add") addParcels(list);
        else removeParcels(new Set(list.map((p) => p.id)));
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        list.forEach((p) => (action === "add" ? next.add(p.id) : next.delete(p.id)));
        return next;
      });
    },
    [picking, addParcels, removeParcels, setSelected],
  );

  const onTap = useCallback(
    (p: Parcel) => {
      // Without drag-to-select, a tap on a farm parcel opens its details; actions live there.
      if (!brush && byId.has(p.id)) {
        setInspected(p.id);
        return;
      }
      if (picking) {
        if (byId.has(p.id)) removeParcels(new Set([p.id]));
        else addParcels([p]);
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(p.id)) next.delete(p.id);
        else next.add(p.id);
        return next;
      });
    },
    [picking, brush, byId, addParcels, removeParcels, setSelected],
  );

  const planFields: PlanInputField[] = useMemo(
    () =>
      fields.map((f) => ({
        id: f.id,
        name: f.name,
        parcels: fieldParcels(f, byId),
        currentRotation: f.current_rotation ?? null,
      })),
    [fields, byId],
  );

  const inspectedField = inspected !== null ? fieldOf.get(inspected) : undefined;
  const hint = picking
    ? !parcelsShown
      ? t("hint.zoom")
      : brush
      ? t("hint.brushPick")
      : t("hint.pick")
    : brush
      ? t("hint.brushSelect")
      : t("hint.select");

  return (
    <div className="flex flex-col">
      <h1 className="sr-only">{t("title")}</h1>

      <div
        className={
          stage === "plan"
            ? "hidden"
            : stage === "fields"
              ? "flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-8"
              : "flex flex-col"
        }
      >
        {/* Full-bleed on phones: the map runs edge to edge, like the Field screen. */}
        <div
          className={`field-map-frame relative -mx-gutter -mt-[max(1rem,env(safe-area-inset-top))] overflow-hidden sm:mx-0 sm:mt-0 sm:rounded-[var(--radius-xl)] sm:shadow-2 ${
            picking
              ? "h-[calc(100dvh-var(--bar-space)-6.5rem)] min-h-[420px] sm:h-[calc(100dvh-14rem)]"
              : "h-[48dvh] min-h-[320px] lg:sticky lg:top-[5.25rem] lg:h-[calc(100dvh-10rem)]"
          }`}
          style={{ viewTransitionName: "none" }}
        >
          <FarmMap
            mode={picking ? "pick" : "fields"}
            parcels={parcels}
            colourOf={colourOf}
            selected={selected}
            brush={brush && stage !== "plan"}
            onStroke={onStroke}
            onTap={onTap}
            fitSeq={farm.fitSeq}
            basemap={basemap}
            start={START}
            label={t("mapLabel")}
            className="h-full"
            onParcelsShown={setParcelsShown}
          />

          {/* Top: back to My fields, and the import / farm sheet. */}
          <div className="pointer-events-none absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[2] flex items-start justify-between gap-2 [&>*]:pointer-events-auto">
            <Link href="/field" aria-label={t("backToFields")} title={t("backToFields")} className={iconButtonClass("float")}>
              <ArrowLeftIcon size={20} />
            </Link>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setImportChoice(true)}
              className="press inline-flex min-h-tap min-w-0 items-center gap-2 rounded-pill bg-glass px-4 text-sm font-semibold shadow-float backdrop-blur-md"
            >
              <UploadIcon size={18} className="shrink-0" />
              <span className="truncate">{parcels.length > 0 ? farm.farmName : t("import.open")}</span>
            </button>
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
            <IconButton
              label={t("brush")}
              variant={brush ? "active" : "float"}
              aria-pressed={brush}
              onClick={() => setBrush((on) => !on)}
            >
              <SelectDragIcon size={20} />
            </IconButton>
          </div>

          {/* Bottom: the farm so far, what is selected, or what to do now. */}
          <div className="pointer-events-none absolute inset-x-3 bottom-8 z-[1] flex flex-col items-start gap-2">
            {!picking && selected.size > 0 ? (
              <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-[var(--radius-lg)] bg-glass p-2 shadow-float backdrop-blur-md">
                <p className="min-w-0 flex-1 px-2 font-semibold tabular-nums" aria-live="polite">
                  {t("selected", { count: selected.size })}
                </p>
                <Button aria-haspopup="dialog" onClick={() => setMoveOpen(true)}>
                  {t("move.open")}
                </Button>
                <Button variant="quiet" onClick={() => setSelected(new Set())}>
                  {t("move.clear")}
                </Button>
              </div>
            ) : (
              <>
                {picking && parcels.length > 0 ? (
                  <MapChip>
                    <span className="font-display text-lg tabular-nums" aria-live="polite">
                      {t("summary", { count: parcels.length, ha: ha(farm.totalHa) })}
                    </span>
                  </MapChip>
                ) : null}
                <MapChip>
                  <span aria-live="polite">{hint}</span>
                </MapChip>
              </>
            )}
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
        </div>

        {stage === "fields" ? (
          <FieldsPanel
            farm={farm}
            onShow={(ids) => {
              setSelected(new Set(ids));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ) : null}
      </div>

      {stage === "plan" ? (
        <PlanStep fields={planFields} declaredCrops={farm.declared} farmName={farm.farmName} onBack={() => go("fields")} />
      ) : (
        <ActionBar note={picking && parcels.length === 0 ? t("needParcels") : undefined}>
          <StepCount step={picking ? 1 : 2} />
          {!picking ? (
            <IconButton label={t("backToParcels")} variant="filled" onClick={() => go("parcels")} className="size-14">
              <ArrowLeftIcon size={20} />
            </IconButton>
          ) : null}
          {picking ? (
            <Button size="lg" onClick={() => go("fields")} disabled={parcels.length === 0} className="flex-1">
              {t("toFields")}
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={() => go("plan")}
              disabled={fields.length === 0 || farm.suggesting === "busy"}
              className="flex-1"
            >
              {t("toPlan")}
            </Button>
          )}
        </ActionBar>
      )}

      <ImportSheet open={importOpen} onClose={() => setImportChoice(false)} farm={farm} />

      <Sheet
        open={moveOpen && selected.size > 0}
        onClose={() => setMoveOpen(false)}
        title={t("move.title", { count: selected.size })}
      >
        <MoveTargets
          fields={fields}
          onMove={(to) => {
            farm.moveParcels([...selected], to);
            setMoveOpen(false);
          }}
        />
      </Sheet>

      <ParcelDetails
        parcel={inspected !== null ? (byId.get(inspected) ?? null) : null}
        field={inspectedField !== undefined ? (fields[inspectedField] ?? null) : null}
        fieldColour={inspectedField !== undefined ? FIELD_COLOURS[inspectedField % FIELD_COLOURS.length] : null}
        fields={fields}
        declaredCrop={inspected !== null ? (farm.declared[inspected] ?? null) : null}
        flags={farm.flags.filter((f) => f.parcelId === inspected)}
        onMove={
          fields.length > 0
            ? (to) => {
                if (inspected !== null) farm.moveParcels([inspected], to);
                setInspected(null);
              }
            : undefined
        }
        onRemove={() => {
          if (inspected !== null) removeParcels(new Set([inspected]));
          setInspected(null);
        }}
        onClose={() => setInspected(null)}
      />
    </div>
  );
}
