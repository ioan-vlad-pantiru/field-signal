"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { FieldAnalysis, LatLon } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { fieldAreaHa, fieldCentroid } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "@/components/ui/icons";

/** Place, area and period, with the page's three actions. */
export function ResultsHeader({
  analysis,
  boundary,
  parts = [],
  placeName,
  onBack,
  save,
}: {
  analysis: FieldAnalysis;
  boundary: LatLon[] | null;
  parts?: LatLon[][];
  placeName: string | null;
  onBack: () => void;
  /** "Save field" control, when the farmer drew a field. */
  save?: ReactNode;
}) {
  const t = useTranslations("Results");
  const locale = useAppLocale();
  const { location } = analysis;
  const place = placeName || [location.commune, location.county].filter(Boolean).join(", ") || location.label;
  // The drawn field is where the farmer is; the API may answer for a nearby point (or the mock's).
  const point = boundary ? fieldCentroid({ boundary, parts }) : location.point;
  const period = t("period", { start: analysis.period_start, end: analysis.period_end });
  const meta = boundary
    ? t("meta", { area: t("area", { ha: formatNumber(fieldAreaHa({ boundary, parts }), locale, 1) }), period })
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
    url.searchParams.set("lat", point.lat.toFixed(5));
    url.searchParams.set("lon", point.lon.toFixed(5));
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
        {save}
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
