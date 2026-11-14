"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getImportOrigins, type Loaded } from "@/lib/api";
import type {
  ImportOrigin,
  ImportOrigins,
  OriginReplay,
  OriginSeason,
  RiskLevel,
  SeasonOutcome,
  Status,
} from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { ConfidenceBadge } from "@/components/ui/badges";
import { Disclosure } from "@/components/ui/disclosure";
import { SeasonAxis, SeasonStrip } from "@/components/ui/season-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { ErrorState } from "@/components/ui/states";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS, type Tone } from "@/components/ui/tone";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; result: Loaded<ImportOrigins> };

/** A poor harvest: the official yield 10% or more below its trend (same cut as the build). */
const POOR_PCT = -10;
const RISK_STATUS: Record<RiskLevel, Status> = { low: "good", medium: "watch", high: "bad" };

/** Imported soy: the advice, a crop calendar across origins, the 2023 replay, then each origin. */
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
        <Skeleton className="h-40" />
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

/** The status words for an origin today, and the tone they are drawn in. */
function useStatus() {
  const t = useTranslations("Origins.status");
  const tr = useTranslations("Risk");
  const date = useDate();
  return (o: ImportOrigin): { text: string; tone: Tone } => {
    if (!o.current) return { text: t("before", { date: o.next_reading ? date(o.next_reading) : "–" }), tone: "nodata" };
    const risk = tr(o.current.level);
    return {
      text: o.stage === "done" ? t("done", { risk }) : t("in_window", { risk }),
      tone: RISK_TONE[o.current.level],
    };
  };
}

function Origins({ data }: { data: ImportOrigins }) {
  const t = useTranslations("Origins");
  const l = useLocalized();
  const date = useDate();
  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t("title")}</h1>
        <p className="mt-2 max-w-[62ch] text-lg text-ink-muted">{t("intro")}</p>
        <p className="mt-3 text-sm text-ink-muted">{t("asOf", { date: date(data.as_of, true) })}</p>
      </header>

      <section
        aria-labelledby="origins-advice"
        className="flex flex-col gap-4 rounded-2xl border border-field/40 bg-field-tint p-5 sm:p-6"
      >
        <div>
          <p className="text-sm font-semibold text-field-strong">{t("adviceLabel")}</p>
          <h2 id="origins-advice" className="mt-1 text-2xl font-semibold tracking-tight text-balance lg:text-3xl">
            {l(data.headline)}
          </h2>
          <p className="mt-2 max-w-[65ch]">{l(data.advice)}</p>
        </div>
        <ol className="flex flex-col">
          {data.actions.map((a, i) => (
            <li key={i} className="flex gap-3 border-t border-field/25 py-2.5">
              <span aria-hidden="true" className="w-5 shrink-0 font-semibold tabular-nums text-field-strong">
                {i + 1}
              </span>
              <span className="max-w-[70ch]">{l(a)}</span>
            </li>
          ))}
        </ol>
      </section>

      <CropCalendar origins={data.origins} asOf={data.as_of} />

      {data.replay ? <Replay replay={data.replay} /> : null}

      <section aria-labelledby="origins-list" className="flex flex-col gap-4">
        <div>
          <h2 id="origins-list" className="text-xl font-semibold tracking-tight">
            {t("originsTitle")}
          </h2>
          <p className="mt-0.5 text-ink-muted">{t("originsHint")}</p>
        </div>
        <ul className="grid gap-4 lg:grid-cols-2">
          {data.origins.map((o) => (
            <OriginCard key={o.id} origin={o} />
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-surface-sunken p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{t("methodTitle")}</h2>
        <p className="mt-2 max-w-[70ch]">{l(data.method)}</p>
        <h2 className="mt-6 text-lg font-semibold">{t("limitsTitle")}</h2>
        <ul className="mt-2 max-w-[70ch] list-disc space-y-2 pl-5">
          {data.limits.map((x, i) => (
            <li key={i}>{l(x)}</li>
          ))}
        </ul>
        <h3 className="mt-6 text-sm font-medium text-ink-muted">{t("sourcesTitle")}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {data.sources.map((s) => (
            <SourceChip key={s.dataset} source={s} />
          ))}
        </div>
      </section>
    </div>
  );
}

// --------------------------------------------------------------------------- crop calendar

const DAY = 86_400_000;

/** July to June: Ukraine's summer and South America's season sit side by side without wrapping. */
function calendarYear(asOf: string) {
  const d = new Date(`${asOf}T00:00:00Z`);
  const start = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const from = Date.UTC(start, 6, 1);
  const to = Date.UTC(start + 1, 6, 1);
  /** Position of an MM-DD (or an ISO date) along the year, 0..1. */
  const at = (md: string) => {
    const [m, day] = md.split("-").map(Number);
    const year = m >= 7 ? start : start + 1;
    return Math.min(1, Math.max(0, (Date.UTC(year, m - 1, day) - from) / (to - from)));
  };
  const today = Math.min(1, Math.max(0, (d.getTime() - from) / (to - from)));
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(start + (i >= 6 ? 1 : 0), (6 + i) % 12, 1)));
  return { start, at, today, months, span: (to - from) / DAY };
}

