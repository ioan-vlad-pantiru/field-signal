"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getImportOrigins, type Loaded } from "@/lib/api";
import type { ImportOrigin, ImportOrigins, OriginReplay, OriginSeason } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { ConfidenceBadge } from "@/components/ui/badges";
import { Disclosure } from "@/components/ui/disclosure";
import { CheckIcon, CrossIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceChip } from "@/components/ui/source-chip";
import { ErrorState } from "@/components/ui/states";
import { RISK_TONE, TONE_CLASSES, TONE_ICONS } from "@/components/ui/tone";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; result: Loaded<ImportOrigins> };

/** Imported soy: one card per origin, the advice across them, and the 2023 replay as proof. */
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
        <Skeleton className="h-72" />
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
            <li key={i} className="flex gap-3 border-t border-field/25 py-2">
              <span aria-hidden="true" className="w-5 shrink-0 font-semibold tabular-nums text-field-strong">
                {i + 1}
              </span>
              {l(a)}
            </li>
          ))}
        </ol>
      </section>

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

      {data.replay ? <Replay replay={data.replay} /> : null}

      <section className="rounded-2xl bg-surface-sunken p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{t("methodTitle")}</h2>
        <p className="mt-2 max-w-[70ch]">{l(data.method)}</p>
        <h2 className="mt-5 text-lg font-semibold">{t("limitsTitle")}</h2>
        <ul className="mt-2 max-w-[70ch] list-disc space-y-2 pl-5">
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
      </section>
    </div>
  );
}

