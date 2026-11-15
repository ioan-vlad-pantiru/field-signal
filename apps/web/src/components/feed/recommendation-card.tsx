"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SourcingRecommendation } from "@/lib/contracts";
import { useLocalized } from "@/lib/localized";
import { ConfidenceBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";

/** The demo chip already says the data are made up, so the "[MOCK]" tag in mock text is noise here. */
function withoutMockTag(text: string) {
  return text.replace(/^\[MOCK\]\s*/, "");
}

/** The answer first: title, one line and confidence. The actions and assumptions are one tap away. */
export function RecommendationCard({ recommendation }: { recommendation: SourcingRecommendation }) {
  const t = useTranslations("Feed.advice");
  const l = useLocalized();
  const [open, setOpen] = useState(false);
  const title = l(recommendation.title);
  const text = withoutMockTag(l(recommendation.text));
  const hasMore = recommendation.actions.length > 0 || recommendation.assumptions.length > 0;

  return (
    <section
      aria-labelledby="feed-advice"
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-field-soft p-4 shadow-1 sm:p-5"
    >
      <h2 id="feed-advice" className="text-xl font-semibold leading-snug text-balance">
        {title}
      </h2>
      <p className="line-clamp-2 text-ink-muted">{text}</p>
      <div className="flex items-center justify-between gap-2">
        <ConfidenceBadge confidence={recommendation.confidence} />
        {hasMore ? (
          <Button variant="quiet" aria-haspopup="dialog" onClick={() => setOpen(true)} className="-mr-2 shrink-0 px-3">
            {t("open")}
            <ChevronRightIcon size={18} />
          </Button>
        ) : null}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={title} snap>
        <div className="flex flex-col gap-5">
          <p>{text}</p>
          {recommendation.actions.length > 0 ? (
            <section>
              <h3 className="font-semibold">{t("actions")}</h3>
              <ol className="mt-2 flex flex-col">
                {recommendation.actions.map((a, i) => (
                  <li key={i} className="flex gap-3 border-t border-line py-2 first:border-t-0">
                    <span aria-hidden="true" className="w-5 shrink-0 font-semibold tabular-nums text-field-strong">
                      {i + 1}
                    </span>
                    {l(a)}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {recommendation.assumptions.length > 0 ? (
            <section>
              <h3 className="font-semibold">{t("assumptions")}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
                {recommendation.assumptions.map((a, i) => (
                  <li key={i}>{l(a)}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <ConfidenceBadge confidence={recommendation.confidence} />
        </div>
      </Sheet>
    </section>
  );
}