function CropCalendar({ origins, asOf }: { origins: ImportOrigin[]; asOf: string }) {
  const t = useTranslations("Origins");
  const l = useLocalized();
  const locale = useAppLocale();
  const status = useStatus();
  const cal = calendarYear(asOf);
  const monthName = (d: Date, month: "short" | "narrow") =>
    d.toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", { month, timeZone: "UTC" }).replace(".", "");

  return (
    <section aria-labelledby="origins-calendar" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 id="origins-calendar" className="text-xl font-semibold tracking-tight">
        {t("calendarTitle")}
      </h2>
      <p className="mt-0.5 max-w-[65ch] text-ink-muted">{t("calendarHint")}</p>

      <div className="mt-6" role="list" aria-label={t("calendarLabel", { start: cal.start, end: cal.start + 1 })}>
        {/* Month axis, aligned with the tracks below (the name column collapses on phones). */}
        <div aria-hidden="true" className="grid grid-cols-1 gap-x-4 sm:grid-cols-[13rem_1fr]">
          <span className="hidden sm:block" />
          <div className="relative grid grid-cols-12 text-xs text-ink-muted">
            {cal.months.map((m, i) => (
              <span key={i} className="truncate border-l border-line pl-1 first:border-l-0 first:pl-0">
                <span className="sm:hidden">{monthName(m, "narrow")}</span>
                <span className="hidden sm:inline">{monthName(m, "short")}</span>
                {m.getUTCMonth() === 0 ? <span className="ml-0.5 hidden tabular-nums md:inline">{m.getUTCFullYear()}</span> : null}
              </span>
            ))}
          </div>
        </div>

        {origins.map((o) => {
          const s = status(o);
          const Icon = TONE_ICONS[s.tone];
          const w0 = cal.at(o.window_start);
          const w1 = cal.at(o.window_end);
          const h0 = cal.at(o.harvest_start);
          const h1 = cal.at(o.harvest_end);
          const reading = o.current;
          const band = reading ? TONE_CLASSES[RISK_TONE[reading.level]].soft : "bg-surface-sunken";
          return (
            <div
              key={o.id}
              role="listitem"
              aria-label={t("rowLabel", { origin: l(o.name), window: l(o.window), harvest: l(o.harvest), status: s.text })}
              className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 border-t border-line py-3 first:border-t-0 sm:grid-cols-[13rem_1fr]"
            >
              <div aria-hidden="true" className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="font-semibold">{l(o.name)}</span>
                <span className={`inline-flex shrink-0 items-center gap-1 text-sm ${TONE_CLASSES[s.tone].text}`}>
                  <Icon size={14} />
                  {s.text}
                </span>
              </div>
              <div aria-hidden="true" className="relative h-11">
                <div className="absolute inset-0 grid grid-cols-12">
                  {cal.months.map((_, i) => (
                    <span key={i} className="border-l border-line/70 first:border-l-0" />
                  ))}
                </div>
                <span
                  className={`absolute top-0.5 flex h-5 items-center overflow-hidden rounded-md border border-ink/15 px-1.5 text-xs font-medium ${band}`}
                  style={{ left: `${w0 * 100}%`, width: `${(w1 - w0) * 100}%` }}
                >
                  <span className="truncate">{t("decided")}</span>
                </span>
                <span
                  className="absolute bottom-0.5 flex h-4 items-center overflow-hidden rounded-md px-1.5 text-[11px] leading-none text-ink-muted ring-1 ring-inset ring-line [background:repeating-linear-gradient(135deg,var(--color-surface-sunken)_0_4px,transparent_4px_8px)]"
                  style={{ left: `${h0 * 100}%`, width: `${(h1 - h0) * 100}%` }}
                >
                  <span className="truncate">{t("harvest")}</span>
                </span>
                <span className="absolute -inset-y-1 w-0.5 rounded-full bg-field" style={{ left: `${cal.today * 100}%` }} />
              </div>
            </div>
          );
        })}

        <div aria-hidden="true" className="grid grid-cols-1 gap-x-4 sm:grid-cols-[13rem_1fr]">
          <span className="hidden sm:block" />
          <div className="relative h-5">
            <span
              className="absolute -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-field-strong"
              style={{ left: `${cal.today * 100}%` }}
            >
              {t("today")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- 2023 replay

type ReplayEvent =
  | { kind: "ours"; key: string; date: string; score: number; level: RiskLevel }
  | { kind: "official"; key: string; date: string | null; value: number };

/** Argentina 2022/23 in date order: our warnings come first, USDA's cuts follow. */
function Replay({ replay }: { replay: OriginReplay }) {
  const t = useTranslations("Origins");
  const tr = useTranslations("Risk");
  const l = useLocalized();
  const locale = useAppLocale();
  const date = useDate();
  const top = Math.max(...replay.official.map((e) => e.value));
  const events: ReplayEvent[] = [
    ...replay.ours.map((c) => ({ kind: "ours" as const, key: `o-${c.as_of}`, date: c.as_of, score: c.score, level: c.level })),
    ...replay.official.map((e, i) => ({ kind: "official" as const, key: `u-${i}`, date: e.date ?? null, value: e.value })),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

  return (
    <section aria-labelledby="origins-replay" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 id="origins-replay" className="text-xl font-semibold tracking-tight text-balance">
        {l(replay.title)}
      </h2>
      <p className="mt-1 max-w-[65ch]">{l(replay.text)}</p>
      <p className="mt-1 max-w-[65ch] text-sm text-ink-muted">{t("replayHint")}</p>

      <div className="mt-5 hidden grid-cols-[7rem_1fr_1fr] gap-x-4 border-b border-line pb-2 text-sm font-medium text-ink-muted sm:grid">
        <span />
        <span>{t("replayOurs")}</span>
        <span>{t("replayOfficial")}</span>
      </div>
      <ol className="mt-3 flex flex-col sm:mt-0">
        {events.map((e) => {
          const when = e.date ? date(e.date, true) : t("replayFinal");
          if (e.kind === "ours") {
            const tone = RISK_TONE[e.level];
            return (
              <li key={e.key} className="grid grid-cols-[6.5rem_1fr] items-center gap-x-4 border-b border-line/60 py-2 sm:grid-cols-[7rem_1fr_1fr]">
                <span className="text-sm tabular-nums text-ink-muted">{when}</span>
                <span className="flex items-center gap-2">
                  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${TONE_CLASSES[tone].solid}`}>
                    {t("replayScore", { risk: tr(e.level), score: Math.round(e.score) })}
                  </span>
                </span>
                <span className="hidden sm:block" />
              </li>
            );
          }
          return (
            <li key={e.key} className="grid grid-cols-[6.5rem_1fr] items-center gap-x-4 border-b border-line/60 py-2 last:border-b-0 sm:grid-cols-[7rem_1fr_1fr]">
              <span className={`text-sm tabular-nums ${e.date ? "text-ink-muted" : "font-semibold"}`}>{when}</span>
              <span className="hidden sm:block" />
              <span className="flex items-center gap-2">
                <span className="text-sm text-ink-muted sm:hidden">{t("replayOfficial")}</span>
                <span className="h-2.5 min-w-4 flex-1 rounded-full bg-surface-sunken" aria-hidden="true">
                  <span className="block h-2.5 rounded-full bg-ink-muted" style={{ width: `${(100 * e.value) / top}%` }} />
                </span>
                <span className="w-14 text-right font-semibold tabular-nums">
                  {formatNumber(e.value, locale, 0)} {replay.unit}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// --------------------------------------------------------------------------- origin cards

function OriginCard({ origin: o }: { origin: ImportOrigin }) {
  const t = useTranslations("Origins");
  const l = useLocalized();
  const date = useDate();
  const status = useStatus()(o);
  const Icon = TONE_ICONS[status.tone];
  const reading = o.current;

  return (
    <li className="flex flex-col rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold tracking-tight">{l(o.name)}</h3>
          <p className="mt-0.5 text-sm text-ink-muted">{l(o.provinces)}</p>
        </div>
        <ConfidenceBadge confidence={o.confidence} />
      </div>

      <div className={`mt-4 rounded-xl p-4 ${TONE_CLASSES[status.tone].soft}`}>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={`inline-flex items-center gap-1.5 text-lg font-semibold ${TONE_CLASSES[status.tone].text}`}>
            <Icon size={18} />
            {status.text}
          </span>
          {reading ? (
            <span className="font-display text-xl font-semibold tabular-nums">{Math.round(reading.score)}/100</span>
          ) : null}
        </p>
        <p className="mt-1.5">{l(o.note)}</p>
        {reading ? (
          <p className="mt-1.5 text-sm text-ink-muted">
            {t("readingAsOf", { date: date(reading.as_of, true) })}
            {reading.provisional ? ` · ${t("provisional")}` : ""}
          </p>
        ) : null}
      </div>

      <h4 className="mt-5 text-sm font-medium text-ink-muted">{t("whyMatters")}</h4>
      <p className="mt-1">{l(o.role)}</p>

      <h4 className="mt-5 text-sm font-medium text-ink-muted">{t("pastTitle")}</h4>
      <p className="mt-1">
        {t("trackLine", {
          caught: o.track.caught,
          bad: o.track.bad_seasons,
          falseAlarms: o.track.false_alarms,
          seasons: o.track.seasons,
        })}{" "}
        {l(o.track.lead)}
      </p>
      <PastHarvests origin={o} />

      <div className="mt-auto pt-4">
        {reading && reading.drivers.length > 0 ? (
          <Disclosure summary={t("why")}>
            <ul className="list-disc space-y-1 pl-5">
              {reading.drivers.map((d) => (
                <li key={d.code}>{l(d.label)}</li>
              ))}
            </ul>
          </Disclosure>
        ) : null}
        <Disclosure summary={t("how")}>
          <p className="text-sm">
            {t("trackTruth", {
              truth: l(o.track.truth),
              r: formatNumber(o.track.correlation, "en", 2).replace("-", "−"),
            })}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {t("points", { count: o.points.length })}: {o.points.map((p) => p.name).join(" · ")}
          </p>
        </Disclosure>
      </div>
    </li>
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
  const seasons: OriginSeason[] = origin.seasons;
  const years = seasons.map((s) => s.harvest_year);
  const first = years[0];
  const last = years[years.length - 1];
  const warning = seasons.map((s) => asOutcome(s.harvest_year, RISK_STATUS[s.level], s.level === "medium"));
  const harvest = seasons.map((s) =>
    asOutcome(
      s.harvest_year,
      s.yield_anomaly_pct == null ? "no_data" : s.yield_anomaly_pct <= POOR_PCT ? "bad" : "good",
    ),
  );
  const name = l(origin.name);
  return (
    <div className="mt-3">
      <div className="grid grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[5.5rem_1fr] sm:gap-y-1.5">
        <span className="text-xs text-ink-muted">{t("rowWarning")}</span>
        <SeasonStrip outcomes={warning} years={years} size="sm" animate label={t("stripWarning", { origin: name, first, last })} />
        <span className="text-xs text-ink-muted">{t("rowHarvest")}</span>
        <SeasonStrip outcomes={harvest} years={years} size="sm" animate label={t("stripHarvest", { origin: name, first, last })} />
        <span className="hidden sm:block" />
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
