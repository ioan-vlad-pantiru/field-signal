"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getImportOrigins, type Loaded } from "@/lib/api";
import type { ImportOrigin, ImportOrigins, OriginReplay, RiskLevel, SeasonOutcome, Status } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { ConfidenceBadge } from "@/components/ui/badges";
import { Disclosure } from "@/components/ui/disclosure";
import { ChevronDownIcon } from "@/components/ui/icons";
import { SeasonAxis, SeasonStrip } from "@/components/ui/season-strip";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { ErrorState } from "@/components/ui/states";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS, type Tone } from "@/components/ui/tone";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; result: Loaded<ImportOrigins> };

/** A poor harvest: the official yield 10% or more below its trend (same cut as the build). */
const POOR_PCT = -10;
const RISK_STATUS: Record<RiskLevel, Status> = { low: "good", medium: "watch", high: "bad" };

/**
 * Imported soy, kept short: the advice, one row per origin (tap for details), one line of proof.
 * Everything else sits one tap away.
 */
export function OriginsView() {
  const t = useTranslations("Origins");
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getImportOrigins()
      .then((result) => active && setState({ status: "ready", result }))
      .catch(() => active && setState({ status: "error" }));
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p role="status" className="text-ink-muted">
          {t("loading")}
        </p>
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <ErrorState
        onRetry={() => {
          setState({ status: "loading" });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return <Origins data={state.result.data} />;
}

function useDate() {
  const locale = useAppLocale();
  return (iso: string, withYear = false) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
}

/** One origin today in a word and a line, plus the tone they are drawn in. */
function useSummary() {
  const t = useTranslations("Origins");
  const date = useDate();
  return (o: ImportOrigin): { word: string; line: string; tone: Tone } => {
    const r = o.current;
    if (!r) {
      return {
        word: t("state.before"),
        line: t("line.before", { date: o.next_reading ? date(o.next_reading) : "–" }),
        tone: "nodata",
      };
    }
    const tone = RISK_TONE[r.level];
    if (o.stage === "done") {
      const word = { high: t("state.short"), medium: t("state.average"), low: t("state.good") }[r.level];
      const pct = o.seasons.find((s) => s.season === o.current_season)?.yield_anomaly_pct;
      const line =
        pct == null
          ? t("line.done")
          : t("line.doneYield", { pct: Math.abs(Math.round(pct)), side: pct < 0 ? t("below") : t("above") });
      return { word, line, tone };
    }
    return { word: t(`state.in_${r.level}`), line: t("line.in", { date: date(r.as_of) }), tone };
  };
}

const CONCERN: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

/** Origins with a reading come first, worst first; the rest keep the build's order. */
function sortedByConcern(origins: ImportOrigin[]) {
  return [...origins].sort((a, b) => (a.current ? CONCERN[a.current.level] : 3) - (b.current ? CONCERN[b.current.level] : 3));
}

function Origins({ data }: { data: ImportOrigins }) {
  const t = useTranslations("Origins");
  const l = useLocalized();
  const date = useDate();
  const summary = useSummary();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.origins.find((o) => o.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="mt-1 text-lg text-ink-muted">{t("intro")}</p>
      </header>

      <section aria-labelledby="origins-advice" className="rounded-2xl border border-field/40 bg-field-tint p-5 sm:p-6">
        <h2 id="origins-advice" className="text-2xl font-semibold tracking-tight text-balance">
          {l(data.headline)}
        </h2>
        <p className="mt-2 max-w-[60ch] text-lg">{l(data.advice)}</p>
      </section>

      <section aria-labelledby="origins-list" className="rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 px-5 pt-5 sm:px-6">
          <h2 id="origins-list" className="text-xl font-semibold tracking-tight">
            {t("listTitle")}
          </h2>
          <p className="text-sm text-ink-muted">{t("asOf", { date: date(data.as_of, true) })}</p>
        </div>
        <ul className="mt-3">
          {sortedByConcern(data.origins).map((o) => {
            const s = summary(o);
            const Icon = TONE_ICONS[s.tone];
            return (
              <li key={o.id} className="border-t border-line">
                <button
                  type="button"
                  onClick={() => setOpenId(o.id)}
                  className="flex min-h-16 w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken sm:gap-4 sm:px-6"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[s.tone].soft} ${TONE_CLASSES[s.tone].text}`}
                  >
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{l(o.name)}</span>
                    <span className={`block text-sm font-semibold sm:hidden ${s.tone === "nodata" ? "text-ink-muted" : TONE_CLASSES[s.tone].text}`}>
                      {s.word}
                    </span>
                    <span className="block text-sm text-ink-muted">
                      {s.line}
                      {o.confidence === "low" ? ` · ${t("weakSignal")}` : ""}
                    </span>
                  </span>
                  <span
                    className={`hidden shrink-0 text-right font-semibold sm:block ${s.tone === "nodata" ? "text-ink-muted" : TONE_CLASSES[s.tone].text}`}
                  >
                    {s.word}
                  </span>
                  <ChevronDownIcon size={18} className="shrink-0 -rotate-90 text-ink-muted" />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line px-5 py-3 text-sm text-ink-muted sm:px-6">{t("listHint")}</p>
      </section>

      {data.replay ? <Proof replay={data.replay} /> : null}

      <section className="rounded-2xl bg-surface-sunken px-5 sm:px-6">
        <Disclosure summary={t("aboutTitle")}>
          <div className="pb-5">
            <h3 className="font-semibold">{t("methodTitle")}</h3>
            <p className="mt-1 max-w-[70ch]">{l(data.method)}</p>
            <h3 className="mt-5 font-semibold">{t("limitsTitle")}</h3>
            <ul className="mt-1 max-w-[70ch] list-disc space-y-1.5 pl-5">
              {data.limits.map((x, i) => (
                <li key={i}>{l(x)}</li>
              ))}
            </ul>
            <h3 className="mt-5 text-sm font-medium text-ink-muted">{t("sourcesTitle")}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.sources.map((s) => (
                <SourceChip key={s.dataset} source={s} />
              ))}
            </div>
          </div>
        </Disclosure>
      </section>

      <Sheet open={open !== null} onClose={() => setOpenId(null)} title={open ? l(open.name) : null}>
        {open ? <OriginDetails origin={open} /> : null}
      </Sheet>
    </div>
  );
}

// --------------------------------------------------------------------------- proof

/** One sentence of proof (Argentina 2023), with the dated timeline behind a tap. */
function Proof({ replay }: { replay: OriginReplay }) {
  const t = useTranslations("Origins");
  const tr = useTranslations("Risk");
  const l = useLocalized();
  const locale = useAppLocale();
  const date = useDate();
  const firstHigh = replay.ours.find((c) => c.level === "high");
  const dated = replay.official.filter((e) => e.date);
  // The first dated estimate is the last one before the cuts; the cuts start with the second.
  const firstCut = dated[1] ?? dated[0];
  const top = Math.max(...replay.official.map((e) => e.value));
  const events = [
    ...replay.ours.map((c) => ({ kind: "ours" as const, key: `o-${c.as_of}`, date: c.as_of, score: c.score, level: c.level })),
    ...replay.official.map((e, i) => ({ kind: "official" as const, key: `u-${i}`, date: e.date ?? null, value: e.value })),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

  return (
    <section aria-labelledby="origins-proof" className="rounded-2xl border border-line bg-surface px-5 pt-5 sm:px-6 sm:pt-6">
      <h2 id="origins-proof" className="text-xl font-semibold tracking-tight">
        {t("proofTitle")}
      </h2>
      <p className="mt-1 max-w-[62ch]">
        {firstHigh && firstCut?.date
          ? t("proofText", {
              ours: date(firstHigh.as_of, true),
              usda: date(firstCut.date, true),
              from: formatNumber(replay.official[0].value, locale, 0),
              to: formatNumber(replay.official[replay.official.length - 1].value, locale, 0),
            })
          : l(replay.text)}
      </p>
      <Disclosure summary={t("proofDates")} className="mt-2">
        <ol className="flex flex-col pb-4">
          {events.map((e) => (
            <li key={e.key} className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 border-b border-line/60 py-2 last:border-b-0">
              <span className={`text-sm tabular-nums ${e.date ? "text-ink-muted" : "font-semibold"}`}>
                {e.date ? date(e.date, true) : t("replayFinal")}
              </span>
              {e.kind === "ours" ? (
                <span>
                  <span
                    className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${TONE_CLASSES[RISK_TONE[e.level]].solid}`}
                  >
                    {t("replayOurs")}: {t("replayScore", { risk: tr(e.level), score: Math.round(e.score) })}
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-sm text-ink-muted">{t("replayOfficial")}</span>
                  <span className="h-2.5 min-w-4 flex-1 rounded-full bg-surface-sunken" aria-hidden="true">
                    <span className="block h-2.5 rounded-full bg-ink-muted" style={{ width: `${(100 * e.value) / top}%` }} />
                  </span>
                  <span className="w-14 text-right font-semibold tabular-nums">
                    {formatNumber(e.value, locale, 0)} {replay.unit}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ol>
      </Disclosure>
    </section>
  );
}

// --------------------------------------------------------------------------- details sheet

function OriginDetails({ origin: o }: { origin: ImportOrigin }) {
  const t = useTranslations("Origins");
  const l = useLocalized();
  const date = useDate();
  const s = useSummary()(o);
  const Icon = TONE_ICONS[s.tone];
  const reading = o.current;

  return (
    <div className="flex flex-col gap-5">
      <div className={`rounded-xl p-4 ${TONE_CLASSES[s.tone].soft}`}>
        <p
          className={`flex items-center gap-1.5 text-lg font-semibold ${s.tone === "nodata" ? "text-ink-muted" : TONE_CLASSES[s.tone].text}`}
        >
          <Icon size={18} />
          {s.word}
          {reading ? <span className="ml-1 tabular-nums text-ink">{Math.round(reading.score)}/100</span> : null}
        </p>
        <p className="mt-1">{l(o.note)}</p>
        {reading ? (
          <p className="mt-1 text-sm text-ink-muted">
            {t("line.in", { date: date(reading.as_of, true) })}
            {reading.provisional ? ` · ${t("detail.provisional")}` : ""}
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink-muted">{t("detail.when")}</h3>
        <p className="mt-0.5">{t("detail.whenText", { window: l(o.window), harvest: l(o.harvest) })}</p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink-muted">{t("detail.matters")}</h3>
        <p className="mt-0.5">{l(o.role)}</p>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-ink-muted">{t("detail.track")}</h3>
          <ConfidenceBadge confidence={o.confidence} />
        </div>
        <p className="mt-1">
          {t("detail.trackLine", {
            caught: o.track.caught,
            bad: o.track.bad_seasons,
            falseAlarms: o.track.false_alarms,
            seasons: o.track.seasons,
          })}
        </p>
        <PastHarvests origin={o} />
      </div>

      <div>
        {reading && reading.drivers.length > 0 ? (
          <Disclosure summary={t("detail.why")}>
            <ul className="list-disc space-y-1 pl-5">
              {reading.drivers.map((d) => (
                <li key={d.code}>{l(d.label)}</li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
        <Disclosure summary={t("detail.how")}>
          <p className="text-sm">{l(o.track.lead)}</p>
          <p className="mt-2 text-sm">
            {t("detail.trackTruth", {
              truth: l(o.track.truth),
              r: formatNumber(o.track.correlation, "en", 2).replace("-", "−"),
            })}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {t("detail.points", { count: o.points.length })}: {o.points.map((p) => p.name).join(" · ")}
          </p>
        </Disclosure>
      </div>
    </div>
  );
}

/** The marks in the two rows, drawn as `SeasonStrip` draws them (medium in its tinted form). */
const LEGEND = [
  { key: "good", swatch: "bg-surface-sunken", mark: "" },
  { key: "watch", swatch: "bg-status-watch-tint text-status-watch", mark: "!" },
  { key: "bad", swatch: "bg-status-bad text-on-status", mark: "×" },
  { key: "no_data", swatch: "border border-dashed border-line", mark: "" },
] as const;

/** `faint` draws a cell in its tinted form: medium risk stays visible but quieter than high. */
function asOutcome(year: number, status: Status, faint = false): SeasonOutcome {
  return { year, crop: "soybean", status, reasons: [], evidence_level: faint ? "low" : "high" };
}

/** Our warning over the official harvest, one column per harvest year: red over red is a catch. */
function PastHarvests({ origin }: { origin: ImportOrigin }) {
  const t = useTranslations("Origins");
  const l = useLocalized();
  const years = origin.seasons.map((s) => s.harvest_year);
  const first = years[0];
  const last = years[years.length - 1];
  const warning = origin.seasons.map((s) => asOutcome(s.harvest_year, RISK_STATUS[s.level], s.level === "medium"));
  const harvest = origin.seasons.map((s) =>
    asOutcome(s.harvest_year, s.yield_anomaly_pct == null ? "no_data" : s.yield_anomaly_pct <= POOR_PCT ? "bad" : "good"),
  );
  const name = l(origin.name);
  return (
    <div className="mt-3">
      <div className="grid grid-cols-1 gap-y-1">
        <span className="text-xs text-ink-muted">{t("rowWarning")}</span>
        <SeasonStrip outcomes={warning} years={years} size="sm" animate label={t("stripWarning", { origin: name, first, last })} />
        <span className="mt-1 text-xs text-ink-muted">{t("rowHarvest")}</span>
        <SeasonStrip outcomes={harvest} years={years} size="sm" animate label={t("stripHarvest", { origin: name, first, last })} />
        <SeasonAxis years={years} />
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {LEGEND.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] text-[9px] font-bold leading-none ${item.swatch}`}
            >
              {item.mark}
            </span>
            {t(`legend.${item.key}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
