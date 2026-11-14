"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { analyzeField, ApiRequestError, planFarm, type Loaded } from "@/lib/api";
import { fieldInput, updateField, useAccount } from "@/lib/account";
import { setAssistantFields } from "@/lib/assistant";
import type { FieldAnalysis, LatLon, SavedField as AccountField } from "@/lib/contracts";
import { Link } from "@/i18n/navigation";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { polygonAreaHa } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { NoticeBar } from "@/components/ui/notice-bar";
import { ErrorState } from "@/components/ui/states";
import { FieldForm, type FormStep } from "./field-form";
import { ResultsSkeleton, ResultsView } from "./results-view";
import { SaveField } from "./save-field";
import { farmRequest, MAX_FIELDS, toDraft, type SubmittedField } from "./draft-field";
import { FarmPlanSection, type FarmPlanState } from "./results/farm-plan";
import { ALL_FIELDS, FieldSwitcher } from "./results/field-switcher";
import { ResultsOverview } from "./results/results-overview";
import { useFieldLabel } from "./steps/field-list";
import { CheckIcon } from "@/components/ui/icons";
import { nearestCommune, useCommunes } from "./steps/communes";
import { forgetField, saveField, useSavedField, type SavedField } from "./steps/saved-field";
import { Skeleton } from "@/components/ui/skeleton";

type State =
  | { step: "form" }
  | { step: "loading" }
  | { step: "results"; results: Loaded<FieldAnalysis>[] }
  | { step: "error" };

function fromAccount(field: AccountField): SubmittedField {
  return { request: field.request, boundary: field.boundary, place: field.near ?? null, accountId: field.id, name: field.name };
}

