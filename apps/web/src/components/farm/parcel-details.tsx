"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Parcel } from "@/lib/contracts";
import type { FieldGroup, SoilFlag } from "@/lib/farm";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { Button } from "@/components/ui/button";
import { AlertIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";

/** EUCROPMAP class names we can name in the page language; others are shown as they come. */
const MAPPED_CROPS = new Set([
  "maize",
  "common_wheat",
  "durum_wheat",
  "barley",
  "rye",
  "oats",
  "triticale",
  "other_cereals",
  "potatoes",
  "sugar_beet",
  "sunflower",
  "rapeseed",
  "soybean",
  "dry_pulses",
  "fodder_crops",
  "bare_arable",
  "grassland",
  "woodland_shrubland",
  "artificial",
  "water",
  "wetlands",
  "bare_land",
]);
const LAND_USES = new Set(["TA", "TAn", "PP", "PPn", "PPi", "CP", "CPn"]);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line py-3 first:border-t-0 first:pt-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Everything known about one parcel of the farm, with moving and removing it. */
export function ParcelDetails({
  parcel,
  field,
  fieldColour,
  fields,
  declaredCrop,
  flags,
  onMove,
  onRemove,
  onClose,
}: {
  parcel: Parcel | null;
  field: FieldGroup | null;
  fieldColour: string | null;
  fields: FieldGroup[];
  declaredCrop: string | null;
  flags: SoilFlag[];
  /** Move the parcel to a field id, or "new". Absent before fields exist. */
  onMove?: (to: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("Farm.parcel");
  const locale = useAppLocale();
  const [moveTo, setMoveTo] = useState("new");
  const crop = (name: string | null | undefined) =>
    !name ? t("crops.none") : MAPPED_CROPS.has(name) ? t(`crops.${name}`) : name.replaceAll("_", " ");
  const num = (value: number | null | undefined, digits = 1) =>
    value == null ? "–" : formatNumber(value, locale, digits);

  return (
    <Sheet open={parcel !== null} onClose={onClose} title={parcel ? t("title", { id: parcel.id }) : ""}>
      {parcel ? (
        <div className="flex flex-col gap-5">
          <p className="font-display text-3xl font-semibold tabular-nums">
            {t("area", { ha: num(parcel.area_ha, 2) })}
          </p>

          <dl className="flex flex-col">
            <Row label={t("landUse")}>
              {parcel.land_use && LAND_USES.has(parcel.land_use)
                ? t(`landUses.${parcel.land_use}`)
                : (parcel.land_use ?? t("unknown"))}
            </Row>
            <Row label={t("field")}>
              {field ? (
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded border border-line"
                    style={{ background: fieldColour ?? undefined }}
                  />
                  {field.name}
                </span>
              ) : (
                t("noField")
              )}
            </Row>
            {declaredCrop ? <Row label={t("declared")}>{declaredCrop}</Row> : null}
            <Row label={t("history")}>
              {(parcel.crop_history ?? []).length === 0 ? (
                t("unknown")
              ) : (
                <ul className="flex flex-col gap-1">
                  {(parcel.crop_history ?? []).map((c) => (
                    <li key={c.year} className="tabular-nums">
                      <span className="font-semibold">{c.year}</span> · {crop(c.crop)}
                      {c.crop ? (
                        <span className="text-ink-muted">
                          {" "}
                          · {t("share", { pct: Math.round(c.share * 100) })}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-sm text-ink-muted">{t("historyNote")}</p>
            </Row>
            <Row label={t("soil")}>
              {parcel.soil ? (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                  <li>{t("soc", { value: num(parcel.soil.soc_g_per_kg) })}</li>
                  <li>{t("ph", { value: num(parcel.soil.ph_h2o) })}</li>
                  <li>{t("clay", { value: num(parcel.soil.clay_pct, 0) })}</li>
                  <li>{t("sand", { value: num(parcel.soil.sand_pct, 0) })}</li>
                </ul>
              ) : (
                t("unknown")
              )}
              {flags.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {flags.map((f) => (
                    <li key={f.kind} className="flex items-start gap-2 text-sm">
                      <AlertIcon size={16} className="mt-0.5 shrink-0 text-status-watch" />
                      {t(`flags.${f.kind}`)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-sm text-ink-muted">{t("soilNote")}</p>
            </Row>
          </dl>

          {onMove && fields.length > 0 ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t("moveLabel")}
                <select
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  className="min-h-11 rounded-xl border border-line bg-ground px-3 text-base"
                >
                  <option value="new">{t("moveNew")}</option>
                  {fields
                    .filter((f) => f.id !== field?.id)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </label>
              <Button onClick={() => onMove(moveTo)}>{t("move")}</Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onRemove}>
              {t("remove")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t("close")}
            </Button>
          </div>
          <p className="text-xs text-ink-muted">{t("sources")}</p>
        </div>
      ) : null}
    </Sheet>
  );
}
