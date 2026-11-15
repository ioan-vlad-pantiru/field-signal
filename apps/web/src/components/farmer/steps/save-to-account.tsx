"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AccountError, createField, updateField, useAccount, type FieldDraft } from "@/lib/account";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { INPUT_CLASS } from "@/components/ui/input";

/**
 * Name the field being drawn and keep it in My fields, without running the analysis first.
 * Once saved, the same button stores later changes (shape, rotation, name) to that entry.
 */
export function SaveToAccount({
  name,
  onName,
  accountId,
  onSaved,
  fallbackName,
  draft,
}: {
  name: string;
  onName: (name: string) => void;
  /** My fields id when the field is already saved. */
  accountId: string | null;
  onSaved: (id: string, name: string) => void;
  /** Used when the name is left empty, such as the commune name. */
  fallbackName: string | null;
  /** What would be saved now, without the name. */
  draft: Omit<FieldDraft, "name">;
}) {
  const t = useTranslations("Field.save");
  const errors = useTranslations("Account.errors");
  const account = useAccount();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The name and data last stored, to tell whether there is anything new to save. */
  const snapshot = JSON.stringify({ name: name.trim() || fallbackName, ...draft });
  // A field opened from My fields starts out as saved.
  const [stored, setStored] = useState<string | null>(() => (accountId ? snapshot : null));

  const signedIn = account.status === "signed-in";
  const saved = signedIn && accountId != null && account.fields.some((f) => f.id === accountId);
  const upToDate = saved && stored === snapshot;

  async function save() {
    const trimmed = name.trim() || fallbackName?.trim() || "";
    if (!trimmed) {
      setError(t("nameNeeded"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = { ...draft, name: trimmed };
      const field = saved && accountId ? await updateField(accountId, body) : await createField(body);
      setStored(snapshot);
      onSaved(field.id, trimmed);
    } catch (caught) {
      const code = caught instanceof AccountError ? caught.code : "server";
      setError(errors.has(code) ? errors(code) : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-name`} className="text-sm font-semibold text-ink-muted">
        {t("nameLabel")}
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-name`}
          value={name}
          onChange={(e) => {
            onName(e.target.value);
            setError(null);
          }}
          maxLength={80}
          placeholder={fallbackName ?? t("namePlaceholder")}
          autoComplete="off"
          className={INPUT_CLASS}
        />
        {signedIn ? (
          <Button variant={upToDate ? "quiet" : "secondary"} onClick={save} disabled={busy || upToDate} className="shrink-0">
            {upToDate ? <CheckIcon size={18} /> : null}
            {busy ? t("saving") : upToDate ? t("saved") : saved ? t("update") : t("save")}
          </Button>
        ) : null}
      </div>
      {account.status === "signed-out" ? (
        <Link href="/more/account" className="w-fit text-sm font-semibold text-field underline-offset-4 hover:underline">
          {t("signIn")}
        </Link>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-status-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
