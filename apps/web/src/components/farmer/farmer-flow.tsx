"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { analyzeField, type Loaded } from "@/lib/api";
import type { FieldAnalysis, FieldRequest, LatLon } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { polygonAreaHa } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { NoticeBar } from "@/components/ui/notice-bar";
import { ErrorState } from "@/components/ui/states";
import { FieldForm, type FormStep } from "./field-form";
import { ResultsSkeleton, ResultsView } from "./results-view";
import { nearestCommune, useCommunes } from "./steps/communes";
import { forgetField, saveField, useSavedField, type SavedField } from "./steps/saved-field";

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
  // Remount when the pin changes so the form picks up the new start point.
  return <Flow key={pin ? `${lat},${lon}` : "default"} pin={pin} />;
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

function Flow({ pin }: { pin: UrlPin | null }) {
  const t = useTranslations("Field");
  const locale = useAppLocale();
  const communes = useCommunes();
  const saved = useSavedField();
  const [state, setState] = useState<State>({ step: "form" });
  const [lastRequest, setLastRequest] = useState<FieldRequest | null>(null);
  const [boundary, setBoundary] = useState<LatLon[] | null>(null);
  /** Remounts the form with the saved field, opened on its last step. */
  const [resumed, setResumed] = useState<FormStep | null>(null);

  async function run(request: FieldRequest, drawn: LatLon[] | null) {
    setLastRequest(request);
    setBoundary(drawn);
    setState({ step: "loading" });
    window.scrollTo({ top: 0 });
    if (drawn) {
      saveField({ request, boundary: drawn, near: nearestCommune(communes, request.location)?.name ?? null });
    }
    try {
      setState({ step: "results", result: await analyzeField(request) });
    } catch {
      setState({ step: "error" });
    }
  }

  function back() {
    setResumed(2);
    setState({ step: "form" });
    window.scrollTo({ top: 0 });
  }

  function resume(field: SavedField) {
    setLastRequest(field.request);
    setBoundary(field.boundary);
    setResumed(2);
  }

  switch (state.step) {
    case "loading":
      return <ResultsSkeleton />;
    case "error":
      return <ErrorState onRetry={() => (lastRequest ? run(lastRequest, boundary) : back())} />;
    case "results":
      return (
        <ResultsView
          analysis={state.result.data}
          origin={state.result.origin}
          boundary={boundary}
          onBack={back}
        />
      );
    case "form": {
      // A pin from the feed screen is a new place: it wins over the saved field.
      const offerSaved = saved && !pin && resumed === null && !lastRequest ? saved : null;
      return (
        <div>
          {offerSaved ? <SavedFieldBar saved={offerSaved} onResume={() => resume(offerSaved)} /> : null}
          <FieldForm
            key={resumed === null ? "new" : `resumed-${lastRequest?.location.lat},${lastRequest?.location.lon}`}
            initial={lastRequest}
            initialBoundary={boundary}
            initialStep={resumed ?? 0}
            startPoint={pin?.point}
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
