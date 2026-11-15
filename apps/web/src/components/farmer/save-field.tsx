"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AccountError, createField, useAccount } from "@/lib/account";
import type { FieldRequest, LatLon } from "@/lib/contracts";
import { Link } from "@/i18n/navigation";
import { Button, IconButton } from "@/components/ui/button";
import { BookmarkIcon } from "@/components/ui/icons";
import { INPUT_CLASS } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";

/**
 * "Save" in the results header: a bookmark that opens a short sheet to name the field and keep it
 * in My fields. Filled once saved (a field opened from My fields is saved already, and the flow
 * updates it on every run). Signed out, the sheet offers to sign in.
 */
export function SaveField({
  request,
  boundary,
  parts = [],
  placeName,
  defaultName = null,
  savedId,
  justUpdated,
  onSaved,
}: {
  request: FieldRequest;
  boundary: LatLon[];
  parts?: LatLon[][];
  placeName: string | null;
  /** Suggested name; the place name when not given. */
  defaultName?: string | null;
  savedId: string | null;
  /** The flow updated the saved field with this run's choices. */
  justUpdated: boolean;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("Results.save");
  const errors = useTranslations("Account.errors");
  const account = useAccount();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account.status === "loading" || account.status === "offline") return null;
  const saved = account.status === "signed-in" && savedId ? account.fields.find((f) => f.id === savedId) : undefined;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const field = await createField({ name, request, boundary, parts, near: placeName });
      onSaved(field.id);
      setOpen(false);
    } catch (caught) {
      const code = caught instanceof AccountError ? caught.code : "server";
      setError(errors.has(code) ? errors(code) : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <IconButton
        label={saved ? (justUpdated ? t("updated", { name: saved.name }) : t("saved", { name: saved.name })) : t("save")}
        variant={saved ? "active" : "plain"}
        onClick={() => setOpen(true)}
      >
        <BookmarkIcon size={20} fill={saved ? "currentColor" : "none"} />
      </IconButton>
      <Sheet open={open} onClose={() => setOpen(false)} title={saved ? saved.name : t("title")}>
        {saved ? (
          <div className="flex flex-col gap-3 pb-2">
            <p>{justUpdated ? t("updated", { name: saved.name }) : t("saved", { name: saved.name })}</p>
            <Link href="/field" className="font-semibold text-field underline-offset-4 hover:underline">
              {t("toFields")}
            </Link>
          </div>
        ) : account.status === "signed-out" ? (
          <div className="flex flex-col gap-3 pb-2">
            <p>{t("signInWhy")}</p>
            <Link href="/more/account" className="press inline-flex min-h-tap items-center justify-center rounded-pill bg-field px-4 font-semibold text-on-field">
              {t("signIn")}
            </Link>
          </div>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3 pb-2">
            <label htmlFor={`${id}-name`} className="text-sm font-semibold text-ink-muted">
              {t("nameLabel")}
            </label>
            <input id={`${id}-name`} name="name" defaultValue={defaultName ?? placeName ?? ""} maxLength={80} required className={INPUT_CLASS} />
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? t("saving") : t("confirm")}
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-status-bad">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </Sheet>
    </>
  );
}
