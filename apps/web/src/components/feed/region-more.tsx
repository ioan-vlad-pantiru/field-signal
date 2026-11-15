"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { SourcingRegion } from "@/lib/contracts";
import { useLocalized } from "@/lib/localized";
import { BookIcon, ChartIcon } from "@/components/ui/icons";
import { ListGroup, ListRow } from "@/components/ui/list";
import { Sheet } from "@/components/ui/sheet";
import { SourceChip } from "@/components/ui/source-chip";
import { TrackRecord, trackTotals } from "./track-record";

/** Two rows under the communes: the track record and "About this data", each opening a sheet. */
export function RegionMore({ region }: { region: SourcingRegion }) {
  const t = useTranslations("Feed");
  const l = useLocalized();
  const [open, setOpen] = useState<"track" | "about" | null>(null);
  const validation = region.validation && region.validation.years.length > 0 ? region.validation : null;
  const totals = validation ? trackTotals(validation) : null;
  const close = () => setOpen(null);

  return (
    <>
      <ListGroup>
        {validation && totals ? (
          <ListRow
            icon={<ChartIcon size={18} />}
            label={t("track.row")}
            value={<span className="tabular-nums">{t("track.value", totals)}</span>}
            onClick={() => setOpen("track")}
          />
        ) : null}
        <ListRow icon={<BookIcon size={18} />} label={t("about.row")} onClick={() => setOpen("about")} />
      </ListGroup>

      {validation ? (
        <Sheet open={open === "track"} onClose={close} title={t("track.row")} snap>
          <TrackRecord validation={validation} />
        </Sheet>
      ) : null}

      <Sheet open={open === "about"} onClose={close} title={t("about.row")} snap>
        <div className="flex flex-col gap-5">
          {region.caveats.length > 0 ? (
            <section>
              <h3 className="font-semibold">{t("about.caveats")}</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                {region.caveats.map((c, i) => (
                  <li key={i}>{l(c)}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h3 className="font-semibold">{t("about.sources")}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {region.sources.map((s) => (
                <SourceChip key={s.dataset} source={s} />
              ))}
            </div>
          </section>
        </div>
      </Sheet>
    </>
  );
}
