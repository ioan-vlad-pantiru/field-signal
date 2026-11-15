"use client";

import { startTransition, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { analyzeField, ApiRequestError, optimizeFarm, type Loaded } from "@/lib/api";
import { fieldInput, loadAnalysis, saveAnalysis, updateField, useAccount } from "@/lib/account";
import { setAssistantFields } from "@/lib/assistant";
import type { FieldAnalysis, LatLon, SavedField as AccountField } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { fieldAreaHa } from "@/lib/geo";
import { PinIcon } from "@/components/ui/icons";
import { ErrorState } from "@/components/ui/states";
import { LOCAL_FIELD, toSummary } from "@/lib/last-verdict";
import { verdict } from "@/lib/results";
import { rememberVerdict } from "@/lib/use-last-verdicts";
import { StartScreen } from "@/components/fields/start-screen";
import { FarmView } from "@/components/farm/farm-view";
import { FieldForm, type FormStep } from "./field-form";
import { ResultsSkeleton, ResultsView } from "./results-view";
import { SaveField } from "./save-field";
import { farmRequest, MAX_FIELDS, toDraft, type SubmittedField } from "./draft-field";
import { OptimizerCard, type OptimizerState } from "./results/optimizer-plan";
import { ALL_FIELDS, FieldSwitcher } from "./results/field-switcher";
import { ResultsOverview } from "./results/results-overview";
import { useFieldLabel } from "./steps/field-list";
import { nearestCommune, useCommunes } from "./steps/communes";
import { saveField, useSavedField, type SavedField } from "./steps/saved-field";
import { Skeleton } from "@/components/ui/skeleton";
import { supportedRotation } from "@/lib/crops";

type State =
  | { step: "form" }
  | { step: "loading" }
  /** `savedAt`: per field, when the analysis shown was saved, or null for a fresh run. */
  | { step: "results"; results: Loaded<FieldAnalysis>[]; savedAt: (string | null)[] }
  | { step: "error" };

function fromAccount(field: AccountField): SubmittedField {
  return { request: supportedRotation(field.request), boundary: field.boundary, parts: field.parts ?? [], place: field.near ?? null, accountId: field.id, name: field.name };
}

function fromLocal(field: SavedField): SubmittedField {
  return { request: supportedRotation(field.request), boundary: field.boundary, parts: field.parts ?? [], place: field.near, accountId: null, name: null };
}

/** A pin passed in the URL (`?lat=…&lon=…&place=…`), e.g. from the feed screen's zone sheet. */
interface UrlPin {
  point: LatLon;
  place: string | null;
}

function parseCoordinate(raw: string | null, limit: number): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

function UrlPinnedFlow() {
  const params = useSearchParams();
  const lat = parseCoordinate(params.get("lat"), 90);
  const lon = parseCoordinate(params.get("lon"), 180);
  const place = params.get("place")?.trim() || null;
  const pin = lat != null && lon != null ? { point: { lat, lon }, place } : null;
  if (params.get("import") === "1") return <FarmView />;
  const saved = params.get("saved");
  if (saved) {
    const ids = saved.split(",").filter(Boolean).slice(0, MAX_FIELDS);
    const mode = params.get("run") === "1" ? "run" : params.get("edit") === "1" ? "edit" : "open";
    return <AccountFieldFlow key={`${saved}:${mode}`} ids={ids} mode={mode} />;
  }
  // Remount when the pin changes so the form picks up the new start point.
  return <Flow key={pin ? `${lat},${lon}` : "default"} pin={pin} />;
}

/**
 * `?saved=<id>[,<id>…]`: fields from My fields, once the account has loaded. Opened on the last
 * step; with `&run=1` analysed straight away; with `&edit=1` opened on the field step to redraw.
 */
function AccountFieldFlow({ ids, mode }: { ids: string[]; mode: "open" | "run" | "edit" }) {
  const account = useAccount();
  if (account.status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const found =
    account.status === "signed-in"
      ? ids.map((id) => account.fields.find((f) => f.id === id)).filter((f): f is AccountField => f != null)
      : [];
  // Signed out, offline or deleted: the normal flow, which offers what it can.
  return <Flow pin={null} opened={found} openMode={found.length > 0 ? mode : "open"} />;
}

/**
 * Three input steps (field, rotation, what matters) → results, on one route.
 * Reading the URL needs a Suspense boundary under cacheComponents; the prerendered fallback is the
 * same flow with the default pin, so the static shell still shows the full form.
 */
export function FarmerFlow() {
  return (
    <Suspense fallback={<Flow pin={null} />}>
      <UrlPinnedFlow />
    </Suspense>
  );
}

/** My fields' own shape while the account loads. */
function StartSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="h-14 w-full rounded-pill" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

function Flow({
  pin,
  opened = [],
  openMode = "open",
}: {
  pin: UrlPin | null;
  opened?: AccountField[];
  openMode?: "open" | "run" | "edit";
}) {
  const t = useTranslations("Field");
  const locale = useAppLocale();
  const communes = useCommunes();
  const saved = useSavedField();
  const account = useAccount();
  const signedIn = account.status === "signed-in";
  const fieldLabel = useFieldLabel();
  const autoRun = openMode === "run" && opened.length > 0;
  const [state, setState] = useState<State>(autoRun ? { step: "loading" } : { step: "form" });
  /** The fields of the last run (or the ones opened), in order; the form resumes with them. */
  const [fields, setFields] = useState<SubmittedField[]>(() => opened.map(fromAccount));
  /** Remounts the form with `fields`, opened on this step. */
  const [resumed, setResumed] = useState<FormStep | null>(
    opened.length === 0 ? null : openMode === "edit" ? 0 : 2,
  );
  const [formKey, setFormKey] = useState(0);
  /** Which field's results are shown. */
  const [selected, setSelected] = useState(opened.length > 1 ? ALL_FIELDS : 0);
  /** The farmer chose to add a field (or came with a pin or fields): the map, not My fields. */
  const [adding, setAdding] = useState(pin !== null || opened.length > 0);
  /** My fields entries updated by the last run. */
  const [updated, setUpdated] = useState<ReadonlySet<string>>(new Set());
  /** The farm plan of the last run; a newer run makes older answers stale. */
  const [farm, setFarm] = useState<OptimizerState>({ status: "loading" });
  const farmRun = useRef(0);
  const farmAbort = useRef<AbortController | null>(null);
  // Stop polling a farm plan job when the farmer leaves the page.
  useEffect(() => {
    // A run aborted by an unmount that was not final (React's dev double mount, a remount) would
    // stay "loading" for good: start it again for the same fields.
    if (farmAbort.current?.signal.aborted && fields.length > 0) startOptimizer(fields);
    return () => farmAbort.current?.abort();
    // Only on mount and unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Not part of the per-field Promise.all: the farm plan runs as a background job on the API, so a
   * slow plan or a 422 never holds up the per-field results, and the page stays usable meanwhile.
   */
  function startOptimizer(list: SubmittedField[]) {
    const runId = ++farmRun.current;
    farmAbort.current?.abort();
    const abort = new AbortController();
    farmAbort.current = abort;
    setFarm({ status: "loading" });
    optimizeFarm(farmRequest(list, fieldLabel), {
      signal: abort.signal,
      onProgress: (elapsedS) => {
        if (farmRun.current === runId) setFarm({ status: "loading", elapsedS });
      },
    }).then(
      (result) => {
        if (farmRun.current === runId) setFarm({ status: "done", result });
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        const invalid = error instanceof ApiRequestError && error.status === 422;
        if (farmRun.current === runId) setFarm({ status: "error", invalid });
      },
    );
  }

  /**
   * Each field's analysis: with `reuse`, the one saved in the account when it was run with the
   * field's present inputs, else a fresh run. Fresh results of account fields are saved, after the
   * field itself (`before`), so the account always pairs a field with its latest answer.
   */
  async function analyse(list: SubmittedField[], reuse: boolean, before = new Map<string, Promise<unknown>>()) {
    const done = await Promise.all(
      list.map(async (f) => {
        const saved = reuse && signedIn ? account.fields.find((a) => a.id === f.accountId)?.last_analysis : undefined;
        if (saved?.current && f.accountId) {
          try {
            const kept = await loadAnalysis(f.accountId);
            return { loaded: { data: kept.analysis, origin: "api" } as Loaded<FieldAnalysis>, savedAt: kept.analyzed_at };
          } catch {
            // Gone or unreachable: run it again below.
          }
        }
        return { loaded: await analyzeField(f.request), savedAt: null };
      }),
    );
    if (signedIn) {
      done.forEach(({ loaded, savedAt }, i) => {
        const id = list[i].accountId;
        // Never keep the offline demo answer in the account.
        if (!id || savedAt !== null || loaded.origin !== "api") return;
        const body = { request: list[i].request, analysis: loaded.data, summary: toSummary(verdict(loaded.data.strategies)) };
        (before.get(id) ?? Promise.resolve())
          .catch(() => undefined)
          .then(() => saveAnalysis(id, body))
          .catch(() => undefined);
      });
    }
    return { step: "results", results: done.map((d) => d.loaded), savedAt: done.map((d) => d.savedAt) } as const;
  }

  async function run(submitted: SubmittedField[], reuse = false) {
    const list = submitted.map((f) => ({
      ...f,
      place: f.place ?? nearestCommune(communes, f.request.location)?.name ?? null,
    }));
    setFields(list);
    setSelected(list.length > 1 ? ALL_FIELDS : 0);
    setUpdated(new Set());
    setState({ step: "loading" });
    window.scrollTo({ top: 0 });
    const saving = new Map<string, Promise<unknown>>();
    for (const field of list) {
      const accountField = signedIn && !reuse ? account.fields.find((f) => f.id === field.accountId) : undefined;
      if (accountField) {
        // Keep the saved field in step with what the farmer just ran; results never wait for it.
        const body = { ...fieldInput(accountField), request: field.request, boundary: field.boundary, parts: field.parts ?? [], near: field.place };
        const update = updateField(accountField.id, body).then(() => setUpdated((prev) => new Set(prev).add(accountField.id)));
        saving.set(accountField.id, update);
        update.catch(() => undefined);
      }
    }
    const lastField = list.at(-1);
    if (!signedIn && lastField) {
      saveField({ request: lastField.request, boundary: lastField.boundary, parts: lastField.parts, near: lastField.place });
    }
    startOptimizer(list);
    try {
      const next = await analyse(list, reuse, saving);
      // A transition, so the skeleton hands over to the results with the page fade.
      startTransition(() => setState(next));
    } catch {
      setState({ step: "error" });
    }
  }

  // The assistant can analyse the fields on screen by name while results are shown.
  useEffect(() => {
    if (state.step !== "results") return;
    setAssistantFields(
      fields.map((f, i) => ({
        name: fields.length > 1 ? fieldLabel(f, i) : (f.name ?? f.place ?? t("assistantField")),
        request: f.request,
        near: f.place,
        area_ha: fieldAreaHa(f),
      })),
    );
    return () => setAssistantFields([]);
    // fieldLabel and t are new functions each render; the labels only change with the fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, fields]);

  // Each field's answer is kept on this device, for its card in My fields.
  useEffect(() => {
    if (state.step !== "results") return;
    fields.forEach((f, i) => {
      const id = f.accountId ?? (!signedIn && i === fields.length - 1 ? LOCAL_FIELD : null);
      if (id) rememberVerdict(id, verdict(state.results[i].data.strategies));
    });
  }, [state, fields, signedIn]);

  // Opened from My fields with "Analyse": analyse once, straight away (state starts at loading).
  const autoStarted = useRef(!autoRun);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    startOptimizer(fields);
    analyse(fields, false)
      .then((next) => startTransition(() => setState(next)))
      .catch(() => setState({ step: "error" }));
    // Runs once on mount, for the fields the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reopen(list: SubmittedField[], step: FormStep) {
    setFields(list);
    setResumed(step);
    setFormKey((k) => k + 1);
    setState({ step: "form" });
  }

  /** Back to My fields from the map. */
  function toStart() {
    setFields([]);
    setResumed(null);
    setFormKey((k) => k + 1);
    startTransition(() => setAdding(false));
    window.scrollTo({ top: 0 });
  }

  /** "Change field": back to the setup sheet over the map, every field kept. */
  function back() {
    reopen(fields, 1);
    window.scrollTo({ top: 0 });
  }

  switch (state.step) {
    case "loading":
      return <ResultsSkeleton />;
    case "error":
      return <ErrorState onRetry={() => (fields.length > 0 ? run(fields) : back())} />;
    case "results": {
      const showAll = fields.length > 1 && selected === ALL_FIELDS;
      const index = Math.min(Math.max(selected, 0), fields.length - 1);
      const field = fields[index];
      const result = state.results[index];
      const name = fields.length > 1 ? fieldLabel(field, index) : (field.name ?? field.place);
      const optimizer = <OptimizerCard state={farm} names={fields.map(fieldLabel)} onRetry={() => startOptimizer(fields)} />;
      const pick = (i: number) => {
        setSelected(i);
        window.scrollTo({ top: 0 });
      };
      return (
        <div className="flex flex-col gap-4">
          {fields.length > 1 ? (
            <FieldSwitcher fields={fields} results={state.results} selected={showAll ? ALL_FIELDS : index} onSelect={pick} />
          ) : null}
          {showAll ? (
            <>
              <ResultsOverview fields={fields} results={state.results} onOpen={pick} />
              {optimizer}
            </>
          ) : (
          <ResultsView
            key={index}
            analysis={result.data}
            origin={result.origin}
            boundary={field.boundary}
            parts={field.parts}
            placeName={name}
            onBack={back}
            savedAt={state.savedAt[index]}
            onRerun={() => run(fields)}
            save={
              <SaveField
                request={field.request}
                boundary={field.boundary}
                parts={field.parts}
                placeName={field.place}
                defaultName={name}
                savedId={field.accountId}
                justUpdated={field.accountId != null && updated.has(field.accountId)}
                onSaved={(id) => {
                  setFields((prev) => prev.map((f, i) => (i === index ? { ...f, accountId: id } : f)));
                  // A field saved from its results keeps them too.
                  if (result.origin === "api") {
                    saveAnalysis(id, { request: field.request, analysis: result.data, summary: toSummary(verdict(result.data.strategies)) }).catch(() => undefined);
                  }
                }}
              />
            }
            after={optimizer}
          />
          )}
        </div>
      );
    }
    case "form": {
      // A pin from the buyer map is a new place: it wins over My fields.
      const fresh = !pin && resumed === null && fields.length === 0;
      const local = saved;
      const hasFields = (signedIn && account.fields.length > 0) || local !== null;
      if (fresh && !adding) {
        if (account.status === "loading" && !local) return <StartSkeleton />;
        if (hasFields) {
          return (
            <StartScreen
              local={local}
              onAnalyze={(list) => run(list.map(fromAccount), true)}
              onAnalyzeLocal={(field) => run([fromLocal(field)])}
              onEdit={(field) => {
                setAdding(true);
                reopen([fromAccount(field)], 0);
              }}
              onAdd={() => startTransition(() => setAdding(true))}
            />
          );
        }
      }
      const where =
        pin?.place ??
        (pin
          ? t("coordinates", { lat: formatNumber(pin.point.lat, locale, 3), lon: formatNumber(pin.point.lon, locale, 3) })
          : null);
      return (
        <FieldForm
          key={formKey}
          initialFields={fields.map(toDraft)}
          initialPriorities={fields[0]?.request.priorities}
          initialStep={resumed ?? 0}
          startPoint={pin?.point}
          initialPlace={pin?.place ?? null}
          communes={communes}
          onBack={hasFields && !pin ? toStart : undefined}
          notice={
            where ? (
              <p className="pointer-events-auto flex min-h-tap w-fit max-w-full items-center gap-2 rounded-pill bg-signal-tint px-4 text-sm font-semibold shadow-float">
                <PinIcon size={16} className="shrink-0 text-signal" />
                <span className="truncate">{t("pinned", { place: where })}</span>
              </p>
            ) : null
          }
          onSubmit={run}
        />
      );
    }
  }
}
