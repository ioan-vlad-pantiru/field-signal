"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount } from "@/lib/account";
import type { Parcel } from "@/lib/contracts";
import {
  FarmError,
  applyRematch,
  areaHa,
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
import { useAppLocale } from "@/lib/localized";

export type ImportState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "done"; added: number; ha: number; unmatched: number }
  | { status: "error"; code: string };

export type RematchState =
  | { status: "idle" | "busy" | "error" }
  | { status: "done"; changed: number; missing: number };

/** The most parcels one farm holds. */
const MAX_PARCELS = 1000;

/**
 * The farm being built and everything that changes it: this device's draft (`fs-farm-draft`) or
 * the farm saved to the account, imports, parcel picks, suggested fields, moves, the APIA rematch
 * and saving. Screen state (map, sheets, step) stays in the view.
 */
export function useFarm() {
  const t = useTranslations("Farm");
  const locale = useAppLocale();
  const account = useAccount();
  const signedIn = account.status === "signed-in";

  const [name, setNameState] = useState("");
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [fields, setFields] = useState<FieldGroup[]>([]);
  const [declared, setDeclared] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [fitSeq, setFitSeq] = useState(0);
  const [importing, setImporting] = useState<ImportState>({ status: "idle" });
  const [suggesting, setSuggesting] = useState<"idle" | "busy" | "error">("idle");
  const [saving, setSaving] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [rematch, setRematch] = useState<RematchState>({ status: "idle" });
  /** Why each suggested field was grouped, in the page language. */
  const [reasons, setReasons] = useState<Record<string, string>>({});
  /** Whether anything (draft or saved farm) has been looked for yet; null while the account loads. */
  const [restored, setRestored] = useState<"draft" | "account" | "none" | null>(null);
  const loaded = useRef(false);

  const byId = useMemo(() => new Map(parcels.map((p) => [p.id, p])), [parcels]);
  const fieldOf = useMemo(() => {
    const out = new Map<number, number>();
    fields.forEach((f, i) => f.parcel_ids.forEach((id) => out.set(id, i)));
    return out;
  }, [fields]);
  const totalHa = areaHa(parcels);
  const farmName = name.trim() || t("defaultName");
  const flags = useMemo(() => soilFlags(parcels), [parcels]);

  // Start from this device's draft, else the farm saved to the account.
  useEffect(() => {
    if (loaded.current) return;
    const draft = readDraft();
    if (draft) {
      loaded.current = true;
      // Restoring browser storage once on mount; the server copy below is async anyway.
      /* eslint-disable react-hooks/set-state-in-effect */
      setNameState(draft.farm.name);
      setParcels(draft.farm.parcels);
      setFields(draft.farm.fields ?? []);
      setDeclared(draft.declared);
      setFitSeq((n) => n + 1);
      setRestored(draft.farm.parcels.length > 0 ? "draft" : "none");
      return;
    }
    if (account.status === "loading") return;
    loaded.current = true;
    if (!signedIn) {
      setRestored("none");
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    loadSavedFarm()
      .then((farm) => {
        if (!farm) {
          setRestored("none");
          return;
        }
        setNameState(farm.name);
        setParcels(farm.parcels);
        setFields(farm.fields ?? []);
        setFitSeq((n) => n + 1);
        setRestored("account");
      })
      .catch(() => setRestored("none"));
  }, [account.status, signedIn]);

  // Only once the draft or saved farm is restored: writing before that would briefly delete the
  // draft (state is still empty on the first render), and a reload in another tab would lose it.
  useEffect(() => {
    if (restored === null) return;
    writeDraft(parcels.length ? { farm: { name: farmName, parcels, fields }, declared } : null);
  }, [restored, farmName, parcels, fields, declared]);

  /** Frame the whole farm on the map again, e.g. after the map changed size. */
  const refit = useCallback(() => setFitSeq((n) => n + 1), []);

  const setName = useCallback((value: string) => {
    setNameState(value.slice(0, 80));
    setSaving("idle");
  }, []);

  // ------------------------------------------------------------------ parcels

  const addParcels = useCallback((list: Parcel[]) => {
    setParcels((prev) => {
      const have = new Set(prev.map((p) => p.id));
      const fresh = list.filter((p) => !have.has(p.id));
      return fresh.length ? [...prev, ...fresh].slice(0, MAX_PARCELS) : prev;
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

  async function importSample(path: string) {
    setImporting({ status: "busy" });
    try {
      const response = await fetch(path);
      if (!response.ok) throw new FarmError("server", response.status);
      await importFile(await response.blob(), path.split("/").pop() ?? "sample.zip");
    } catch {
      setImporting({ status: "error", code: "server" });
    }
  }

  function clear() {
    setParcels([]);
    setFields([]);
    setDeclared({});
    setSelected(new Set());
    setImporting({ status: "idle" });
    setRematch({ status: "idle" });
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

  /** Fields need (re)grouping: none yet, or parcels that belong to none. */
  const needsGrouping = fields.length === 0 || parcels.some((p) => !fieldOf.has(p.id));

  /** Move parcels to a field id, or to a new field ("new"). Fields left empty disappear. */
  function moveParcels(ids: number[], to: string) {
    if (ids.length === 0) return;
    const moving = new Set(ids);
    setFields((prev) => {
      const stripped = prev.map((f) => ({ ...f, parcel_ids: f.parcel_ids.filter((id) => !moving.has(id)) }));
      const next =
        to === "new"
          ? [...stripped, { id: `field-${Date.now()}`, name: t("fieldN", { n: prev.length + 1 }), parcel_ids: ids, current_rotation: null }]
          : stripped.map((f) => (f.id === to ? { ...f, parcel_ids: [...f.parcel_ids, ...ids] } : f));
      return next.filter((f) => f.parcel_ids.length > 0);
    });
    setSelected(new Set());
  }

  function renameField(id: string, value: string) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, name: value.slice(0, 80) || " " } : f)));
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

  return {
    signedIn,
    restored,
    name,
    setName,
    farmName,
    parcels,
    fields,
    declared,
    byId,
    fieldOf,
    totalHa,
    flags: flags as SoilFlag[],
    reasons,
    selected,
    setSelected,
    fitSeq,
    refit,
    importing,
    suggesting,
    saving,
    rematch,
    needsGrouping,
    addParcels,
    removeParcels,
    importFile,
    importSample,
    clear,
    updateParcels,
    suggest,
    moveParcels,
    renameField,
    save,
  };
}

export type FarmModel = ReturnType<typeof useFarm>;
