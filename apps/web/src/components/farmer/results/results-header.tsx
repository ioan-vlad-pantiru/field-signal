"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { FieldAnalysis, LatLon } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { fieldAreaHa, fieldCentroid } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { Button, IconButton } from "@/components/ui/button";
import { ArrowLeftIcon, LinkIcon, PrintIcon, ShareIcon } from "@/components/ui/icons";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Sheet } from "@/components/ui/sheet";

/** Place, area and period, with compact actions: change the field, save, share or print. */
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
  /** The "Save" action, when the farmer chose a field. */
  save?: ReactNode;
}) {
  const t = useTranslations("Results");
  const locale = useAppLocale();
  const { location } = analysis;
  const place = placeName || [location.commune, location.county].filter(Boolean).join(", ") || location.label;
  // The field chosen is where the farmer is; the API may answer for a nearby point (or the mock's).
  const point = boundary ? fieldCentroid({ boundary, parts }) : location.point;
  const period = t("period", { start: analysis.period_start, end: analysis.period_end });
  const meta = boundary
    ? t("meta", { area: t("area", { ha: formatNumber(fieldAreaHa({ boundary, parts }), locale, 1) }), period })
    : period;

  const [shareOpen, setShareOpen] = useState(false);
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
    <>
      <ScreenHeader
        title={place}
        meta={meta}
        back={
          <IconButton label={t("back")} onClick={onBack} className="no-print -ml-2">
            <ArrowLeftIcon size={20} />
          </IconButton>
        }
        actions={
          <>
            {save}
            <IconButton label={t("share")} onClick={() => setShareOpen(true)}>
              <ShareIcon size={20} />
            </IconButton>
          </>
        }
      />
      <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title={t("shareTitle")}>
        <div className="flex flex-col gap-2 pb-2">
          <Button variant="secondary" size="lg" className="justify-start" onClick={copyLink}>
            <LinkIcon size={20} />
            {copy === "copied" ? t("linkCopied") : t("copyLink")}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="justify-start"
            onClick={() => {
              setShareOpen(false);
              // Let the sheet close before the print dialog takes over.
              window.setTimeout(() => window.print(), 350);
            }}
          >
            <PrintIcon size={20} />
            {t("print")}
          </Button>
          <p role="status" className="min-h-5 text-sm text-ink-muted">
            {copy === "failed" ? t("copyFailed") : null}
          </p>
        </div>
      </Sheet>
    </>
  );
}
