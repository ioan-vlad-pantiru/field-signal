"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getSourcingRegion, type Loaded } from "@/lib/api";
import type { Crop, CropOutlook, QualityFlag, SourcingRegion, Zone } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { CropDot } from "@/components/ui/crop-chip";
import { Disclosure } from "@/components/ui/disclosure";
import { AlertIcon, ChevronDownIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";
import { DemoBanner, EmptyState, ErrorState } from "@/components/ui/states";
import { ValidationCard } from "./validation-card";
import { OriginsView } from "./origins-view";
import { ZoneDetails } from "./zone-sheet";
import { ZoneMap } from "./zone-map";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; result: Loaded<SourcingRegion> };

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
  const ts = useTranslations("FeedSimple");
  const tc = useTranslations("Crops");
  const tr = useTranslations("Risk");
  const locale = useAppLocale();
  const l = useLocalized();
  const region = result.data;
  const [crop, setCrop] = useState<Crop>(region.reference_crops[0] ?? "maize");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [showAll, setShowAll] = useState(false);

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

  const rows = useMemo(() => ranked(region.zones, crop), [region.zones, crop]);
  const tests = useMemo(() => qualityTests(rows.map((r) => r.outlook)), [rows]);
  const selected = region.zones.find((z) => z.id === selectedId) ?? null;
  const selectedOutlook = selected ? outlookFor(selected) : undefined;
  const cropName = tc(crop).toLocaleLowerCase(locale);
  const shown = showAll ? rows : rows.slice(0, SHORT_LIST);
  const recommendation = region.recommendation;
  const firstSentence = withoutMockTag(l(recommendation.text)).split(/(?<=\.)\s/)[0];
  const validation = region.validation;

  return (
    <div className="flex flex-col gap-6">
      {region.mock ? <DemoBanner origin={result.origin} /> : null}

      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mt-1 max-w-[62ch] text-lg text-ink-muted">{ts("intro")}</p>
      </header>

      <section aria-labelledby="feed-advice" className="rounded-2xl border border-field/40 bg-field-tint px-5 pt-5 sm:px-6 sm:pt-6">
        <h2 id="feed-advice" className="text-2xl font-semibold tracking-tight text-balance">
          {l(recommendation.title)}
        </h2>
        <p className="mt-2 max-w-[62ch] text-lg">{firstSentence}</p>
        <Disclosure summary={ts("why")} className="mt-2">
          <div className="flex flex-col gap-3 pb-4">
            <p className="max-w-[70ch]">{withoutMockTag(l(recommendation.text))}</p>
            <ul className="max-w-[70ch] list-disc space-y-1.5 pl-5">
              {recommendation.actions.map((a, i) => (
                <li key={i}>{l(a)}</li>
              ))}
            </ul>
          </div>
        </Disclosure>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label={ts("cropLabel")}
          value={crop}
          onChange={(c) => {
            setCrop(c);
            setShowAll(false);
          }}
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
        {rows.length > 0 ? (
          <Segmented
            label={t("view.label")}
            value={view}
            onChange={setView}
            className="w-full sm:w-auto"
            options={[
              { value: "list", label: t("view.list") },
              { value: "map", label: t("view.map") },
            ]}
          />
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState>{t("noZones")}</EmptyState>
      ) : (
        <section aria-labelledby="feed-crop" className="rounded-2xl border border-line bg-surface">
          <div className="px-5 pt-5 sm:px-6">
            <h2 id="feed-crop" className="text-xl font-semibold tracking-tight">
              {ts("cropTitle", { crop: tc(crop) })}
            </h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-ink-muted">{ts("buyFirst")}</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {rows.slice(0, 3).map((r) => (
                    <button
                      key={r.zone.id}
                      type="button"
                      onClick={() => select(r.zone)}
                      className="press min-h-9 rounded-full bg-field-tint px-3 text-sm font-semibold text-field-strong hover:bg-field/20"
                    >
                      {r.zone.name}
                    </button>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink-muted">{ts("testFor")}</dt>
                <dd className="mt-1">
                  {tests.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {tests.map((f) => (
                        <li key={f.code} className="flex items-start gap-1.5">
                          <AlertIcon size={16} className="mt-1 shrink-0 text-status-watch" />
                          {l(f.label)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{ts("noTests")}</p>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {view === "map" ? (
            <div className="mt-5 border-t border-line p-3 sm:p-4">
              <ZoneMap
                zones={region.zones}
                outlookFor={outlookFor}
                markerLabel={markerLabel}
                onSelect={select}
                selectedId={selectedId}
                label={t("mapLabel", { crop: cropName })}
                className="h-[60dvh] min-h-72 rounded-xl"
              />
            </div>
          ) : (
            <>
              <h3 className="mt-5 border-t border-line px-5 pt-4 text-sm font-medium text-ink-muted sm:px-6">
                {ts("communes")}
              </h3>
              <ul className="mt-2">
                {shown.map(({ zone, outlook }) => {
                  const level = outlook.availability.level;
                  const tone = RISK_TONE[level];
                  const Icon = TONE_ICONS[tone];
                  return (
                    <li key={zone.id} className="border-t border-line/70 first:border-t-0">
                      <button
                        type="button"
                        onClick={() => select(zone)}
                        className="flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken sm:px-6"
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[tone].soft} ${TONE_CLASSES[tone].text}`}
                        >
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{zone.name}</span>
                          {outlook.area_ha != null ? (
                            <span className="block text-sm text-ink-muted">
                              {ts("row", { ha: formatNumber(outlook.area_ha, locale, 0), crop: cropName })}
                            </span>
                          ) : null}
                        </span>
                        <span className={`shrink-0 text-right text-sm font-semibold ${TONE_CLASSES[tone].text}`}>
                          {ts(`state.${level}`)}
                        </span>
                        <ChevronDownIcon size={18} className="shrink-0 -rotate-90 text-ink-muted" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 sm:px-6">
                <p className="text-sm text-ink-muted">{ts("tapHint")}</p>
                {rows.length > SHORT_LIST ? (
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    className="min-h-11 rounded-xl px-3 text-sm font-semibold text-field-strong hover:bg-field-tint"
                  >
                    {showAll ? ts("showFewer") : ts("showAll", { count: rows.length })}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </section>
      )}

      {validation && validation.years.length > 0 ? (
        <section aria-labelledby="feed-proof" className="rounded-2xl border border-line bg-surface px-5 pt-5 sm:px-6 sm:pt-6">
          <h2 id="feed-proof" className="text-xl font-semibold tracking-tight">
            {ts("proofTitle")}
          </h2>
          <p className="mt-1 max-w-[62ch]">
            {ts("proofText", { hits: validation.hits, total: validation.hits + validation.misses })}
          </p>
          <Disclosure summary={ts("proofDetails")} className="mt-2">
            <ValidationCard validation={validation} embedded />
          </Disclosure>
        </section>
      ) : null}

      <section className="rounded-2xl bg-surface-sunken px-5 sm:px-6">
        <Disclosure summary={ts("aboutTitle")}>
          <div className="pb-5">
            <h3 className="font-semibold">{ts("caveats")}</h3>
            <ul className="mt-1 max-w-[70ch] list-disc space-y-1.5 pl-5">
              {region.caveats.map((c, i) => (
                <li key={i}>{l(c)}</li>
              ))}
            </ul>
            {recommendation.assumptions.length > 0 ? (
              <>
                <h3 className="mt-5 font-semibold">{ts("assumptions")}</h3>
                <ul className="mt-1 max-w-[70ch] list-disc space-y-1.5 pl-5">
                  {recommendation.assumptions.map((a, i) => (
                    <li key={i}>{l(a)}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <h3 className="mt-5 text-sm font-medium text-ink-muted">{ts("sources")}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {region.sources.map((s) => (
                <SourceChip key={s.dataset} source={s} />
              ))}
            </div>
          </div>
        </Disclosure>
      </section>

      <Sheet
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected ? t("sheetTitle", { zone: selected.name, crop: tc(crop) }) : null}
      >
        {selected ? (
          selectedOutlook ? (
            <ZoneDetails outlook={selectedOutlook} centroid={selected.centroid} place={selected.name} />
          ) : (
            <p>{t("noCropData")}</p>
          )
        ) : null}
      </Sheet>
    </div>
  );
}

/** How many communes the list shows before "Show all". */
const SHORT_LIST = 6;

/** Communes that grow the crop, safest first (lowest risk score, then the most area). */
function ranked(zones: Zone[], crop: Crop) {
  return zones
    .flatMap((zone) => {
      const outlook = zone.crops.find((c) => c.crop === crop);
      return outlook ? [{ zone, outlook }] : [];
    })
    .sort(
      (a, b) =>
        a.outlook.availability.score - b.outlook.availability.score ||
        (b.outlook.area_ha ?? 0) - (a.outlook.area_ha ?? 0),
    );
}

/** Quality warnings at medium or high in at least half the communes: what to test every lot for. */
function qualityTests(outlooks: CropOutlook[]) {
  const counts = new Map<string, { flag: QualityFlag; n: number }>();
  for (const o of outlooks) {
    for (const f of o.quality.flags) {
      if (f.level === "low") continue;
      const entry = counts.get(f.code);
      counts.set(f.code, { flag: entry?.flag ?? f, n: (entry?.n ?? 0) + 1 });
    }
  }
  return [...counts.values()].filter((c) => c.n * 2 >= outlooks.length).map((c) => c.flag);
}

/** The demo banner already says the data are made up, so the "[MOCK]" tag in mock text is noise here. */
function withoutMockTag(text: string) {
  return text.replace(/^\[MOCK\]\s*/, "");
}
