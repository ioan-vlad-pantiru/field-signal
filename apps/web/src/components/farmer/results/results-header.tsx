"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { FieldAnalysis, LatLon } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { polygonAreaHa } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "@/components/ui/icons";

/** Place, area and period, with the page's three actions. */
export function ResultsHeader({
  analysis,
  boundary,
  onBack,
}: {
  analysis: FieldAnalysis;
  boundary: LatLon[] | null;
  onBack: () => void;
}) {
  const t = useTranslations("Results");
  const locale = useAppLocale();
  const { location } = analysis;
  const place = [location.commune, location.county].filter(Boolean).join(", ") || location.label;
  const period = t("period", { start: analysis.period_start, end: analysis.period_end });
  const meta = boundary
    ? t("meta", { area: t("area", { ha: formatNumber(polygonAreaHa(boundary), locale, 1) }), period })
    : t("metaNoArea", { period });

  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (copy === "idle") return;
    const id = window.setTimeout(() => setCopy("idle"), 3000);
    return () => window.clearTimeout(id);
  }, [copy]);

  async function copyLink() {
    // The flow opens at a place from ?lat=&lon=&place=, so the link brings a colleague to this spot.
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("lat", location.point.lat.toFixed(5));
    url.searchParams.set("lon", location.point.lon.toFixed(5));
    url.searchParams.set("place", place);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{place}</h1>
        <p className="tabular-nums text-ink-muted">{meta}</p>
      </div>
      <div role="group" aria-label={t("actions")} className="no-print -ml-3 flex flex-wrap items-center gap-1">
        <Button variant="quiet" onClick={onBack}>
          <ArrowLeftIcon size={18} />
          {t("back")}
        </Button>
        <Button variant="quiet" onClick={() => window.print()}>
          {t("print")}
        </Button>
        <Button variant="quiet" onClick={copyLink}>
          {t("copyLink")}
        </Button>
        <span role="status" className="text-sm text-ink-muted">
          {copy === "copied" ? t("linkCopied") : copy === "failed" ? t("copyFailed") : null}
        </span>
      </div>
    </header>
  );
}
