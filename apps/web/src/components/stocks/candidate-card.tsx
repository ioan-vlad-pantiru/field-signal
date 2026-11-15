"use client";

import { useTranslations } from "next-intl";
import { formatNumber, mean } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { WEIGHTS, type Candidate } from "@/lib/stocks";
import { RangeBar, ScoreBar, Sparkline } from "@/components/ui/charts";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";

const SCORE_KEYS = ["coverage", "reliability", "logistics", "friction"] as const;

/** One supplier country: total score, its four parts, volume range, history, route, pros and cons. */
export function CandidateCard({
  candidate: c,
  rank,
  domain,
}: {
  candidate: Candidate;
  rank: number;
  domain: [number, number];
}) {
  const t = useTranslations("Stocks");
  const locale = useAppLocale();
  const l = useLocalized();
  const num = (value: number) => formatNumber(value, locale, 0);
  const v = c.forecast.volume_t;
  const history = c.forecast.history;
  const volumes = { low: num(v.low), mid: num(v.mid), high: num(v.high) };

  return (
    <li className="flex flex-col gap-4 rounded-[var(--radius-lg)] bg-surface p-4 ring-1 ring-line">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-muted">{t("rank", { rank })}</p>
          <h4 className="text-lg font-semibold leading-snug">{l(c.facts.name)}</h4>
          <p className="text-sm text-ink-muted">
            {t("route", { route: l(c.facts.route), days: t("days", { days: c.facts.lead_days }) })}
          </p>
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-sm text-ink-muted">{t("score")}</span>
          <span className="font-display text-3xl font-semibold tabular-nums" aria-hidden="true">
            {c.scores.total}
          </span>
          <span className="sr-only">{t("scoreOutOf", { score: c.scores.total })}</span>
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {SCORE_KEYS.map((key, i) => (
          <li key={key}>
            <div className="flex justify-between gap-2 text-sm">
              <span>{t("scoreLine", { label: t(`scores.${key}`), weight: Math.round(WEIGHTS[key] * 100) })}</span>
              <span className="font-semibold tabular-nums">{Math.round(c.scores[key])}</span>
            </div>
            <ScoreBar value={c.scores[key]} index={i} />
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">{t("volume")}</p>
        <RangeBar range={v} domain={domain} label={t("volumeLabel", volumes)} />
        <p className="text-sm tabular-nums text-ink-muted">{t("volumeText", volumes)}</p>
      </div>

      {history.length > 0 ? (
        <div>
          <Sparkline
            series={history}
            baseline={mean(history.map((p) => p.value))}
            label={t("historyLabel", {
              list: history.map((p) => `${p.year}: ${p.value === null ? "–" : num(p.value)} t`).join(", "),
            })}
          />
          <p className="text-xs text-ink-muted">
            {t("history", { first: history[0].year, last: history[history.length - 1].year })}
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Reasons title={t("pros")} items={c.pros.map(l)} good />
        <Reasons title={t("cons")} items={c.cons.map(l)} />
      </div>
    </li>
  );
}

function Reasons({ title, items, good = false }: { title: string; items: string[]; good?: boolean }) {
  if (items.length === 0) return null;
  const Icon = good ? CheckIcon : AlertIcon;
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5">
            <Icon size={16} className={`mt-0.5 shrink-0 ${good ? "text-status-good" : "text-status-watch"}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
