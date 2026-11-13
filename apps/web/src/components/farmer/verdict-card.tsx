"use client";

import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { useAppLocale, useLocalized } from "@/lib/localized";
import { useCountUp } from "@/lib/use-count-up";
import { CropSequence } from "@/components/ui/crop-chip";

/** The answer first: which rotation fits the farmer's priorities best, against today's. */
export function VerdictCard({ strategies }: { strategies: Strategy[] }) {
  const t = useTranslations("Results.verdict");
  const locale = useAppLocale();
  const l = useLocalized();
  const best = strategies.reduce((a, b) => (b.score.total > a.score.total ? b : a));
  const current = strategies.find((s) => s.is_current) ?? best;
  const delta = Math.round(best.score.total - current.score.total);
  const shown = useCountUp(best.score.total);
  const n = (v: number) => formatNumber(v, locale, 0);

  return (
    <section className="rise relative overflow-hidden rounded-[28px] bg-field p-5 text-on-field shadow-2">
      <svg
        aria-hidden="true"
        viewBox="0 0 200 200"
        className="pointer-events-none absolute -bottom-16 -right-12 h-56 w-56 opacity-15"
      >
        <g fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round">
          <path d="M60 140a60 60 0 0180 0" />
          <path d="M30 110a100 100 0 01140 0" />
          <path d="M0 80a140 140 0 01200 0" />
        </g>
      </svg>
      <p className="font-medium opacity-90">{best.is_current ? t("keepTitle") : t("title")}</p>
      <h2 className="mt-1 text-3xl font-bold tracking-tight">{l(best.name)}</h2>
      <div className="mt-3 rounded-2xl bg-surface p-2 text-ink">
        <CropSequence sequence={best.sequence} />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <p>
          <span className="font-mono text-5xl font-semibold tracking-tight tabular-nums">{n(shown)}</span>
          <span className="opacity-80">/100</span>
        </p>
        {delta > 0 ? (
          <p className="mb-1 rounded-full bg-wheat px-3 py-1 font-semibold text-on-wheat">
            {t("delta", { delta })}
          </p>
        ) : null}
      </div>
      {!best.is_current ? (
        <p className="mt-2 opacity-90">{t("versus", { current: n(current.score.total) })}</p>
      ) : null}
      <a
        href="#replay"
        className="press mt-4 inline-flex min-h-11 items-center rounded-full border-2 border-on-field/40 px-4 font-semibold hover:bg-on-field/10"
      >
        {t("seeYears")}
      </a>
    </section>
  );
}