function fromLocal(field: SavedField): SubmittedField {
  return { request: field.request, boundary: field.boundary, place: field.near, accountId: null, name: null };
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

/** A signed-in farmer's fields, most recently used first: tick one or several and open them together. */
function AccountFieldsBar({ fields, onOpen }: { fields: AccountField[]; onOpen: (fields: AccountField[]) => void }) {
  const t = useTranslations("Account.picker");
  const area = useTranslations("Account.fields");
  const locale = useAppLocale();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const shown = fields.slice(0, MAX_FIELDS);
  const picked = shown.filter((f) => chosen.has(f.id));

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <div className="mb-5 border-b border-line pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-lg font-semibold">{t("title")}</p>
          <p className="text-sm text-ink-muted">{t("pickHint")}</p>
        </div>
        {fields.length > shown.length ? (
          <Link href="/account" className="press min-h-11 rounded-lg font-medium text-field">
            {t("all", { count: fields.length })}
          </Link>
        ) : null}
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {shown.map((field) => {
          const on = chosen.has(field.id);
          return (
            <li key={field.id} className="max-w-full">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(field.id)}
                className={`press inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border px-3 font-medium ${
                  on ? "border-field bg-field-tint text-ink" : "border-line bg-surface hover:border-ink"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-5 shrink-0 place-items-center rounded-md border ${
                    on ? "border-field bg-field text-on-field" : "border-line"
                  }`}
                >
                  {on ? <CheckIcon size={14} /> : null}
                </span>
                <span className="truncate">{field.name}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {area("area", { ha: formatNumber(polygonAreaHa(field.boundary), locale, 0) })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button disabled={picked.length === 0} onClick={() => onOpen(picked)}>
          {picked.length > 1 ? t("openMany", { count: picked.length }) : t("openOne")}
        </Button>
        <p className="text-ink-muted">{t("new")}</p>
      </div>
    </div>
  );
}

/** "Continue with your field near Aiud, 42 ha", for a farmer who has been here before. */
function SavedFieldBar({ saved, onResume }: { saved: SavedField; onResume: () => void }) {
  const t = useTranslations("Field.saved");
  const locale = useAppLocale();
  const ha = formatNumber(polygonAreaHa(saved.boundary), locale, 0);
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <p className="text-lg">{saved.near ? t("near", { place: saved.near, ha }) : t("noPlace", { ha })}</p>
      <div className="flex gap-2">
        <Button onClick={onResume}>{t("resume")}</Button>
        <Button variant="quiet" onClick={forgetField}>
          {t("forget")}
        </Button>
      </div>
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
  /** A field was saved from the form: keep the "Your fields" picker from appearing mid-edit. */
  const [savedInForm, setSavedInForm] = useState(false);
  /** My fields entries updated by the last run. */
  const [updated, setUpdated] = useState<ReadonlySet<string>>(new Set());
  /** The farm plan of the last run; a newer run makes older answers stale. */
  const [farm, setFarm] = useState<FarmPlanState>({ status: "loading" });
  const farmRun = useRef(0);

  /** Not part of the per-field Promise.all: a slow solve or a 422 never holds up the per-field results. */
  function startFarmPlan(list: SubmittedField[]) {
    const runId = ++farmRun.current;
    setFarm({ status: "loading" });
    planFarm(farmRequest(list, fieldLabel)).then(
      (result) => {
        if (farmRun.current === runId) setFarm({ status: "done", result });
      },
      (error: unknown) => {
        const invalid = error instanceof ApiRequestError && error.status === 422;
        if (farmRun.current === runId) setFarm({ status: "error", invalid });
      },
    );
  }

  async function run(submitted: SubmittedField[]) {
    const list = submitted.map((f) => ({
      ...f,
      place: f.place ?? nearestCommune(communes, f.request.location)?.name ?? null,
    }));
    setFields(list);
    setSelected(list.length > 1 ? ALL_FIELDS : 0);
    setUpdated(new Set());
    setState({ step: "loading" });
    window.scrollTo({ top: 0 });
    for (const field of list) {
      const accountField = signedIn ? account.fields.find((f) => f.id === field.accountId) : undefined;
      if (accountField) {
        // Keep the saved field in step with what the farmer just ran; results never wait for it.
        const body = { ...fieldInput(accountField), request: field.request, boundary: field.boundary, near: field.place };
        updateField(accountField.id, body)
          .then(() => setUpdated((prev) => new Set(prev).add(accountField.id)))
          .catch(() => undefined);
      }
    }
    const lastField = list.at(-1);
    if (!signedIn && lastField) {
      saveField({ request: lastField.request, boundary: lastField.boundary, near: lastField.place });
    }
    startFarmPlan(list);
    try {
      const results = await Promise.all(list.map((f) => analyzeField(f.request)));
      setState({ step: "results", results });
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
        area_ha: polygonAreaHa(f.boundary),
      })),
    );
    return () => setAssistantFields([]);
    // fieldLabel and t are new functions each render; the labels only change with the fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, fields]);

  // Opened from My fields with "Analyse": analyse once, straight away (state starts at loading).
  const autoStarted = useRef(!autoRun);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    startFarmPlan(fields);
    Promise.all(opened.map((f) => analyzeField(f.request)))
      .then((results) => setState({ step: "results", results }))
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

  /** "Change field or rotation": back to the rotation step, every field kept. */
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
      const pick = (i: number) => {
        setSelected(i);
        window.scrollTo({ top: 0 });
      };
      return (
        <div>
          {fields.length > 1 ? (
            <FieldSwitcher fields={fields} results={state.results} selected={showAll ? ALL_FIELDS : index} onSelect={pick} />
          ) : null}
          {showAll ? (
            <ResultsOverview fields={fields} results={state.results} onOpen={pick} />
          ) : (
          <ResultsView
            key={index}
            analysis={result.data}
            origin={result.origin}
            boundary={field.boundary}
            placeName={name}
            onBack={back}
            save={
              <SaveField
                request={field.request}
                boundary={field.boundary}
                placeName={field.place}
                defaultName={name}
                savedId={field.accountId}
                justUpdated={field.accountId != null && updated.has(field.accountId)}
                onSaved={(id) => setFields((prev) => prev.map((f, i) => (i === index ? { ...f, accountId: id } : f)))}
              />
            }
          />
          )}
          <FarmPlanSection state={farm} names={fields.map(fieldLabel)} />
        </div>
      );
    }
    case "form": {
      // A pin from the feed screen is a new place: it wins over the saved field.
      const fresh = !pin && resumed === null && fields.length === 0;
      const accountFields = fresh && !savedInForm && signedIn && account.fields.length > 0 ? account.fields : null;
      const offerSaved = fresh && saved && !signedIn ? saved : null;
      return (
        <div>
          {accountFields ? (
            <AccountFieldsBar fields={accountFields} onOpen={(list) => reopen(list.map(fromAccount), 2)} />
          ) : null}
          {offerSaved ? <SavedFieldBar saved={offerSaved} onResume={() => reopen([fromLocal(offerSaved)], 2)} /> : null}
          <FieldForm
            key={formKey}
            initialFields={fields.map(toDraft)}
            initialPriorities={fields[0]?.request.priorities}
            initialIrrigated={fields[0]?.request.irrigated ?? false}
            initialStep={resumed ?? 0}
            startPoint={pin?.point}
            initialPlace={pin?.place ?? null}
            communes={communes}
            notice={
              pin ? (
                <NoticeBar tone="info">
                  {t("pinnedFromFeed", {
                    place:
                      pin.place ??
                      t("coordinates", {
                        lat: formatNumber(pin.point.lat, locale, 3),
                        lon: formatNumber(pin.point.lon, locale, 3),
                      }),
                  })}
                </NoticeBar>
              ) : null
            }
            onSavedToAccount={() => {
              if (!accountFields) setSavedInForm(true);
            }}
            onSubmit={run}
          />
        </div>
      );
    }
  }
}
