"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { getSourcingRegion, type Loaded } from "@/lib/api";
import type { Crop, CropOutlook, RiskLevel, SourcingRecommendation, SourcingRegion, Zone } from "@/lib/contracts";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { ConfidenceBadge } from "@/components/ui/badges";
import { CropDot } from "@/components/ui/crop-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { CrossIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";
import { DemoBanner, EmptyState, ErrorState } from "@/components/ui/states";
import { ValidationCard } from "./validation-card";
import { OriginsView } from "./origins-view";
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

type Tab = "local" | "imports";

/** The buyer page: local grain from Alba's communes, or the soy imported from abroad. `#imports` opens the second. */
export function FeedView() {
  const t = useTranslations("Origins.tabs");
  const [tab, setTab] = useState<Tab>("local");

  useEffect(() => {
    // The hash is only known in the browser; read it once after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.location.hash === "#imports") setTab("imports");
  }, []);

  function choose(next: Tab) {
    setTab(next);
    window.history.replaceState(null, "", next === "imports" ? "#imports" : window.location.pathname);
  }

  return (
    <div className="flex flex-col gap-6">
      <Segmented
        label={t("label")}
        value={tab}
        onChange={choose}
        className="w-full sm:w-auto sm:self-start"
        options={[
          { value: "local", label: t("local") },
          { value: "imports", label: t("imports") },
        ]}
      />
      {tab === "local" ? <LocalFeed /> : <OriginsView />}
    </div>
  );
}

function LocalFeed() {
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
          <header className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
            <p className="mt-2 max-w-[60ch] text-lg text-ink-muted">{t("intro")}</p>
            <p className="mt-3 text-sm text-ink-muted">
              {t("regionLine", { region: region.region_name, season: region.season, count: region.zones.length })}
            </p>
          </header>

          <Recommendation recommendation={region.recommendation} />

          <section aria-labelledby="feed-crop" className="flex flex-col gap-4">
            <h2 id="feed-crop" className="text-xl font-semibold tracking-tight">
              {t("cropQuestion")}
            </h2>
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
            {hasZones ? <RiskSummary zones={region.zones} outlookFor={outlookFor} cropName={cropName} /> : null}
          </section>
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

        <div className="mt-6 flex flex-col gap-6 lg:col-start-2 lg:row-start-2">
          {hasZones ? (
            <StepCard step={1} title={t("listTitle")} hint={t("listHint")} className={view === "list" ? "" : "max-lg:hidden"}>
              <CommuneTable
                zones={region.zones}
                outlookFor={outlookFor}
                cropName={cropName}
                selectedId={selectedId}
                onSelect={select}
                ticked={ticked}
                onTick={tick}
              />
            </StepCard>
          ) : (
            <EmptyState>{t("noZones")}</EmptyState>
          )}

          {region.zones.length >= 2 ? (
            <StepCard step={2} title={t("compareTitle")} hint={t("compareHint")}>
              {ticked.length === 2 ? (
                <ZoneCompare zones={region.zones} crop={crop} ids={[ticked[0], ticked[1]]} />
              ) : (
                <p className="text-ink-muted" aria-live="polite">
                  {firstTicked ? t("compare.pickOne", { zone: firstTicked.name }) : t("compare.pickTwo")}
                </p>
              )}
            </StepCard>
          ) : null}

          <ValidationCard validation={region.validation} />

          <section className="rounded-2xl bg-surface-sunken p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{t("caveatsTitle")}</h2>
            <ul className="mt-3 max-w-[65ch] list-disc space-y-2 pl-5">
              {region.caveats.map((c, i) => (
                <li key={i}>{l(c)}</li>
              ))}
            </ul>
            <h3 className="mt-5 text-sm font-medium text-ink-muted">{t("sourcesTitle")}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {region.sources.map((s) => (
                <SourceChip key={s.dataset} source={s} />
              ))}
            </div>
          </section>
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
    <section aria-labelledby="feed-recommendation" className="flex flex-col gap-4 rounded-2xl border border-field/40 bg-field-tint p-5 sm:p-6">
      <div>
        <p className="text-sm font-semibold text-field-strong">{t("adviceLabel")}</p>
        <h2 id="feed-recommendation" className="mt-1 text-2xl font-semibold tracking-tight text-balance lg:text-3xl">
          {l(recommendation.title)}
        </h2>
        <p className="mt-2">{withoutMockTag(l(recommendation.text))}</p>
      </div>
      {recommendation.actions.length > 0 ? (
        <div>
          <h3 className="sr-only">{t("actionsTitle")}</h3>
          <ol className="flex flex-col">
            {recommendation.actions.map((a, i) => (
              <li key={i} className="flex gap-3 border-t border-field/25 py-2">
                <span aria-hidden="true" className="w-5 shrink-0 font-semibold tabular-nums text-field-strong">
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

/** The demo banner already says the data are made up, so the "[MOCK]" tag in mock text is noise here. */
function withoutMockTag(text: string) {
  return text.replace(/^\[MOCK\]\s*/, "");
}

/** A numbered card: one job on the page, with a line saying what it answers. */
function StepCard({
  step,
  title,
  hint,
  className = "",
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-5 sm:p-6 ${className}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-field-tint font-semibold tabular-nums text-field-strong"
        >
          {step}
        </span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {hint ? <p className="mt-0.5 text-ink-muted">{hint}</p> : null}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const SUMMARY_LEVELS: RiskLevel[] = ["low", "medium", "high"];
const SUMMARY_KEY = { low: "good", medium: "watch", high: "bad" } as const;

/** How many communes fall in each supply-risk level for the chosen crop. */
function RiskSummary({
  zones,
  outlookFor,
  cropName,
}: {
  zones: Zone[];
  outlookFor: (zone: Zone) => CropOutlook | undefined;
  cropName: string;
}) {
  const t = useTranslations("Feed");
  const tr = useTranslations("Risk");
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {SUMMARY_LEVELS.map((level) => {
        const count = zones.filter((z) => outlookFor(z)?.availability.level === level).length;
        const tone = RISK_TONE[level];
        const Icon = TONE_ICONS[tone];
        return (
          <li key={level} className={`rounded-2xl p-4 ${TONE_CLASSES[tone].soft}`}>
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${TONE_CLASSES[tone].text}`}>
              <Icon size={16} />
              {tr(level)}
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums">{count}</p>
            <p className="mt-1 text-sm">{t(`summary.${SUMMARY_KEY[level]}`, { count, crop: cropName })}</p>
          </li>
        );
      })}
    </ul>
  );
}