function OriginCard({ origin: o }: { origin: ImportOrigin }) {
  const t = useTranslations("Origins");
  const tr = useTranslations("Risk");
  const l = useLocalized();
  const date = useDate();
  const reading = o.current;
  const tone = reading ? RISK_TONE[reading.level] : "nodata";
  const Icon = TONE_ICONS[tone];

  return (
    <li className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold tracking-tight">{l(o.name)}</h3>
          <p className="mt-0.5 text-sm text-ink-muted">{l(o.provinces)}</p>
        </div>
        <ConfidenceBadge confidence={o.confidence} />
      </div>

      <div className={`rounded-xl p-4 ${TONE_CLASSES[tone].soft}`}>
        <p className="text-sm text-ink-muted">{t(`seasonStage.${o.stage}`, { season: o.current_season })}</p>
        <p className={`mt-1 flex flex-wrap items-baseline gap-x-2 font-semibold ${TONE_CLASSES[tone].text}`}>
          <span className="inline-flex items-center gap-1.5 text-lg">
            <Icon size={18} />
            {reading ? tr(reading.level) : t("notStarted")}
          </span>
          {reading ? <span className="font-display text-2xl tabular-nums">{t("score", { score: Math.round(reading.score) })}</span> : null}
        </p>
        <p className="mt-2">{l(o.note)}</p>
        {reading ? <p className="mt-1 text-sm text-ink-muted">{t("readingAsOf", { date: date(reading.as_of, true) })}</p> : null}
        {reading?.provisional ? <p className="mt-1 text-sm text-ink-muted">{t("provisional")}</p> : null}
        <p className="mt-2 text-sm text-ink-muted">
          {t("decidedIn", { window: l(o.window) })} · {t("harvest", { harvest: l(o.harvest) })}
        </p>
      </div>

      <p className="text-ink-muted">{l(o.role)}</p>

      <div>
        <h4 className="font-semibold">{t("track")}</h4>
        <p className="mt-1">
          {t("trackLine", {
            caught: o.track.caught,
            bad: o.track.bad_seasons,
            falseAlarms: o.track.false_alarms,
            seasons: o.track.seasons,
          })}{" "}
          {l(o.track.lead)}
        </p>
        <SeasonPills origin={o} />
        <p className="mt-2 text-sm text-ink-muted">{t("trackTruth", { truth: l(o.track.truth) })}</p>
      </div>

      {reading && reading.drivers.length > 0 ? (
        <Disclosure summary={t("why")}>
          <ul className="list-disc space-y-1 pl-5">
            {reading.drivers.map((d) => (
              <li key={d.code}>{l(d.label)}</li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      <Disclosure summary={t("points", { count: o.points.length })}>
        <p className="text-sm text-ink-muted">{o.points.map((p) => p.name).join(" · ")}</p>
      </Disclosure>
    </li>
  );
}

/** Every past season: colour is our risk, the icon says whether the official yield agreed. */
function SeasonPills({ origin }: { origin: ImportOrigin }) {
  const t = useTranslations("Origins");
  const tr = useTranslations("Risk");
  const l = useLocalized();
  const locale = useAppLocale();
  const describe = (s: OriginSeason) =>
    t("seasonPill", {
      season: s.season,
      risk: tr(s.level),
      anomaly:
        s.yield_anomaly_pct == null
          ? t("noAnomaly")
          : `${s.yield_anomaly_pct > 0 ? "+" : ""}${formatNumber(s.yield_anomaly_pct, locale, 0)}%`,
      outcome: t(`outcome.${s.outcome ?? "none"}`),
    });
  return (
    <div className="mt-3">
      <ol className="flex flex-wrap gap-1" aria-label={t("seasonsLabel", { origin: l(origin.name) })}>
        {origin.seasons.map((s) => {
          const tone = RISK_TONE[s.level];
          const wrong = s.outcome === "missed" || s.outcome === "false_alarm";
          return (
            <li
              key={s.season}
              title={describe(s)}
              className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs tabular-nums ${TONE_CLASSES[tone].soft} ${
                s.outcome === "missed" ? "ring-2 ring-status-bad" : ""
              }`}
            >
              <span className="sr-only">{describe(s)}</span>
              <span aria-hidden="true">{s.season.length > 4 ? `'${s.season.slice(2, 4)}` : `'${s.season.slice(2)}`}</span>
              {s.outcome === "caught" ? (
                <CheckIcon size={12} className="text-status-good" />
              ) : wrong ? (
                <CrossIcon size={12} className="text-status-bad" />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <CheckIcon size={12} className="text-status-good" /> {t("legend.flagged")}
        </span>
        <span className="inline-flex items-center gap-1">
          <CrossIcon size={12} className="text-status-bad" /> {t("legend.falseAlarm")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm ring-2 ring-status-bad" /> {t("legend.missed")}
        </span>
        {(["low", "medium", "high"] as const).map((lv) => (
          <span key={lv} className="inline-flex items-center gap-1">
            <span className={`inline-block h-3 w-3 rounded-sm ${TONE_CLASSES[RISK_TONE[lv]].soft}`} /> {tr(lv)}
          </span>
        ))}
      </p>
    </div>
  );
}

/** Argentina 2022/23 told as it unfolded: our score by date next to USDA's shrinking estimate. */
function Replay({ replay }: { replay: OriginReplay }) {
  const t = useTranslations("Origins");
  const tr = useTranslations("Risk");
  const l = useLocalized();
  const locale = useAppLocale();
  const date = useDate();
  const top = Math.max(...replay.official.map((e) => e.value));
  return (
    <section aria-labelledby="origins-replay" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <p className="text-sm font-semibold text-field-strong">{t("replayLabel")}</p>
      <h2 id="origins-replay" className="mt-1 text-2xl font-semibold tracking-tight text-balance">
        {l(replay.title)}
      </h2>
      <p className="mt-2 max-w-[65ch]">{l(replay.text)}</p>

      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium text-ink-muted">{t("replayOurs")}</h3>
          <ol className="mt-2 flex flex-col gap-1.5">
            {replay.ours.map((c) => {
              const tone = RISK_TONE[c.level];
              return (
                <li key={c.as_of} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 text-sm">
                  <span className="tabular-nums">{date(c.as_of, true)}</span>
                  <span className="h-3 rounded-full bg-surface-sunken" aria-hidden="true">
                    <span
                      className={`block h-3 rounded-full ${TONE_CLASSES[tone].solid}`}
                      style={{ width: `${Math.max(4, c.score)}%` }}
                    />
                  </span>
                  <span className={`text-right font-semibold tabular-nums ${TONE_CLASSES[tone].text}`}>
                    {Math.round(c.score)}
                    <span className="sr-only"> · {tr(c.level)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <div>
          <h3 className="text-sm font-medium text-ink-muted">{t("replayOfficial")}</h3>
          <ol className="mt-2 flex flex-col gap-1.5">
            {replay.official.map((e) => (
              <li key={e.date ?? "final"} className="grid grid-cols-[5.5rem_1fr_4rem] items-center gap-2 text-sm">
                <span className="tabular-nums">{e.date ? date(e.date, true) : l(e.label)}</span>
                <span className="h-3 rounded-full bg-surface-sunken" aria-hidden="true">
                  <span className="block h-3 rounded-full bg-ink-muted" style={{ width: `${(100 * e.value) / top}%` }} />
                </span>
                <span className="text-right font-semibold tabular-nums">
                  {formatNumber(e.value, locale, 0)} {replay.unit}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
