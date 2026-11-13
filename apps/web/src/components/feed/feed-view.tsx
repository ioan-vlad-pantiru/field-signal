"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSourcingRegion, type Loaded } from "@/lib/api";
import type { Crop, CropOutlook, SourcingRegion, Zone } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { ConfidenceBadge, RiskBadge } from "@/components/ui/badges";
import { Card, SectionTitle } from "@/components/ui/card";
import { CropDot } from "@/components/ui/crop-chip";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { DemoBanner, EmptyState, ErrorState } from "@/components/ui/states";
import { AdoptionSlider } from "./adoption-slider";
import { ZoneDetails } from "./zone-sheet";
import { ZoneMap } from "./zone-map";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; result: Loaded<SourcingRegion> };

export function FeedView() {
  const t = useTranslations("Feed");
  const [state, setState] = useState<State>({ status: "loading" });

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getSourcingRegion()
      .then((result) => active && setState({ status: "ready", result }))
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, [attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="font-medium text-field">{t("eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-lg text-ink-muted">{t("intro")}</p>
      </header>
      {state.status === "loading" ? <FeedSkeleton /> : null}
      {state.status === "error" ? <ErrorState onRetry={retry} /> : null}
      {state.status === "ready" ? <Region result={state.result} /> : null}
    </div>
  );
}

function FeedSkeleton() {
  const t = useTranslations("Feed");
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p role="status" className="text-ink-muted">
        {t("loading")}
      </p>
      <Skeleton className="h-11 w-64" />
      <Skeleton className="h-72" />
      <Skeleton className="h-48" />
    </div>
  );
}

function Region({ result }: { result: Loaded<SourcingRegion> }) {
  const t = useTranslations("Feed");
  const tc = useTranslations("Crops");
  const tr = useTranslations("Risk");
  const locale = useAppLocale();
  const l = useLocalized();
  const region = result.data;
  const [crop, setCrop] = useState<Crop>(region.reference_crops[0] ?? "maize");
  const [selected, setSelected] = useState<Zone | null>(null);

  const outlookFor = useCallback(
    (zone: Zone): CropOutlook | undefined => zone.crops.find((c) => c.crop === crop),
    [crop],
  );
  const markerLabel = useCallback(
    (zone: Zone, outlook: CropOutlook | undefined) =>
      t("markerLabel", {
        zone: zone.name,
        risk: outlook ? tr(outlook.availability.level) : t("noCropData"),
      }),
    [t, tr],
  );

  const selectedOutlook = selected ? outlookFor(selected) : undefined;
  const { recommendation } = region;

  return (
    <>
      {region.mock ? <DemoBanner origin={result.origin} /> : null}
      <p className="text-ink-muted">
        {t("regionLine", { region: region.region_name, season: region.season, count: region.zones.length })}
      </p>

      <div role="radiogroup" aria-label={t("cropToggle")} className="flex flex-wrap gap-2">
        {region.reference_crops.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === crop}
            onClick={() => setCrop(c)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium ${
              c === crop ? "border-field bg-field text-on-field" : "border-line bg-surface hover:border-field"
            }`}
          >
            <CropDot crop={c} />
            {tc(c)}
          </button>
        ))}
      </div>

      {region.zones.length === 0 ? (
        <EmptyState>{t("noZones")}</EmptyState>
      ) : (
        <>
          <ZoneMap
            zones={region.zones}
            outlookFor={outlookFor}
            markerLabel={markerLabel}
            onSelect={setSelected}
            label={t("mapLabel", { crop: tc(crop).toLocaleLowerCase(locale) })}
          />
          <p className="text-sm text-ink-muted">{t("mapHint")}</p>
          <ul className="grid gap-2 sm:grid-cols-2" aria-label={t("zoneList")}>
            {region.zones.map((zone, index) => {
              const outlook = outlookFor(zone);
              return (
                <li key={zone.id} className="rise" style={{ "--i": index } as React.CSSProperties}>
                  <button
                    type="button"
                    onClick={() => setSelected(zone)}
                    className="press flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-2 text-left hover:border-field"
                  >
                    <span>
                      <span className="block font-semibold">{zone.name}</span>
                      <span className="text-sm text-ink-muted">
                        {outlook?.area_ha != null
                          ? t("zone.area", { ha: formatNumber(outlook.area_ha, locale, 0) })
                          : zone.county}
                      </span>
                    </span>
                    {outlook ? (
                      <RiskBadge level={outlook.availability.level} prefix={t("riskShort")} />
                    ) : (
                      <span className="text-sm text-ink-muted">{t("noCropData")}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <SectionTitle>{t("recommendationTitle")}</SectionTitle>
      <Card className="flex flex-col gap-3 border-2 border-field">
        <h3 className="text-xl font-semibold">{l(recommendation.title)}</h3>
        <p>{l(recommendation.text)}</p>
        <ul className="flex flex-col gap-2">
          {recommendation.actions.map((a, i) => (
            <li key={i} className="flex gap-2 rounded-xl bg-field-tint px-3 py-2">
              <span aria-hidden="true" className="font-semibold text-field">
                {i + 1}.
              </span>
              {l(a)}
            </li>
          ))}
        </ul>
        <ConfidenceBadge confidence={recommendation.confidence} />
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t("assumptions")}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {recommendation.assumptions.map((a, i) => (
              <li key={i}>{l(a)}</li>
            ))}
          </ul>
        </div>
      </Card>

      <SectionTitle>{t("scenarioTitle")}</SectionTitle>
      <AdoptionSlider scenario={region.scenario} />

      <SectionTitle>{t("caveatsTitle")}</SectionTitle>
      <Card>
        <ul className="list-disc space-y-2 pl-5">
          {region.caveats.map((c, i) => (
            <li key={i}>{l(c)}</li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {region.sources.map((s) => (
            <SourceChip key={s.dataset} source={s} />
          ))}
        </div>
      </Card>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? t("sheetTitle", { zone: selected.name, crop: tc(crop) }) : null}
      >
        {selectedOutlook ? <ZoneDetails outlook={selectedOutlook} /> : <p>{t("noCropData")}</p>}
      </Sheet>
    </>
  );
}
