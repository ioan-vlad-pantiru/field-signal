"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { analyzeField, type Loaded } from "@/lib/api";
import type { FieldAnalysis, FieldRequest, LatLon } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { PinIcon } from "@/components/ui/icons";
import { ErrorState } from "@/components/ui/states";
import { FieldForm } from "./field-form";
import { ResultsSkeleton, ResultsView } from "./results-view";

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
 * Step 1 (field, rotation, priorities) → step 2 (results), on one route.
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

function Flow({ pin }: { pin: UrlPin | null }) {
  const t = useTranslations("Field");
  const locale = useAppLocale();
  const [state, setState] = useState<State>({ step: "form" });
  const [lastRequest, setLastRequest] = useState<FieldRequest | null>(null);
  const [boundary, setBoundary] = useState<LatLon[] | null>(null);

  async function run(request: FieldRequest, drawn: LatLon[] | null) {
    setLastRequest(request);
    setBoundary(drawn);
    setState({ step: "loading" });
    window.scrollTo({ top: 0 });
    try {
      setState({ step: "results", result: await analyzeField(request) });
    } catch {
      setState({ step: "error" });
    }
  }

  function back() {
    setState({ step: "form" });
    window.scrollTo({ top: 0 });
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
    case "form":
      return (
        <div className="flex flex-col gap-4">
          <header>
            <p className="font-medium text-field">{t("step")}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-lg text-ink-muted">{t("intro")}</p>
          </header>
          {pin ? (
            <p className="rise flex items-center gap-2 rounded-xl bg-field-tint px-3 py-2" role="status">
              <PinIcon size={18} className="shrink-0 text-field" />
              <span>
                {t("pinnedFromFeed", {
                  place:
                    pin.place ??
                    t("coordinates", {
                      lat: formatNumber(pin.point.lat, locale, 3),
                      lon: formatNumber(pin.point.lon, locale, 3),
                    }),
                })}
              </span>
            </p>
          ) : null}
          <FieldForm
            initial={lastRequest}
            initialBoundary={boundary}
            startPoint={pin?.point}
            onSubmit={run}
          />
        </div>
      );
  }
}
