"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAccount } from "@/lib/account";
import type { Parcel } from "@/lib/contracts";
import {
  FIELD_COLOURS,
  FarmError,
  applyRematch,
  areaHa,
  fieldParcels,
  importFarmFile,
  loadSavedFarm,
  readDraft,
  rematchFarm,
  saveFarm,
  soilFlags,
  suggestFields,
  writeDraft,
  type FieldGroup,
  type SoilFlag,
} from "@/lib/farm";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import type { Basemap } from "@/components/map/use-map";
import { Button, buttonClass } from "@/components/ui/button";
import { AlertIcon, SelectDragIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Stepper } from "@/components/ui/stepper";
import { PlanStep, type PlanInputField } from "./plan-step";
import { FarmMap } from "./farm-map";
import { ParcelDetails } from "./parcel-details";

type Step = 0 | 1 | 2;
const STEPS = ["parcels", "fields", "plan"] as const;
const START: [number, number] = [23.75, 46.3];
const SAMPLES = [
  { key: "big", file: "/samples/ferma-mare-agi-online-demo.zip" },
  { key: "small", file: "/samples/ferma-mica-agi-online-demo.zip" },
] as const;

type ImportState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "done"; added: number; ha: number; unmatched: number }
  | { status: "error"; code: string };

function Card({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      {title ? <h2 className="text-lg font-semibold tracking-tight">{title}</h2> : null}
      {hint ? <p className="mt-1 text-ink-muted">{hint}</p> : null}
      <div className={title || hint ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/** Build a whole farm: its parcels (imported or picked), grouped into fields, then a farm plan. */
export function FarmView() {
  const t = useTranslations("Farm");
  const locale = useAppLocale();
  const account = useAccount();
  const signedIn = account.status === "signed-in";

  const [name, setName] = useState("");
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [fields, setFields] = useState<FieldGroup[]>([]);
  const [declared, setDeclared] = useState<Record<number, string>>({});
  const [step, setStep] = useState<Step>(0);
  const [brush, setBrush] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [fitSeq, setFitSeq] = useState(0);
  const [importing, setImporting] = useState<ImportState>({ status: "idle" });
  const [suggesting, setSuggesting] = useState<"idle" | "busy" | "error">("idle");
  const [saving, setSaving] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [moveTo, setMoveTo] = useState("new");
  /** The parcel whose details are open. */
  const [inspected, setInspected] = useState<number | null>(null);
  const [rematch, setRematch] = useState<
    { status: "idle" | "busy" | "error" } | { status: "done"; changed: number; missing: number }
  >({ status: "idle" });
  /** Why each suggested field was grouped, in the page language. */
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const loaded = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(parcels.map((p) => [p.id, p])), [parcels]);
  const fieldOf = useMemo(() => {
    const out = new Map<number, number>();
    fields.forEach((f, i) => f.parcel_ids.forEach((id) => out.set(id, i)));
    return out;
  }, [fields]);
  const totalHa = areaHa(parcels);
  const farmName = name.trim() || t("defaultName");

  // Start from this device's draft, else the farm saved to the account.
  useEffect(() => {
    if (loaded.current) return;
    const draft = readDraft();
    if (draft) {
      loaded.current = true;
      // Restoring browser storage once on mount; the server copy below is async anyway.
      /* eslint-disable react-hooks/set-state-in-effect */
      setName(draft.farm.name);
      setParcels(draft.farm.parcels);
      setFields(draft.farm.fields ?? []);
      setDeclared(draft.declared);
      setFitSeq((n) => n + 1);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    if (account.status === "loading") return;
    loaded.current = true;
    if (!signedIn) return;
    loadSavedFarm()
      .then((farm) => {
        if (!farm) return;
        setName(farm.name);
        setParcels(farm.parcels);
        setFields(farm.fields ?? []);
        setFitSeq((n) => n + 1);
      })
      .catch(() => {});
  }, [account.status, signedIn]);

  useEffect(() => {
    if (!loaded.current) return;
    writeDraft(parcels.length ? { farm: { name: farmName, parcels, fields }, declared } : null);
  }, [farmName, parcels, fields, declared]);

  // ------------------------------------------------------------------ parcels

  const addParcels = useCallback((list: Parcel[]) => {
    setParcels((prev) => {
      const have = new Set(prev.map((p) => p.id));
      const fresh = list.filter((p) => !have.has(p.id));
      return fresh.length ? [...prev, ...fresh].slice(0, 1000) : prev;
    });
  }, []);

  const removeParcels = useCallback((ids: Set<number>) => {
    setParcels((prev) => prev.filter((p) => !ids.has(p.id)));
    setFields((prev) =>
      prev
        .map((f) => ({ ...f, parcel_ids: f.parcel_ids.filter((id) => !ids.has(id)) }))
        .filter((f) => f.parcel_ids.length > 0),
    );
    setSelected((prev) => new Set([...prev].filter((id) => !ids.has(id))));
  }, []);

  async function importFile(file: Blob, filename: string) {
    setImporting({ status: "busy" });
    try {
      const result = await importFarmFile(file, filename);
      const before = new Set(parcels.map((p) => p.id));
      const added = result.parcels.filter((p) => !before.has(p.id));
      addParcels(result.parcels);
      setDeclared((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(result.file_crops ?? {})) }));
      // New parcels change the grouping: suggest again on the fields step.
      if (added.length) setFields([]);
      setImporting({ status: "done", added: added.length, ha: areaHa(added), unmatched: result.unmatched });
      setFitSeq((n) => n + 1);
    } catch (error) {
      setImporting({ status: "error", code: error instanceof FarmError ? error.code : "server" });
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await importFile(file, file.name);
  }

  async function trySample(path: string) {
    setImporting({ status: "busy" });
    try {
      const response = await fetch(path);
      if (!response.ok) throw new FarmError("server", response.status);
      await importFile(await response.blob(), path.split("/").pop() ?? "sample.zip");
    } catch {
      setImporting({ status: "error", code: "server" });
    }
  }

  // ------------------------------------------------------------------ fields

  const suggest = useCallback(async () => {
    if (parcels.length === 0) return;
    setSuggesting("busy");
    try {
      const result = await suggestFields(parcels, declared);
      setFields(
        result.fields.map((f, i) => ({
          id: f.id,
          name: t("fieldN", { n: i + 1 }),
          parcel_ids: f.parcel_ids,
          current_rotation: null,
        })),
      );
      setReasons(Object.fromEntries(result.fields.map((f) => [f.id, locale === "ro" ? f.reason.ro : f.reason.en])));
      setSuggesting("idle");
    } catch {
      setSuggesting("error");
    }
  }, [parcels, declared, t, locale]);

  function go(next: Step) {
    setStep(next);
    setSelected(new Set());
    if (next === 1 && (fields.length === 0 || parcels.some((p) => !fieldOf.has(p.id)))) void suggest();
    document.getElementById("farm-panel")?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  function moveSelected() {
    if (selected.size === 0) return;
    const ids = [...selected];
    setFields((prev) => {
      const stripped = prev.map((f) => ({ ...f, parcel_ids: f.parcel_ids.filter((id) => !selected.has(id)) }));
      let next: FieldGroup[];
      if (moveTo === "new") {
        const n = prev.length + 1;
        next = [...stripped, { id: `field-${Date.now()}`, name: t("fieldN", { n }), parcel_ids: ids, current_rotation: null }];
      } else {
        next = stripped.map((f) => (f.id === moveTo ? { ...f, parcel_ids: [...f.parcel_ids, ...ids] } : f));
      }
      return next.filter((f) => f.parcel_ids.length > 0);
    });
    setSelected(new Set());
    setMoveTo("new");
  }

  const flags = useMemo(() => soilFlags(parcels), [parcels]);
  const flagGroups = useMemo(() => {
    const out = new Map<SoilFlag["kind"], number[]>();
    flags.forEach((f) => out.set(f.kind, [...(out.get(f.kind) ?? []), f.parcelId]));
    return [...out.entries()];
  }, [flags]);

  // ------------------------------------------------------------------ map wiring

  const colourOf = useCallback(
    (p: Parcel) => {
      if (step === 0) return "#2f7d4f";
      const i = fieldOf.get(p.id);
      return i === undefined ? "#ffffff" : FIELD_COLOURS[i % FIELD_COLOURS.length];
    },
    [step, fieldOf],
  );

  const onStroke = useCallback(
    (list: Parcel[], action: "add" | "remove") => {
      if (step === 0) {
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
    [step, addParcels, removeParcels],
  );

  const onTap = useCallback(
    (p: Parcel) => {
      // Without drag-to-select, a tap on a farm parcel opens its details; actions live there.
      if (!brush && byId.has(p.id)) {
        setInspected(p.id);
        return;
      }
      if (step === 0) {
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
    [step, brush, byId, addParcels, removeParcels],
  );

  function moveParcel(id: number, to: string) {
    setFields((prev) => {
      const stripped = prev.map((f) => ({ ...f, parcel_ids: f.parcel_ids.filter((x) => x !== id) }));
      const next =
        to === "new"
          ? [...stripped, { id: `field-${Date.now()}`, name: t("fieldN", { n: prev.length + 1 }), parcel_ids: [id], current_rotation: null }]
          : stripped.map((f) => (f.id === to ? { ...f, parcel_ids: [...f.parcel_ids, id] } : f));
      return next.filter((f) => f.parcel_ids.length > 0);
    });
    setInspected(null);
  }

  async function updateParcels() {
    if (parcels.length === 0) return;
    setRematch({ status: "busy" });
    try {
      const result = await rematchFarm(parcels);
      const next = applyRematch({ parcels, fields }, result);
      setParcels(next.parcels);
      setFields(next.fields);
      setRematch({ status: "done", changed: next.changed, missing: next.missing });
    } catch {
      setRematch({ status: "error" });
    }
  }

  async function save() {
    setSaving("busy");
    try {
      await saveFarm({ name: farmName, parcels, fields });
      setSaving("saved");
    } catch {
      setSaving("error");
    }
  }

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

  const ha = (value: number) => formatNumber(value, locale, 1);

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mt-2 max-w-[62ch] text-lg text-ink-muted">{t("lead")}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            {t("nameLabel")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              placeholder={t("defaultName")}
              className="min-h-11 rounded-xl border border-line bg-ground px-3 text-base"
            />
          </label>
          {signedIn ? (
            <Button variant="secondary" onClick={save} disabled={parcels.length === 0 || saving === "busy"}>
              {saving === "busy" ? t("save.busy") : saving === "saved" ? t("save.done") : t("save.button")}
            </Button>
          ) : (
            <Link href="/more/account" className={buttonClass("secondary")}>
              {t("save.signIn")}
            </Link>
          )}
        </div>
        {saving === "error" ? <p className="mt-2 text-sm text-status-bad">{t("save.error")}</p> : null}
      </header>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-8">
        <div className="relative h-[max(50svh,320px)] lg:sticky lg:top-[5.25rem] lg:h-[calc(100svh-7.5rem)] lg:min-h-[480px]">
          <FarmMap
            mode={step === 0 ? "pick" : "fields"}
            parcels={parcels}
            colourOf={colourOf}
            selected={selected}
            brush={brush && step < 2}
            onStroke={onStroke}
            onTap={onTap}
            fitSeq={fitSeq}
            basemap={basemap}
            start={START}
            label={t("mapLabel")}
            className="h-full"
          />
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
          {step < 2 ? (
            <button
              type="button"
              aria-pressed={brush}
              onClick={() => setBrush((on) => !on)}
              className={`press absolute bottom-9 left-2 z-[1] inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold shadow-2 ${
                brush ? "bg-field-strong text-on-field" : "bg-surface/95 text-ink"
              }`}
            >
              <SelectDragIcon size={18} />
              {t("brush")}
            </button>
          ) : null}
          <p className="absolute right-2 top-[8.5rem] z-[1] max-w-[60%] rounded-lg bg-surface/90 px-2.5 py-1 text-right text-sm tabular-nums shadow-2">
            {step === 0
              ? t("summary", { count: parcels.length, ha: ha(totalHa) })
              : selected.size > 0
                ? t("selected", { count: selected.size })
                : t("fieldsCount", { count: fields.length })}
          </p>
        </div>

        <div id="farm-panel" className="flex min-w-0 scroll-mt-24 flex-col gap-5">
          <Stepper
            label={t("steps.label")}
            steps={STEPS.map((s) => t(`steps.${s}`))}
            current={step}
            onSelect={(i) => (i === 0 || parcels.length > 0) && go(i as Step)}
          />

          {step === 0 ? (
            <>
              <Card title={t("import.title")} hint={t("import.hint")}>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".zip,.geojson,.json,.kml"
                  onChange={onFile}
                  className="sr-only"
                  aria-label={t("import.button")}
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => fileInput.current?.click()} disabled={importing.status === "busy"}>
                    {importing.status === "busy" ? t("import.busy") : t("import.button")}
                  </Button>
                </div>
                <p className="mt-3 text-sm text-ink-muted">
                  {t("import.samples")}{" "}
                  {SAMPLES.map((s, i) => (
                    <span key={s.key}>
                      {i > 0 ? " · " : null}
                      <button
                        type="button"
                        onClick={() => trySample(s.file)}
                        disabled={importing.status === "busy"}
                        className="font-medium text-field underline underline-offset-4"
                      >
                        {t(`import.sample.${s.key}`)}
                      </button>
                    </span>
                  ))}
                </p>
                <p aria-live="polite" className="mt-3 text-sm">
                  {importing.status === "done"
                    ? t("import.done", { count: importing.added, ha: ha(importing.ha) }) +
                      (importing.unmatched ? " " + t("import.unmatched", { count: importing.unmatched }) : "")
                    : importing.status === "error"
                      ? t(`import.error.${["unsupported_file", "no_outlines", "unreadable_file", "file_too_large", "offline"].includes(importing.code) ? importing.code : "server"}`)
                      : ""}
                </p>
              </Card>

              <Card title={t("pick.title")} hint={t("pick.hint")}>
                <p className="text-sm text-ink-muted">{t("pick.how")}</p>
              </Card>

              {parcels.length > 0 ? (
                <Card title={t("rematch.title")} hint={t("rematch.hint")}>
                  <Button variant="secondary" onClick={updateParcels} disabled={rematch.status === "busy"}>
                    {rematch.status === "busy" ? t("rematch.busy") : t("rematch.button")}
                  </Button>
                  <p aria-live="polite" className="mt-3 text-sm">
                    {rematch.status === "done"
                      ? rematch.changed === 0 && rematch.missing === 0
                        ? t("rematch.same")
                        : t("rematch.done", { changed: rematch.changed, missing: rematch.missing })
                      : rematch.status === "error"
                        ? t("rematch.error")
                        : ""}
                  </p>
                </Card>
              ) : null}

              <div className="flex flex-col gap-3 rounded-2xl bg-field-tint p-5">
                <p className="font-display text-3xl font-semibold tabular-nums text-field-strong">{ha(totalHa)} ha</p>
                <p>{t("summary", { count: parcels.length, ha: ha(totalHa) })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => go(1)} disabled={parcels.length === 0}>
                    {t("toFields")}
                  </Button>
                  {parcels.length > 0 ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setParcels([]);
                        setFields([]);
                        setDeclared({});
                        setImporting({ status: "idle" });
                      }}
                    >
                      {t("clear")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Card title={t("fields.title")} hint={t("fields.hint")}>
                {suggesting === "busy" ? (
                  <p role="status" className="text-ink-muted">{t("fields.busy")}</p>
                ) : suggesting === "error" ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-status-bad">{t("fields.error")}</p>
                    <Button variant="secondary" onClick={() => void suggest()}>{t("fields.retry")}</Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => void suggest()}>{t("fields.again")}</Button>
                )}
              </Card>

              {selected.size > 0 ? (
                <div className="sticky top-20 z-10 flex flex-col gap-3 rounded-2xl border border-field/40 bg-field-tint p-4 shadow-2">
                  <p className="font-semibold text-field-strong">{t("selected", { count: selected.size })}</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      {t("move.label")}
                      <select
                        value={moveTo}
                        onChange={(e) => setMoveTo(e.target.value)}
                        className="min-h-11 rounded-xl border border-line bg-ground px-3 text-base"
                      >
                        <option value="new">{t("move.new")}</option>
                        {fields.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </label>
                    <Button onClick={moveSelected}>{t("move.button")}</Button>
                    <Button variant="secondary" onClick={() => setSelected(new Set())}>{t("move.clear")}</Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">{t("fields.howToMove")}</p>
              )}

              <ul className="flex flex-col gap-3">
                {fields.map((f, i) => {
                  const list = fieldParcels(f, byId);
                  return (
                    <li key={f.id} className="rounded-2xl border border-line bg-surface p-4">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="h-5 w-5 shrink-0 rounded-md border border-line"
                          style={{ background: FIELD_COLOURS[i % FIELD_COLOURS.length] }}
                        />
                        <input
                          value={f.name}
                          aria-label={t("fields.nameLabel")}
                          onChange={(e) =>
                            setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, name: e.target.value.slice(0, 80) || " " } : x)))
                          }
                          className="min-h-11 min-w-0 flex-1 rounded-xl border border-transparent bg-transparent px-2 text-lg font-semibold hover:border-line focus:border-line"
                        />
                      </div>
                      <p className="mt-1 tabular-nums text-ink-muted">
                        {t("fields.size", { ha: ha(areaHa(list)), count: list.length })}
                      </p>
                      {reasons[f.id] ? <p className="mt-1 text-sm">{reasons[f.id]}</p> : null}
                      <button
                        type="button"
                        onClick={() => setSelected(new Set(f.parcel_ids))}
                        className="mt-2 text-sm font-medium text-field underline underline-offset-4"
                      >
                        {t("fields.select")}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {flagGroups.length > 0 ? (
                <Card title={t("soil.title")} hint={t("soil.hint")}>
                  <ul className="flex flex-col gap-2">
                    {flagGroups.map(([kind, ids]) => (
                      <li key={kind} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-start gap-2">
                          <AlertIcon size={18} className="mt-0.5 shrink-0 text-status-watch" />
                          {t(`soil.${kind}`, { count: ids.length })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelected(new Set(ids))}
                          className="text-sm font-medium text-field underline underline-offset-4"
                        >
                          {t("soil.show")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => go(0)}>{t("back")}</Button>
                <Button onClick={() => go(2)} disabled={fields.length === 0 || suggesting === "busy"}>
                  {t("toPlan")}
                </Button>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <PlanStep fields={planFields} declaredCrops={declared} farmName={farmName} />
              <div>
                <Button variant="secondary" onClick={() => go(1)}>{t("back")}</Button>
              </div>
            </>
          ) : null}
        </div>
            </div>

      <ParcelDetails
        parcel={inspected !== null ? (byId.get(inspected) ?? null) : null}
        field={inspected !== null ? (fields[fieldOf.get(inspected) ?? -1] ?? null) : null}
        fieldColour={
          inspected !== null && fieldOf.has(inspected)
            ? FIELD_COLOURS[(fieldOf.get(inspected) ?? 0) % FIELD_COLOURS.length]
            : null
        }
        fields={fields}
        declaredCrop={inspected !== null ? (declared[inspected] ?? null) : null}
        flags={flags.filter((f) => f.parcelId === inspected)}
        onMove={fields.length > 0 ? (to) => inspected !== null && moveParcel(inspected, to) : undefined}
        onRemove={() => {
          if (inspected !== null) removeParcels(new Set([inspected]));
          setInspected(null);
        }}
        onClose={() => setInspected(null)}
      />
    </div>
  );
}
