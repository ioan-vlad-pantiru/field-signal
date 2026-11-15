"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FIELD_COLOURS, fieldParcels, type SoilFlag } from "@/lib/farm";
import { Button } from "@/components/ui/button";
import { AlertIcon } from "@/components/ui/icons";
import { ListGroup, ListRow } from "@/components/ui/list";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { FieldCard } from "./field-card";
import type { FarmModel } from "./use-farm";

/**
 * Step 2 under the map: the suggested fields as cards, a row for the soil notes (opens a sheet),
 * and "Group again". Moving parcels happens on the map; see the selection bar.
 */
export function FieldsPanel({ farm, onShow }: { farm: FarmModel; onShow: (ids: number[]) => void }) {
  const t = useTranslations("Farm");
  const [soilOpen, setSoilOpen] = useState(false);
  const flagGroups = useMemo(() => {
    const out = new Map<SoilFlag["kind"], number[]>();
    farm.flags.forEach((f) => out.set(f.kind, [...(out.get(f.kind) ?? []), f.parcelId]));
    return [...out.entries()];
  }, [farm.flags]);
  const flaggedParcels = new Set(farm.flags.map((f) => f.parcelId)).size;

  return (
    <section aria-labelledby="farm-fields" className="flex min-w-0 flex-col gap-3" aria-busy={farm.suggesting === "busy"}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="farm-fields" className="text-lg font-semibold">
          {t("fields.title")}
        </h2>
        {farm.suggesting === "idle" && farm.fields.length > 0 ? (
          <Button variant="quiet" onClick={() => void farm.suggest()} className="-mr-3 shrink-0 whitespace-nowrap">
            {t("fields.again")}
          </Button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {farm.suggesting === "busy" ? t("fields.busy") : t("fieldsCount", { count: farm.fields.length })}
      </p>

      {farm.suggesting === "busy" ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : farm.suggesting === "error" ? (
        <ErrorState onRetry={() => void farm.suggest()}>{t("fields.error")}</ErrorState>
      ) : (
        <ul className="flex flex-col gap-2">
          {farm.fields.map((f, i) => (
            <FieldCard
              key={f.id}
              field={f}
              parcels={fieldParcels(f, farm.byId)}
              colour={FIELD_COLOURS[i % FIELD_COLOURS.length]}
              reason={farm.reasons[f.id]}
              onRename={(name) => farm.renameField(f.id, name)}
              onShow={() => onShow(f.parcel_ids)}
            />
          ))}
        </ul>
      )}

      {flagGroups.length > 0 ? (
        <ListGroup>
          <ListRow
            icon={<AlertIcon size={18} />}
            label={t("soil.row", { count: flaggedParcels })}
            onClick={() => setSoilOpen(true)}
          />
        </ListGroup>
      ) : null}

      <Sheet open={soilOpen} onClose={() => setSoilOpen(false)} title={t("soil.title")} subtitle={t("soil.note")}>
        <ul className="flex flex-col divide-y divide-line">
          {flagGroups.map(([kind, ids]) => (
            <li key={kind} className="flex items-start justify-between gap-3 py-3 first:pt-0">
              <span className="flex items-start gap-2">
                <AlertIcon size={18} className="mt-0.5 shrink-0 text-status-watch" />
                {t(`soil.${kind}`, { count: ids.length })}
              </span>
              <Button
                variant="tonal"
                onClick={() => {
                  setSoilOpen(false);
                  onShow(ids);
                }}
                className="shrink-0"
              >
                {t("soil.show")}
              </Button>
            </li>
          ))}
        </ul>
      </Sheet>
    </section>
  );
}
