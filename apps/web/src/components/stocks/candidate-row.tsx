"use client";

import { useTranslations } from "next-intl";
import { formatNumber, mean } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import type { Candidate } from "@/lib/stocks";
import { RangeBar, Sparkline } from "@/components/ui/charts";
import { AlertIcon, CheckIcon, ChevronRightIcon } from "@/components/ui/icons";

const SCORE_KEYS = ["coverage", "reliability", "logistics", "friction"] as const;

/** One supplier country: rank, route, score and its four parts; volume, history and reasons behind "Details". */
export function CandidateRow({
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
    <li className="py-4">
      <div className="flex items-start gap-3">
        <span className="w-5 shrink-0 pt-0.5 text-sm font-semibold text-ink-muted tabular-nums">{rank}</span>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold leading-snug">{l(c.facts.name)}</h4>
          <p className="text-sm text-ink-muted">
            {t("route", { route: l(c.facts.route), days: t("days", { days: c.facts.lead_days }) })}
          </p>
        </div>
        <p className="shrink-0 text-right text-xs text-ink-muted tabular-nums">
          {t.rich("scoreOutOf", {
            score: c.scores.total,
            b: (chunks) => <b className="block text-2xl font-semibold leading-none tracking-[-0.02em] text-ink">{chunks}</b>,
          })}
        </p>
      </div>

      <dl className="mt-3 ml-8 grid grid-cols-2 gap-x-5 gap-y-2.5">
        {SCORE_KEYS.map((key) => (
          <div key={key}>
            <div className="flex justify-between gap-2 text-xs text-ink-muted">
              <dt>{t(`scores.${key}`)}</dt>
              <dd className="tabular-nums">{Math.round(c.scores[key])}</dd>
            </div>
            <span aria-hidden="true" className="relative mt-1 block h-1 rounded-full bg-surface-sunken">
              <span className="absolute inset-y-0 left-0 rounded-full bg-ink-muted" style={{ width: `${c.scores[key]}%` }} />
            </span>
          </div>
        ))}
      </dl>

      <details className="group mt-3 ml-8">
        <summary className="press inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
          {t("details")}
          <ChevronRightIcon size={14} className="transition-transform group-open:rotate-90" />
        </summary>
        <div className="mt-3 flex flex-col gap-4">
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
        </div>
      </details>
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
            <Icon size={16} className="mt-0.5 shrink-0 text-ink-muted" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
