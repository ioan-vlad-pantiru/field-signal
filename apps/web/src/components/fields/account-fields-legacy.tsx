"use client";

/**
 * The saved-field pieces from the old account page, kept unchanged for the My fields Start screen.
 * Only the `Account.fields.*` copy is used here.
 */

import dynamic from "next/dynamic";
import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { createField, deleteField, fieldInput, updateField } from "@/lib/account";
import type { SavedField } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
import { fieldAreaHa, fieldRings } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { Link } from "@/i18n/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { forgetField, useSavedField } from "@/components/farmer/steps/saved-field";
import { INPUT, useErrorText } from "@/components/account/shared";

/** The map of every saved field (maplibre, loaded on the client only). */
export const FieldsMap = dynamic(() => import("./fields-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full rounded-2xl sm:h-80" />,
});

/** The field drawn before signing in (kept in this browser), offered once for the account. */
export function DeviceFieldImport() {
  const t = useTranslations("Account.fields");
  const locale = useAppLocale();
  const errorText = useErrorText();
  const local = useSavedField();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!local) return null;
  const ha = formatNumber(fieldAreaHa(local), locale, 0);

  async function add() {
    if (!local) return;
    setBusy(true);
    setError(null);
    try {
      await createField({
        name: local.near ?? t("area", { ha }),
        request: local.request,
        boundary: local.boundary,
        near: local.near,
      });
      forgetField();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-sunken p-4">
      <div>
        <p className="font-semibold">{t("importTitle")}</p>
        <p className="text-ink-muted">
          {local.near ? t("importText", { place: local.near, ha }) : t("importTextNoPlace", { ha })}
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-sm text-status-bad">
            {error}
          </p>
        ) : null}
      </div>
      <Button variant="secondary" disabled={busy} onClick={add}>
        {t("import")}
      </Button>
    </div>
  );
}

export function RotationDots({ field }: { field: SavedField }) {
  const crops = useTranslations("Crops");
  const names = field.request.current_rotation.map((crop) => crops(crop));
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex gap-0.5" aria-hidden="true">
        {field.request.current_rotation.map((crop, i) => (
          <span key={i} className="size-2.5 rounded-full" style={{ background: CROP_COLORS[crop] }} />
        ))}
      </span>
      <span>{names.join(" → ")}</span>
    </span>
  );
}

/** The field's outline, drawn to fit a small square, north up. */
export function FieldShape({ field }: { field: SavedField }) {
  const lat0 = field.boundary[0].lat;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const rings = fieldRings(field).map((ring) => ring.map((p) => [p.lon * k, -p.lat] as const));
  const pts = rings.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const offX = (span - (Math.max(...xs) - minX)) / 2;
  const offY = (span - (Math.max(...ys) - minY)) / 2;
  const d = rings
    .map(
      (ring) =>
        ring
          .map(([x, y], i) => `${i ? "L" : "M"}${(6 + ((x - minX + offX) / span) * 52).toFixed(1)} ${(6 + ((y - minY + offY) / span) * 52).toFixed(1)}`)
          .join(" ") + "Z",
    )
    .join(" ");
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="size-16 shrink-0 rounded-xl bg-surface-sunken">
      <path d={d} className="fill-field-tint stroke-field" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function FieldRow({
  field,
  areaHa,
  checked,
  disabled,
  focused,
  onToggle,
}: {
  field: SavedField;
  areaHa: number;
  checked: boolean;
  disabled: boolean;
  focused: boolean;
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("Account.fields");
  const locale = useAppLocale();
  const errorText = useErrorText();
  const id = useId();
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ha = formatNumber(areaHa, locale, 1);
  const updated = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(field.updated_at),
  );

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode("view");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name || name === field.name) return setMode("view");
    void act(() => updateField(field.id, { ...fieldInput(field), name }));
  }

  return (
    <li
      id={`field-${field.id}`}
      className={`scroll-mt-24 py-4 transition-colors duration-[var(--duration-slow)] ${focused ? "bg-field-tint/50" : ""}`}
    >
      <div className="flex gap-3 sm:gap-4">
        <input
          id={`${id}-pick`}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(field.id)}
          aria-label={t("selectField", { name: field.name })}
          className="mt-5 size-5 shrink-0 accent-[var(--field)] disabled:opacity-40"
        />
        <label htmlFor={`${id}-pick`} className="cursor-pointer">
          <FieldShape field={field} />
        </label>

        <div className="min-w-0 flex-1">
          {mode === "rename" ? (
            <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <label htmlFor={`${id}-name`} className="text-sm font-medium">
                  {t("renameLabel")}
                </label>
                <input
                  id={`${id}-name`}
                  name="name"
                  defaultValue={field.name}
                  maxLength={80}
                  required
                  autoFocus
                  className={INPUT}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {t("save")}
              </Button>
              <Button variant="quiet" onClick={() => setMode("view")}>
                {t("cancel")}
              </Button>
            </form>
          ) : (
            <>
              <p className="break-words text-lg font-semibold leading-snug">{field.name}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-ink-muted">
                <span className="tabular-nums">{t("area", { ha })}</span>
                {field.near && field.near !== field.name ? <span>· {t("near", { place: field.near })}</span> : null}
                {field.request.irrigated ? <span>· {t("irrigated")}</span> : null}
              </p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-muted">
                <RotationDots field={field} />
                <span>{t("updated", { date: updated })}</span>
              </p>
            </>
          )}

          {mode === "view" ? (
            <div className="-ml-3 mt-2 flex flex-wrap items-center gap-1">
              <Link
                href={{ pathname: "/field", query: { saved: field.id, run: "1" } }}
                className={buttonClass("secondary")}
              >
                {t("analyse")}
              </Link>
              <Link href={{ pathname: "/field", query: { saved: field.id, edit: "1" } }} className={buttonClass("quiet")}>
                {t("edit")}
              </Link>
              <Button variant="quiet" onClick={() => setMode("rename")}>
                {t("rename")}
              </Button>
              <Button variant="quiet" className="text-ink-muted" onClick={() => setMode("delete")}>
                {t("delete")}
              </Button>
            </div>
          ) : mode === "delete" ? (
            <div
              role="group"
              aria-label={t("confirmDelete", { name: field.name })}
              className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-status-bad-tint p-3"
            >
              <span className="mr-auto font-medium">{t("confirmDelete", { name: field.name })}</span>
              <button
                type="button"
                disabled={busy}
                className="press inline-flex min-h-11 items-center rounded-xl bg-status-bad px-4 font-medium text-on-status disabled:opacity-40"
                onClick={() => act(() => deleteField(field.id))}
              >
                {t("confirmDeleteYes")}
              </button>
              <Button variant="quiet" onClick={() => setMode("view")}>
                {t("cancel")}
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-sm text-status-bad">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
