"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { analyzeField, type Loaded } from "@/lib/api";
import { fieldInput, updateField, useAccount } from "@/lib/account";
import type { FieldAnalysis, FieldRequest, LatLon, SavedField as AccountField } from "@/lib/contracts";
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
import { nearestCommune, useCommunes } from "./steps/communes";
import { forgetField, saveField, useSavedField, type SavedField } from "./steps/saved-field";
import { Skeleton } from "@/components/ui/skeleton";

type State =
  | { step: "form" }
  | { step: "loading" }
  | { step: "results"; result: Loaded<FieldAnalysis> }
  | { step: "error" };

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
  const savedId = params.get("saved");
  if (savedId) return <AccountFieldFlow key={savedId} id={savedId} />;
  // Remount when the pin changes so the form picks up the new start point.
  return <Flow key={pin ? `${lat},${lon}` : "default"} pin={pin} />;
}

/** `?saved=<id>`: a field from My fields, opened on its last step once the account has loaded. */
function AccountFieldFlow({ id }: { id: string }) {
  const account = useAccount();
  if (account.status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const field = account.status === "signed-in" ? account.fields.find((f) => f.id === id) : undefined;
  // Signed out, offline or deleted: the normal flow, which offers what it can.
  return <Flow pin={null} opened={field ?? null} />;
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

/** A signed-in farmer's fields, most recently used first, as a quick start. */
function AccountFieldsBar({ fields, onOpen }: { fields: AccountField[]; onOpen: (field: AccountField) => void }) {
  const t = useTranslations("Account.picker");
  const area = useTranslations("Account.fields");
  const locale = useAppLocale();
  const shown = fields.slice(0, 4);
  return (
    <div className="mb-5 border-b border-line pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-semibold">{t("title")}</p>
        {fields.length > shown.length ? (
          <Link href="/account" className="press min-h-11 rounded-lg font-medium text-field">
            {t("all", { count: fields.length })}
          </Link>
        ) : null}
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {shown.map((field) => (
          <li key={field.id}>
            <Button variant="secondary" onClick={() => onOpen(field)} className="max-w-full">
              <span className="truncate">{field.name}</span>
              <span className="shrink-0 tabular-nums text-ink-muted">
                {area("area", { ha: formatNumber(polygonAreaHa(field.boundary), locale, 0) })}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-ink-muted">{t("new")}</p>
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

function Flow({ pin, opened = null }: { pin: UrlPin | null; opened?: AccountField | null }) {
  const t = useTranslations("Field");
  const locale = useAppLocale();
  const communes = useCommunes();
  const saved = useSavedField();
  const account = useAccount();
  const signedIn = account.status === "signed-in";
  const [state, setState] = useState<State>({ step: "form" });
  const [lastRequest, setLastRequest] = useState<FieldRequest | null>(opened?.request ?? null);
  const [boundary, setBoundary] = useState<LatLon[] | null>(opened?.boundary ?? null);
  /** Remounts the form with the saved field, opened on its last step. */
  const [resumed, setResumed] = useState<FormStep | null>(opened ? 2 : null);
  /** The commune the farmer chose: picked in the search, from the feed link, or the saved field's. */
  const [placeName, setPlaceName] = useState<string | null>(opened?.near ?? pin?.place ?? null);
  /** The field in My fields this flow works on; each run updates it. */
  const [accountFieldId, setAccountFieldId] = useState<string | null>(opened?.id ?? null);
  const [updatedAccountField, setUpdatedAccountField] = useState(false);

  async function run(request: FieldRequest, drawn: LatLon[] | null, place: string | null) {
    setLastRequest(request);
    setBoundary(drawn);
    setPlaceName(place);
    setState({ step: "loading" });
    window.scrollTo({ top: 0 });
    const near = place ?? nearestCommune(communes, request.location)?.name ?? null;
    const accountField = signedIn ? account.fields.find((f) => f.id === accountFieldId) : undefined;
    setUpdatedAccountField(false);
    if (drawn && accountField) {
      // Keep the saved field in step with what the farmer just ran; results never wait for it.
      updateField(accountField.id, { ...fieldInput(accountField), request, boundary: drawn, near })
        .then(() => setUpdatedAccountField(true))
        .catch(() => undefined);
    } else if (drawn && !signedIn) {
      saveField({ request, boundary: drawn, near });
    }
    try {
      setState({ step: "results", result: await analyzeField(request) });
    } catch {
      setState({ step: "error" });
    }
  }

  /** "Change field or rotation": back to the rotation step, everything kept. */
  function back() {
    setResumed(1);
    setState({ step: "form" });
    window.scrollTo({ top: 0 });
  }

  function resume(field: SavedField | AccountField) {
    setLastRequest(field.request);
    setBoundary(field.boundary);
    setPlaceName(field.near ?? null);
    setAccountFieldId("id" in field ? field.id : null);
    setResumed(2);
  }

  switch (state.step) {
    case "loading":
      return <ResultsSkeleton />;
    case "error":
      return <ErrorState onRetry={() => (lastRequest ? run(lastRequest, boundary, placeName) : back())} />;
    case "results":
      return (
        <ResultsView
          analysis={state.result.data}
          origin={state.result.origin}
          boundary={boundary}
          placeName={placeName}
          onBack={back}
          save={
            boundary && lastRequest ? (
              <SaveField
                request={lastRequest}
                boundary={boundary}
                placeName={placeName ?? nearestCommune(communes, lastRequest.location)?.name ?? null}
                savedId={accountFieldId}
                justUpdated={updatedAccountField}
                onSaved={setAccountFieldId}
              />
            ) : null
          }
        />
      );
    case "form": {
      // A pin from the feed screen is a new place: it wins over the saved field.
      const fresh = !pin && resumed === null && !lastRequest;
      const accountFields = fresh && signedIn && account.fields.length > 0 ? account.fields : null;
      const offerSaved = fresh && saved && !signedIn ? saved : null;
      return (
        <div>
          {accountFields ? <AccountFieldsBar fields={accountFields} onOpen={resume} /> : null}
          {offerSaved ? <SavedFieldBar saved={offerSaved} onResume={() => resume(offerSaved)} /> : null}
          <FieldForm
            key={resumed === null ? "new" : `resumed-${lastRequest?.location.lat},${lastRequest?.location.lon}`}
            initial={lastRequest}
            initialBoundary={boundary}
            initialStep={resumed ?? 0}
            startPoint={pin?.point}
            initialPlace={placeName}
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
            onSubmit={run}
          />
        </div>
      );
    }
  }
}
