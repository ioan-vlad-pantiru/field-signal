"use client";

import dynamic from "next/dynamic";
import { useCallback, useId, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  AccountError,
  changePassword,
  createField,
  deleteAccount,
  deleteField,
  fieldInput,
  reloadAccount,
  signIn,
  signOut,
  signUp,
  updateField,
  updateProfile,
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
import { Disclosure } from "@/components/ui/disclosure";
import { Segmented } from "@/components/ui/segmented";
import { MAX_FIELDS } from "@/components/farmer/draft-field";

const FieldsMap = dynamic(() => import("./fields-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full rounded-2xl sm:h-80" />,
});
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
    <div className="max-w-[1100px]">
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

type Sort = "recent" | "name" | "area";

function SignedIn({ account, fields }: { account: Account; fields: SavedField[] }) {
  const t = useTranslations("Account");
  const tf = useTranslations("Account.fields");
  const locale = useAppLocale();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const searchId = useId();

  const areas = useMemo(() => new Map(fields.map((f) => [f.id, polygonAreaHa(f.boundary)])), [fields]);
  const totalHa = fields.reduce((sum, f) => sum + (areas.get(f.id) ?? 0), 0);
  const places = new Set(fields.map((f) => f.near).filter(Boolean)).size;
  // Selections of deleted fields drop out.
  const chosen = fields.filter((f) => selected.has(f.id));
  const chosenHa = chosen.reduce((sum, f) => sum + (areas.get(f.id) ?? 0), 0);
  const full = chosen.length >= MAX_FIELDS;

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    const list = q
      ? fields.filter((f) => `${f.name} ${f.near ?? ""}`.toLocaleLowerCase(locale).includes(q))
      : [...fields];
    if (sort === "name") list.sort((x, y) => x.name.localeCompare(y.name, locale));
    if (sort === "area") list.sort((x, y) => (areas.get(y.id) ?? 0) - (areas.get(x.id) ?? 0));
    return list;
  }, [fields, query, sort, locale, areas]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const pick = useCallback((id: string) => {
    setFocused(id);
    document.getElementById(`field-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const shownIds = shown.map((f) => f.id);
  const allShownChosen = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  function toggleAll() {
    setSelected((prev) => {
      if (allShownChosen) return new Set([...prev].filter((id) => !shownIds.includes(id)));
      const next = new Set(prev);
      for (const id of shownIds) if (next.size < MAX_FIELDS) next.add(id);
      return next;
    });
  }

  return (
    <>
      <p className="mt-2 text-lg text-ink-muted">
        {account.name ? t("hello", { name: account.name }) : t("signedInAs", { email: account.email })}
      </p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <div className="min-w-0">
          <DeviceFieldImport />

          <section aria-labelledby="fields-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="fields-title" className="text-2xl font-semibold tracking-tight">
                  {tf("title")}
                </h2>
                {fields.length > 0 ? (
                  <p className="mt-1 tabular-nums text-ink-muted">
                    {tf("summary", { count: fields.length, ha: formatNumber(totalHa, locale, 0), places })}
                  </p>
                ) : null}
              </div>
              <Link href="/field" className={buttonClass("primary")}>
                <PlusIcon size={18} />
                {tf("add")}
              </Link>
            </div>

            {fields.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center">
                <p className="text-lg font-semibold">{tf("emptyTitle")}</p>
                <p className="mx-auto mt-1 max-w-md text-ink-muted">{tf("empty")}</p>
                <Link href="/field" className={buttonClass("primary", "md", "mt-5")}>
                  {tf("drawFirst")}
                </Link>
              </div>
            ) : (
              <>
                <div className="mt-5">
                  <FieldsMap fields={fields} selected={selected} onPick={pick} />
                </div>

                <div className="mt-6 flex flex-wrap items-end gap-3">
                  <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                    <label htmlFor={searchId} className="text-sm font-medium">
                      {tf("search")}
                    </label>
                    <input
                      id={searchId}
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={tf("searchPlaceholder")}
                      className={INPUT}
                    />
                  </div>
                  <Segmented
                    label={tf("sort")}
                    value={sort}
                    onChange={setSort}
                    options={[
                      { value: "recent", label: tf("sortRecent") },
                      { value: "name", label: tf("sortName") },
                      { value: "area", label: tf("sortArea") },
                    ]}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                  <label className="press inline-flex min-h-11 cursor-pointer items-center gap-2.5 font-medium">
                    <input
                      type="checkbox"
                      checked={allShownChosen}
                      onChange={toggleAll}
                      disabled={shown.length === 0}
                      className="size-5 accent-[var(--field)]"
                    />
                    {tf("selectAll")}
                  </label>
                  <p className="text-sm text-ink-muted">{tf("selectHint", { max: MAX_FIELDS })}</p>
                </div>

                {shown.length === 0 ? (
                  <p className="mt-6 text-ink-muted">{tf("noMatch", { query })}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {shown.map((field) => (
                      <FieldRow
                        key={field.id}
                        field={field}
                        areaHa={areas.get(field.id) ?? 0}
                        checked={selected.has(field.id)}
                        disabled={full && !selected.has(field.id)}
                        focused={focused === field.id}
                        onToggle={toggle}
                      />
                    ))}
                  </ul>
                )}

                {chosen.length > 0 ? (
                  <div
                    role="region"
                    aria-label={tf("selectionLabel")}
                    className="sticky bottom-20 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink p-3 pl-4 text-ground shadow-[var(--shadow-2)] sm:bottom-4"
                  >
                    <p className="font-medium tabular-nums">
                      {tf("selected", { count: chosen.length, ha: formatNumber(chosenHa, locale, 0) })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className="press min-h-11 rounded-xl px-3 font-medium hover:bg-ground/10"
                      >
                        {tf("clear")}
                      </button>
                      <Link
                        href={{ pathname: "/field", query: { saved: chosen.map((f) => f.id).join(","), run: "1" } }}
                        className={buttonClass("primary")}
                      >
                        {chosen.length > 1 ? tf("analyseMany", { count: chosen.length }) : tf("analyse")}
                      </Link>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <ProfilePanel account={account} fieldCount={fields.length} />
        </aside>
      </div>
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

/** The field's outline, drawn to fit a small square, north up. */
function FieldShape({ field }: { field: SavedField }) {
  const lat0 = field.boundary[0].lat;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const pts = field.boundary.map((p) => [p.lon * k, -p.lat] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const offX = (span - (Math.max(...xs) - minX)) / 2;
  const offY = (span - (Math.max(...ys) - minY)) / 2;
  const d = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${(6 + ((x - minX + offX) / span) * 52).toFixed(1)} ${(6 + ((y - minY + offY) / span) * 52).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="size-16 shrink-0 rounded-xl bg-surface-sunken">
      <path d={`${d}Z`} className="fill-field-tint stroke-field" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function FieldRow({
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

// --------------------------------------------------------------------------- profile and security

function ProfilePanel({ account, fieldCount }: { account: Account; fieldCount: number }) {
  const t = useTranslations("Account.profile");
  const ta = useTranslations("Account");
  const locale = useAppLocale();
  const errorText = useErrorText();
  const id = useId();
  const [nameState, setNameState] = useState<"idle" | "busy" | "saved">("idle");
  const [nameError, setNameError] = useState<string | null>(null);
  const [pwState, setPwState] = useState<"idle" | "busy" | "done">("idle");
  const [pwError, setPwError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const since = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(account.created_at));

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    setNameState("busy");
    setNameError(null);
    try {
      await updateProfile(name || null);
      setNameState("saved");
    } catch (caught) {
      setNameError(errorText(caught));
      setNameState("idle");
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPwState("busy");
    setPwError(null);
    try {
      await changePassword(String(data.get("current") ?? ""), String(data.get("next") ?? ""));
      form.reset();
      setPwState("done");
    } catch (caught) {
      setPwError(errorText(caught));
      setPwState("idle");
    }
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDelBusy(true);
    setDelError(null);
    try {
      await deleteAccount(String(new FormData(event.currentTarget).get("password") ?? ""));
    } catch (caught) {
      setDelError(errorText(caught));
      setDelBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line p-5">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {t("title")}
      </h2>
      <dl className="mt-3 text-sm">
        <dt className="text-ink-muted">{t("email")}</dt>
        <dd className="break-all font-medium">{account.email}</dd>
        <dt className="mt-2 text-ink-muted">{t("since")}</dt>
        <dd className="font-medium">{since}</dd>
      </dl>

      <form onSubmit={saveName} className="mt-5 flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          {t("name")}
        </label>
        <div className="flex gap-2">
          <input
            id={`${id}-name`}
            name="name"
            defaultValue={account.name ?? ""}
            maxLength={80}
            autoComplete="name"
            onChange={() => setNameState("idle")}
            className={INPUT}
          />
          <Button type="submit" variant="secondary" disabled={nameState === "busy"}>
            {t("saveName")}
          </Button>
        </div>
        <p role="status" className="min-h-5 text-sm text-field">
          {nameState === "saved" ? t("nameSaved") : null}
        </p>
        {nameError ? (
          <p role="alert" className="text-sm text-status-bad">
            {nameError}
          </p>
        ) : null}
      </form>

      <Disclosure summary={t("passwordTitle")} className="mt-2">
        <form onSubmit={savePassword} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-current`} className="text-sm font-medium">
              {t("currentPassword")}
            </label>
            <input id={`${id}-current`} name="current" type="password" required autoComplete="current-password" className={INPUT} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-next`} className="text-sm font-medium">
              {t("newPassword")}
            </label>
            <input
              id={`${id}-next`}
              name="next"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              aria-describedby={`${id}-next-hint`}
              className={INPUT}
            />
            <p id={`${id}-next-hint`} className="text-sm text-ink-muted">
              {ta("passwordHint")}
            </p>
          </div>
          <Button type="submit" variant="secondary" disabled={pwState === "busy"} className="self-start">
            {t("changePassword")}
          </Button>
          <p role="status" className="text-sm text-field">
            {pwState === "done" ? t("passwordChanged") : null}
          </p>
          {pwError ? (
            <p role="alert" className="text-sm text-status-bad">
              {pwError}
            </p>
          ) : null}
        </form>
      </Disclosure>

      <div className="border-t border-line pt-4">
        <Button
          variant="secondary"
          className="w-full"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            await signOut().catch(() => undefined);
          }}
        >
          {ta("signOut")}
        </Button>
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <h3 className="font-semibold">{t("deleteTitle")}</h3>
        <p className="mt-1 text-sm text-ink-muted">{t("deleteText", { count: fieldCount })}</p>
        {deleting ? (
          <form onSubmit={remove} className="mt-3 flex flex-col gap-2 rounded-xl bg-status-bad-tint p-3">
            <label htmlFor={`${id}-del`} className="text-sm font-medium">
              {t("deletePassword")}
            </label>
            <input id={`${id}-del`} name="password" type="password" required autoComplete="current-password" autoFocus className={INPUT} />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={delBusy}
                className="press inline-flex min-h-11 items-center rounded-xl bg-status-bad px-4 font-medium text-on-status disabled:opacity-40"
              >
                {t("deleteConfirm")}
              </button>
              <Button variant="quiet" onClick={() => setDeleting(false)}>
                {ta("fields.cancel")}
              </Button>
            </div>
            {delError ? (
              <p role="alert" className="text-sm text-status-bad">
                {delError}
              </p>
            ) : null}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="press -ml-3 mt-1 inline-flex min-h-11 items-center rounded-xl px-3 font-medium text-status-bad hover:bg-status-bad-tint"
          >
            {t("deleteStart")}
          </button>
        )}
      </div>
    </section>
  );
}
