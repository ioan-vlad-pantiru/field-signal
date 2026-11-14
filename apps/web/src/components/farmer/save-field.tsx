"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AccountError, createField, useAccount } from "@/lib/account";
import type { FieldRequest, LatLon } from "@/lib/contracts";
import { Link } from "@/i18n/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { INPUT } from "@/components/account/account-view";

/**
 * "Save field" on the results page. Signed in: name it and keep it in My fields; a field opened
 * from My fields is already saved (the flow updates it on every run). Signed out: a link to sign in,
 * where the field drawn on this device is offered for the account.
 */
export function SaveField({
  request,
  boundary,
  placeName,
  defaultName = null,
  savedId,
  justUpdated,
  onSaved,
}: {
  request: FieldRequest;
  boundary: LatLon[];
  placeName: string | null;
  /** Suggested name; the place name when not given. */
  defaultName?: string | null;
  savedId: string | null;
  /** The flow updated the saved field with this run's choices. */
  justUpdated: boolean;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("Account.save");
  const errors = useTranslations("Account.errors");
  const account = useAccount();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account.status === "loading" || account.status === "offline") return null;
  if (account.status === "signed-out") {
    return (
      <Link href="/account" className={buttonClass("quiet")}>
        {t("signInToSave")}
      </Link>
    );
  }
  const saved = savedId ? account.fields.find((field) => field.id === savedId) : undefined;
  if (saved) {
    return (
      <Link
        href="/account"
        role="status"
        className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 font-medium text-field hover:bg-surface-sunken"
      >
        <CheckIcon size={18} />
        {justUpdated ? t("updated", { name: saved.name }) : t("saved", { name: saved.name })}
      </Link>
    );
  }
  if (!open) {
    return (
      <Button variant="quiet" onClick={() => setOpen(true)}>
        {t("save")}
      </Button>
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const field = await createField({ name, request, boundary, near: placeName });
      onSaved(field.id);
    } catch (caught) {
      const code = caught instanceof AccountError ? caught.code : "server";
      setError(errors.has(code) ? errors(code) : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex w-full flex-wrap items-end gap-2 py-1 pl-3">
      <div className="flex min-w-48 flex-1 flex-col gap-1.5 sm:max-w-80">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          {t("nameLabel")}
        </label>
        <input
          id={`${id}-name`}
          name="name"
          defaultValue={defaultName ?? placeName ?? ""}
          maxLength={80}
          required
          autoFocus
          className={INPUT}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? t("saving") : t("confirm")}
      </Button>
      <Button variant="quiet" onClick={() => setOpen(false)}>
        {t("cancel")}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-status-bad">
          {error}
        </p>
      ) : null}
    </form>
  );
}
