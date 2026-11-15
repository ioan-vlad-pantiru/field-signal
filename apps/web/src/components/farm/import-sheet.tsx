"use client";

import { useRef, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatNumber } from "@/lib/format";
import { useAppLocale } from "@/lib/localized";
import { Button, buttonClass } from "@/components/ui/button";
import { UploadIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import type { FarmModel } from "./use-farm";

const SAMPLES = [
  { key: "big", file: "/samples/ferma-mare-agi-online-demo.zip" },
  { key: "small", file: "/samples/ferma-mica-agi-online-demo.zip" },
] as const;
const IMPORT_ERRORS = ["unsupported_file", "no_outlines", "unreadable_file", "file_too_large", "offline"];

/**
 * The farm's file and name: import (AGI Online zip, shapefile, GeoJSON, KML) or a demo export,
 * the result in one line, then the farm name with Save, the APIA rematch and Start again.
 */
export function ImportSheet({ open, onClose, farm }: { open: boolean; onClose: () => void; farm: FarmModel }) {
  const t = useTranslations("Farm");
  const locale = useAppLocale();
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = farm.importing.status === "busy";
  const ha = (value: number) => formatNumber(value, locale, 1);
  const { importing, rematch, saving } = farm;

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await farm.importFile(file, file.name);
  }

  const result =
    importing.status === "done"
      ? t("import.done", { count: importing.added, ha: ha(importing.ha) }) +
        (importing.unmatched ? " " + t("import.unmatched", { count: importing.unmatched }) : "")
      : importing.status === "error"
        ? t(`import.error.${IMPORT_ERRORS.includes(importing.code) ? importing.code : "server"}`)
        : "";

  return (
    <Sheet open={open} onClose={onClose} title={t("import.title")} subtitle={t("import.formats")} snap>
      <div className="flex flex-col gap-5 pb-2">
        <section className="flex flex-col gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.geojson,.json,.kml"
            onChange={onFile}
            className="sr-only"
            aria-label={t("import.button")}
            tabIndex={-1}
          />
          <Button size="lg" onClick={() => fileInput.current?.click()} disabled={busy}>
            <UploadIcon size={20} />
            {busy ? t("import.busy") : t("import.button")}
          </Button>
          <div role="group" aria-labelledby="farm-samples" className="flex flex-col gap-2">
            <span id="farm-samples" className="text-sm text-ink-muted">
              {t("import.samples")}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {SAMPLES.map((s) => (
                <Button key={s.key} variant="tonal" onClick={() => farm.importSample(s.file)} disabled={busy}>
                  {t(`import.sample.${s.key}`)}
                </Button>
              ))}
            </div>
          </div>
          <p
            aria-live="polite"
            className={`text-sm ${importing.status === "error" ? "text-status-bad" : ""} ${result ? "" : "sr-only"}`}
          >
            {result}
          </p>
        </section>

        <section className="flex flex-col gap-2 border-t border-line pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-ink-muted">{t("nameLabel")}</span>
            <input
              value={farm.name}
              onChange={(e) => farm.setName(e.target.value)}
              placeholder={t("defaultName")}
              className="min-h-tap rounded-[var(--radius-sm)] bg-surface-sunken px-3 text-base"
            />
          </label>
          {farm.signedIn ? (
            <Button
              variant="secondary"
              onClick={farm.save}
              disabled={farm.parcels.length === 0 || saving === "busy"}
              className="w-full"
            >
              {saving === "busy" ? t("save.busy") : saving === "saved" ? t("save.done") : t("save.button")}
            </Button>
          ) : (
            <Link href="/more/account" className={buttonClass("secondary", "md", "w-full")}>
              {t("save.signIn")}
            </Link>
          )}
          {saving === "error" ? (
            <p role="alert" className="text-sm text-status-bad">
              {t("save.error")}
            </p>
          ) : null}
        </section>

        {farm.parcels.length > 0 ? (
          <section className="flex flex-col items-start gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={farm.updateParcels} disabled={rematch.status === "busy"}>
              {rematch.status === "busy" ? t("rematch.busy") : t("rematch.button")}
            </Button>
            <p aria-live="polite" className={`text-sm ${rematch.status === "error" ? "text-status-bad" : ""}`}>
              {rematch.status === "done"
                ? rematch.changed === 0 && rematch.missing === 0
                  ? t("rematch.same")
                  : t("rematch.done", { changed: rematch.changed, missing: rematch.missing })
                : rematch.status === "error"
                  ? t("rematch.error")
                  : ""}
            </p>
            <Button variant="quiet" onClick={farm.clear} className="-ml-3 text-status-bad">
              {t("clear")}
            </Button>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
