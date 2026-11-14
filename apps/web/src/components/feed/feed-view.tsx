"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getSourcingRegion, type Loaded } from "@/lib/api";
import type { Crop, CropOutlook, SourcingRecommendation, SourcingRegion, Zone } from "@/lib/contracts";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { ConfidenceBadge } from "@/components/ui/badges";
import { CropDot } from "@/components/ui/crop-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { CrossIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { DemoBanner, EmptyState, ErrorState } from "@/components/ui/states";
import { AdoptionSlider } from "./adoption-slider";
import { CommuneTable } from "./commune-table";
import { useMediaQuery } from "./use-media-query";
import { ZoneCompare, defaultPair } from "./zone-compare";
import { ZoneDetails } from "./zone-sheet";
import { ZoneMap } from "./zone-map";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; result: Loaded<SourcingRegion> };

/** Tailwind's `lg`: from here the map sits on the left and details open beside it. */
const LAPTOP = "(min-width: 1024px)";

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

  if (state.status === "ready") return <Region result={state.result} />;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      {state.status === "loading" ? <FeedSkeleton /> : <ErrorState onRetry={retry} />}
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
  const isLaptop = useMediaQuery(LAPTOP);
  const region = result.data;
  const [crop, setCrop] = useState<Crop>(region.reference_crops[0] ?? "maize");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  // Starts on the safest and the riskiest commune for the first crop: the comparison a buyer starts from.
  const [ticked, setTicked] = useState<string[]>(() =>
    region.zones.length >= 2 ? defaultPair(region.zones, crop) : [],
  );

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
  const select = useCallback((zone: Zone) => setSelectedId(zone.id), []);
  // Ticking a third commune drops the one ticked first, so two stay ticked.
  const tick = (id: string) =>
    setTicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-2)));

  const selected = region.zones.find((z) => z.id === selectedId) ?? null;
  const selectedOutlook = selected ? outlookFor(selected) : undefined;
  const cropName = tc(crop).toLocaleLowerCase(locale);
  const hasZones = region.zones.length > 0;
  const firstTicked = region.zones.find((z) => z.id === ticked[0]);

  const details = selected ? (
    selectedOutlook ? (
      <ZoneDetails outlook={selectedOutlook} centroid={selected.centroid} place={selected.name} />
    ) : (
      <p>{t("noCropData")}</p>
    )
  ) : null;
  const detailTitle = selected ? t("sheetTitle", { zone: selected.name, crop: tc(crop) }) : null;

  return (
    <div className="flex flex-col gap-6">
      {region.mock ? <DemoBanner origin={result.origin} /> : null}

      {/* Phone: one column (top, map when chosen, then the rest). Laptop: sticky map left, work panel right. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-x-10 lg:gap-y-0">
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-ink-muted">
              {t("regionLine", { region: region.region_name, season: region.season, count: region.zones.length })}
            </p>
          </header>

          <Recommendation recommendation={region.recommendation} />

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Segmented
              label={t("cropToggle")}
              value={crop}
              onChange={setCrop}
              className="w-full sm:w-auto"
              options={region.reference_crops.map((c) => ({
                value: c,
                label: (
                  <>
                    <CropDot crop={c} />
                    {tc(c)}
                  </>
                ),
              }))}
            />
            {hasZones ? (
              <Segmented
                label={t("view.label")}
                value={view}
                onChange={setView}
                className="w-full sm:w-auto lg:hidden"
                options={[
                  { value: "list", label: t("view.list") },
                  { value: "map", label: t("view.map") },
                ]}
              />
            ) : null}
          </div>
        </div>

        {hasZones ? (
          <aside
            className={`flex flex-col gap-4 lg:sticky lg:top-20 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-[calc(100dvh-6rem)] lg:self-start ${
              view === "map" ? "" : "max-lg:hidden"
            }`}
          >
            <ZoneMap
              zones={region.zones}
              outlookFor={outlookFor}
              markerLabel={markerLabel}
              onSelect={select}
              selectedId={selectedId}
              label={t("mapLabel", { crop: cropName })}
              className="h-[60dvh] min-h-72 lg:h-auto lg:min-h-56 lg:flex-1"
            />
            {isLaptop ? (
              <div className="flex max-h-[62%] min-h-0 flex-col border-t border-line pt-4">
                {selected ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-lg font-semibold">{detailTitle}</h2>
                      <button
                        type="button"
                        onClick={() => setSelectedId(null)}
                        aria-label={t("closeDetail")}
                        className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface-sunken"
                      >
                        <CrossIcon />
                      </button>
                    </div>
                    <div className="mt-3 min-h-0 overflow-y-auto pr-1">{details}</div>
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">{t("detailEmpty")}</p>
                )}
              </div>
            ) : null}
          </aside>
        ) : null}

        <div className="flex flex-col lg:col-start-2 lg:row-start-2">
          {hasZones ? (
            <div className={`mt-2 ${view === "list" ? "" : "max-lg:hidden"}`}>
              <CommuneTable
                zones={region.zones}
                outlookFor={outlookFor}
                cropName={cropName}
                selectedId={selectedId}
                onSelect={select}
                ticked={ticked}
                onTick={tick}
              />
            </div>
          ) : (
            <EmptyState>{t("noZones")}</EmptyState>
          )}

          {region.zones.length >= 2 ? (
            <Section title={t("compareTitle")} hint={t("compareHint")}>
              {ticked.length === 2 ? (
                <ZoneCompare zones={region.zones} crop={crop} ids={[ticked[0], ticked[1]]} />
              ) : (
                <p className="text-ink-muted" aria-live="polite">
                  {firstTicked ? t("compare.pickOne", { zone: firstTicked.name }) : t("compare.pickTwo")}
                </p>
              )}
            </Section>
          ) : null}

          <Section title={t("scenarioTitle")}>
            <AdoptionSlider scenario={region.scenario} />
          </Section>

          <Section title={t("caveatsTitle")}>
            <ul className="max-w-[65ch] list-disc space-y-2 pl-5">
              {region.caveats.map((c, i) => (
                <li key={i}>{l(c)}</li>
              ))}
            </ul>
            <h3 className="mt-6 text-sm font-medium text-ink-muted">{t("sourcesTitle")}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {region.sources.map((s) => (
                <SourceChip key={s.dataset} source={s} />
              ))}
            </div>
          </Section>
        </div>
      </div>

      <Sheet open={!isLaptop && selected !== null} onClose={() => setSelectedId(null)} title={detailTitle}>
        {details}
      </Sheet>
    </div>
  );
}

/** The answer first: the recommendation as a sentence, its numbered actions and its confidence. */
function Recommendation({ recommendation }: { recommendation: SourcingRecommendation }) {
  const t = useTranslations("Feed");
  const l = useLocalized();
  return (
    <section aria-labelledby="feed-recommendation" className="flex max-w-[720px] flex-col gap-4">
      <div>
        <h2 id="feed-recommendation" className="text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
          {l(recommendation.title)}
        </h2>
        <p className="mt-2 text-ink-muted">{l(recommendation.text)}</p>
      </div>
      {recommendation.actions.length > 0 ? (
        <div>
          <h3 className="sr-only">{t("actionsTitle")}</h3>
          <ol className="flex flex-col">
            {recommendation.actions.map((a, i) => (
              <li key={i} className="flex gap-3 border-t border-line py-2 last:border-b">
                <span aria-hidden="true" className="w-5 shrink-0 font-semibold tabular-nums text-field">
                  {i + 1}
                </span>
                {l(a)}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <ConfidenceBadge confidence={recommendation.confidence} />
      {recommendation.assumptions.length > 0 ? (
        <Disclosure summary={t("assumptions")}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {recommendation.assumptions.map((a, i) => (
              <li key={i}>{l(a)}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </section>
  );
}
