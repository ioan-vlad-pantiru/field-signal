"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  AccountError,
  createField,
  deleteField,
  fieldInput,
  reloadAccount,
  signIn,
  signOut,
  signUp,
  updateField,
  useAccount,
} from "@/lib/account";
import type { Account, SavedField } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { formatNumber } from "@/lib/format";
import { polygonAreaHa } from "@/lib/geo";
import { useAppLocale } from "@/lib/localized";
import { Link } from "@/i18n/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import { NoticeBar } from "@/components/ui/notice-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { forgetField, useSavedField } from "@/components/farmer/steps/saved-field";

export const INPUT =
  "min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base outline-offset-2 placeholder:text-ink-muted focus-visible:outline-3 focus-visible:outline-[var(--focus)]";

/** Translates an API error code, falling back to the generic one. */
function useErrorText() {
  const t = useTranslations("Account.errors");
  return (error: unknown) => {
    const code = error instanceof AccountError ? error.code : "server";
    return t.has(code) ? t(code) : t("server");
  };
}

export function AccountView() {
  const t = useTranslations("Account");
  const account = useAccount();

  return (
    <div className="max-w-[720px]">
      <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
      {account.status === "loading" ? (
        <div className="mt-6 flex flex-col gap-3" aria-busy="true" aria-label={t("loading")}>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : account.status === "offline" ? (
        <div className="mt-6 flex flex-col items-start gap-3">
          <NoticeBar>{t("offline")}</NoticeBar>
          <Button variant="secondary" onClick={reloadAccount}>
            {t("retry")}
          </Button>
        </div>
      ) : account.status === "signed-out" ? (
        <>
          <p className="mt-3 text-lg text-ink-muted">{t("intro")}</p>
          <AuthForm />
        </>
      ) : (
        <SignedIn account={account.account} fields={account.fields} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- sign in / sign up

function AuthForm() {
  const t = useTranslations("Account");
  const errorText = useErrorText();
  const id = useId();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    setBusy(true);
    setError(null);
    try {
      if (mode === "in") await signIn({ email, password });
      else await signUp({ email, password, name: String(data.get("name") ?? "") || null });
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  const tabs = [
    { value: "in", label: t("signInTab") },
    { value: "up", label: t("signUpTab") },
  ] as const;

  return (
    <section className="mt-8 max-w-[440px]" aria-labelledby={`${id}-title`}>
      <div role="tablist" aria-label={t("title")} className="flex gap-1 border-b border-line">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={mode === tab.value}
            onClick={() => {
              setMode(tab.value);
              setError(null);
            }}
            className={`press -mb-px min-h-11 border-b-2 px-3 font-medium ${
              mode === tab.value ? "border-field text-field" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <h2 id={`${id}-title`} className="sr-only">
        {mode === "in" ? t("signInTitle") : t("signUpTitle")}
      </h2>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        {mode === "up" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-name`} className="font-medium">
              {t("name")}
            </label>
            <input id={`${id}-name`} name="name" autoComplete="name" maxLength={80} className={INPUT} />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-email`} className="font-medium">
            {t("email")}
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            className={INPUT}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-password`} className="font-medium">
            {t("password")}
          </label>
          <input
            id={`${id}-password`}
            name="password"
            type="password"
            required
            minLength={mode === "up" ? 8 : 1}
            autoComplete={mode === "up" ? "new-password" : "current-password"}
            aria-describedby={mode === "up" ? `${id}-hint` : undefined}
            className={INPUT}
          />
          {mode === "up" ? (
            <p id={`${id}-hint`} className="text-sm text-ink-muted">
              {t("passwordHint")}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="rounded-lg bg-status-bad-tint px-3 py-2 text-sm">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={busy} className="mt-2 self-start">
          {busy ? t("working") : mode === "in" ? t("signIn") : t("signUp")}
        </Button>
      </form>
    </section>
  );
}

// --------------------------------------------------------------------------- signed in

function SignedIn({ account, fields }: { account: Account; fields: SavedField[] }) {
  const t = useTranslations("Account");
  const locale = useAppLocale();
  const [busy, setBusy] = useState(false);
  const totalHa = fields.reduce((sum, field) => sum + polygonAreaHa(field.boundary), 0);

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-ink-muted">
          {account.name ? `${t("hello", { name: account.name })} · ` : null}
          {t("signedInAs", { email: account.email })}
        </p>
        <Button
          variant="quiet"
          className="-mr-3"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await signOut().catch(() => undefined);
          }}
        >
          {t("signOut")}
        </Button>
      </div>

      <DeviceFieldImport />

      <section className="mt-10" aria-labelledby="fields-title">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 id="fields-title" className="text-2xl font-semibold tracking-tight">
              {t("fields.title")}
            </h2>
            {fields.length > 0 ? (
              <p className="mt-1 tabular-nums text-ink-muted">
                {t("fields.count", { count: fields.length, ha: formatNumber(totalHa, locale, 0) })}
              </p>
            ) : null}
          </div>
          <Link href="/field" className={buttonClass("primary")}>
            <PlusIcon size={18} />
            {t("fields.add")}
          </Link>
        </div>

        {fields.length === 0 ? (
          <p className="mt-6 text-ink-muted">{t("fields.empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {fields.map((field) => (
              <FieldRow key={field.id} field={field} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** The field drawn before signing in (kept in this browser), offered once for the account. */
function DeviceFieldImport() {
  const t = useTranslations("Account.fields");
  const locale = useAppLocale();
  const errorText = useErrorText();
  const local = useSavedField();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!local) return null;
  const ha = formatNumber(polygonAreaHa(local.boundary), locale, 0);

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

function RotationDots({ field }: { field: SavedField }) {
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

function FieldRow({ field }: { field: SavedField }) {
  const t = useTranslations("Account.fields");
  const locale = useAppLocale();
  const errorText = useErrorText();
  const id = useId();
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ha = formatNumber(polygonAreaHa(field.boundary), locale, 1);
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
    <li className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
      {mode === "rename" ? (
        <form onSubmit={rename} className="flex flex-1 flex-wrap items-end gap-2">
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
        <div className="min-w-0 flex-1">
          <p className="break-words text-lg font-semibold">{field.name}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-ink-muted">
            <span className="tabular-nums">{t("area", { ha })}</span>
            {field.near && field.near !== field.name ? <span>· {t("near", { place: field.near })}</span> : null}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink-muted">
            <RotationDots field={field} />
            <span>{t("updated", { date: updated })}</span>
          </p>
        </div>
      )}

      {mode === "view" ? (
        <div className="-ml-3 flex flex-wrap items-center gap-1 md:ml-0">
          <Link href={{ pathname: "/field", query: { saved: field.id } }} className={buttonClass("secondary")}>
            {t("open")}
          </Link>
          <Button variant="quiet" onClick={() => setMode("rename")}>
            {t("rename")}
          </Button>
          <Button variant="quiet" onClick={() => setMode("delete")}>
            {t("delete")}
          </Button>
        </div>
      ) : mode === "delete" ? (
        <div role="group" aria-label={t("confirmDelete", { name: field.name })} className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{t("confirmDelete", { name: field.name })}</span>
          <button
            type="button"
            disabled={busy}
            className="press inline-flex min-h-11 items-center rounded-xl border border-status-bad bg-status-bad-tint px-4 font-medium disabled:opacity-40"
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
        <p role="alert" className="text-sm text-status-bad">
          {error}
        </p>
      ) : null}
    </li>
  );
}
