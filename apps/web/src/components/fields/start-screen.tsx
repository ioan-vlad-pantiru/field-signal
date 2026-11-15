"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { createField, deleteField, fieldInput, updateField, useAccount, AccountError } from "@/lib/account";
import type { Crop, SavedField as AccountField } from "@/lib/contracts";
import { formatNumber } from "@/lib/format";
import { fieldAreaHa } from "@/lib/geo";
import { LOCAL_FIELD, type LastVerdict } from "@/lib/last-verdict";
import { useAppLocale } from "@/lib/localized";
import { useLastVerdicts } from "@/lib/use-last-verdicts";
import { Link } from "@/i18n/navigation";
import { ActionBar } from "@/components/ui/action-bar";
import { INPUT_CLASS } from "@/components/ui/input";
import { Button, IconButton } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { CheckIcon, EditIcon, MoreIcon, PlusIcon, SearchIcon, UploadIcon } from "@/components/ui/icons";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Sheet } from "@/components/ui/sheet";
import { MAX_FIELDS } from "@/components/farmer/draft-field";
import { forgetField, type SavedField as LocalField } from "@/components/farmer/steps/saved-field";
import { FieldThumb } from "./field-thumb";

/** From this many fields the list gets a search box. */
const SEARCH_FROM = 7;

/**
 * My fields: the farmer's fields as cards with one action, Analyze. "Add a field" and "Import from
 * file" are always one tap away; "Select" analyses several together.
 */
export function StartScreen({
  local,
  onAnalyze,
  onAnalyzeLocal,
  onEdit,
  onAdd,
}: {
  /** The field kept on this device (signed out, or not yet moved to the account). */
  local: LocalField | null;
  /** Account fields to analyse (one or several). */
  onAnalyze: (fields: AccountField[]) => void;
  onAnalyzeLocal: (field: LocalField) => void;
  onEdit: (field: AccountField) => void;
  onAdd: () => void;
}) {
  const t = useTranslations("Fields");
  const locale = useAppLocale();
  const account = useAccount();
  const verdicts = useLastVerdicts();
  const fields = useMemo(
    () =>
      account.status === "signed-in"
        ? [...account.fields].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        : [],
    [account],
  );
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AccountField | null>(null);
  const shown = query.trim()
    ? fields.filter((f) => f.name.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)))
    : fields;
  const totalHa = fields.reduce((sum, f) => sum + fieldAreaHa(f), 0) + (local ? fieldAreaHa(local) : 0);
  const count = fields.length + (local ? 1 : 0);
  const picked = fields.filter((f) => chosen.has(f.id));

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id) && next.size < MAX_FIELDS) next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <ScreenHeader
        title={t("title")}
        meta={t("summary", { count, ha: formatNumber(totalHa, locale, 0) })}
        actions={
          fields.length > 1 ? (
            <Button
              variant="quiet"
              onClick={() => {
                setSelecting((s) => !s);
                setChosen(new Set());
              }}
            >
              {selecting ? t("done") : t("select")}
            </Button>
          ) : null
        }
      />

      {selecting ? null : (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button onClick={onAdd} size="lg">
            <PlusIcon size={20} />
            {t("add")}
          </Button>
          <Link href="/field?import=1" aria-label={t("import")} title={t("import")} className="press inline-flex size-14 items-center justify-center rounded-pill bg-surface text-ink shadow-1 ring-1 ring-line hover:ring-ink-muted">
            <UploadIcon size={20} />
          </Link>
        </div>
      )}

      {fields.length >= SEARCH_FROM ? (
        <label className="relative block">
          <span className="sr-only">{t("search")}</span>
          <SearchIcon size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            className={`${INPUT_CLASS} pl-11`}
          />
        </label>
      ) : null}

      <ul className="flex flex-col gap-3">
        {local ? (
          <li className="rise">
            <LocalCard field={local} verdict={verdicts[LOCAL_FIELD]} onAnalyze={() => onAnalyzeLocal(local)} />
          </li>
        ) : null}
        {shown.map((field, i) => (
          <li key={field.id} className="rise" style={{ "--i": Math.min(i + 1, 8) } as React.CSSProperties}>
            <FieldCard
              field={field}
              verdict={verdicts[field.id]}
              selecting={selecting}
              selected={chosen.has(field.id)}
              onToggle={() => toggle(field.id)}
              onAnalyze={() => onAnalyze([field])}
              onOptions={() => setOptions(field)}
            />
          </li>
        ))}
      </ul>

      {account.status === "signed-out" ? (
        <p className="text-center text-sm text-ink-muted">
          <Link href="/more/account" className="font-semibold text-field underline-offset-4 hover:underline">
            {t("signIn")}
          </Link>{" "}
          {t("signInWhy")}
        </p>
      ) : null}

      {selecting ? (
        <ActionBar note={chosen.size >= MAX_FIELDS ? t("max", { max: MAX_FIELDS }) : undefined}>
          <Button size="lg" className="flex-1" disabled={picked.length === 0} onClick={() => onAnalyze(picked)}>
            {t("analyzeMany", { count: picked.length })}
          </Button>
        </ActionBar>
      ) : null}

      <FieldOptions field={options} onClose={() => setOptions(null)} onEdit={onEdit} />
    </div>
  );
}

function VerdictLine({ verdict }: { verdict: LastVerdict | undefined }) {
  const t = useTranslations("Fields");
  const crops = useTranslations("CropsShort");
  if (!verdict) return <span className="text-ink-muted">{t("notYet")}</span>;
  if (verdict.kind === "keep") {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-status-good">
        <CheckIcon size={16} />
        {t("keep")}
      </span>
    );
  }
  const names = verdict.best.map((c) => (crops.has(c) ? crops(c as Crop) : c)).join(" → ");
  return (
    <span className={verdict.kind === "fewer" ? "font-semibold text-field" : "text-ink"}>
      {t(verdict.kind === "fewer" ? "better" : "other", { crops: names })}
    </span>
  );
}

function FieldCard({
  field,
  verdict,
  selecting,
  selected,
  onToggle,
  onAnalyze,
  onOptions,
}: {
  field: AccountField;
  verdict: LastVerdict | undefined;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
  onOptions: () => void;
}) {
  const t = useTranslations("Fields");
  const locale = useAppLocale();
  const meta = [t("area", { ha: formatNumber(fieldAreaHa(field), locale, 1) }), field.near].filter(Boolean).join(" · ");
  const head = (
    <>
      <FieldThumb boundary={field.boundary} parts={field.parts} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{field.name}</span>
        <span className="block truncate text-sm tabular-nums text-ink-muted">{meta}</span>
      </span>
    </>
  );

  if (selecting) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        className={cardClass(true, `flex w-full items-center gap-3 p-3 ${selected ? "ring-2 ring-field" : ""}`)}
      >
        {head}
        <span
          aria-hidden="true"
          className={`flex size-7 shrink-0 items-center justify-center rounded-full ${selected ? "bg-field text-on-field" : "ring-2 ring-line"}`}
        >
          {selected ? <CheckIcon size={16} /> : null}
        </span>
      </button>
    );
  }

  return (
    <div className={cardClass(false, "flex flex-col gap-2 p-3")}>
      <div className="flex items-center gap-3">
        {head}
        <IconButton label={t("options", { name: field.name })} onClick={onOptions} className="-mr-1">
          <MoreIcon size={20} />
        </IconButton>
      </div>
      <div className="flex items-center gap-3 border-t border-line pt-2">
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <VerdictLine verdict={verdict} />
        </span>
        <Button variant="tonal" onClick={onAnalyze}>
          {t("analyze")}
        </Button>
      </div>
    </div>
  );
}

/** The field from this device: analyse it, or (signed in) move it to the account. */
function LocalCard({ field, verdict, onAnalyze }: { field: LocalField; verdict: LastVerdict | undefined; onAnalyze: () => void }) {
  const t = useTranslations("Fields");
  const errors = useTranslations("Account.errors");
  const locale = useAppLocale();
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ha = formatNumber(fieldAreaHa(field), locale, 1);
  const name = field.near ?? t("area", { ha });

  async function keep() {
    setBusy(true);
    setError(null);
    try {
      await createField({ name, request: field.request, boundary: field.boundary, parts: field.parts ?? [], near: field.near });
      forgetField();
    } catch (caught) {
      const code = caught instanceof AccountError ? caught.code : "server";
      setError(errors.has(code) ? errors(code) : t("failed"));
      setBusy(false);
    }
  }

  return (
    <div className={cardClass(false, "flex flex-col gap-2 p-3")}>
      <div className="flex items-center gap-3">
        <FieldThumb boundary={field.boundary} parts={field.parts} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block truncate text-sm tabular-nums text-ink-muted">
            {t("area", { ha })} · {t("thisDevice")}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-3 border-t border-line pt-2">
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <VerdictLine verdict={verdict} />
        </span>
        <Button variant="tonal" onClick={onAnalyze}>
          {t("analyze")}
        </Button>
      </div>
      {account.status === "signed-in" ? (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-surface-sunken px-3 py-2">
          <span className="text-sm">{error ?? t("keepOnAccount")}</span>
          <Button variant="secondary" onClick={keep} disabled={busy}>
            {t("save")}
          </Button>
        </div>
      ) : (
        <Button variant="quiet" className="self-start" onClick={forgetField}>
          {t("forget")}
        </Button>
      )}
    </div>
  );
}

/** Edit, rename or delete one field. */
function FieldOptions({ field, onClose, onEdit }: { field: AccountField | null; onClose: () => void; onEdit: (field: AccountField) => void }) {
  const t = useTranslations("Fields");
  const errors = useTranslations("Account.errors");
  const id = useId();
  const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setMode("menu");
    setError(null);
    onClose();
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      close();
    } catch (caught) {
      const code = caught instanceof AccountError ? caught.code : "server";
      setError(errors.has(code) ? errors(code) : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!field) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    void run(() => updateField(field.id, { ...fieldInput(field), name }));
  }

  return (
    <Sheet open={field !== null} onClose={close} title={field?.name ?? ""}>
      {field && mode === "menu" ? (
        <ul className="flex flex-col gap-2 pb-2">
          <li>
            <Button variant="secondary" className="w-full justify-start" onClick={() => { close(); onEdit(field); }}>
              <EditIcon size={18} />
              {t("edit")}
            </Button>
          </li>
          <li>
            <Button variant="secondary" className="w-full justify-start" onClick={() => setMode("rename")}>
              {t("rename")}
            </Button>
          </li>
          <li>
            <Button variant="secondary" className="w-full justify-start text-status-bad" onClick={() => setMode("delete")}>
              {t("delete")}
            </Button>
          </li>
        </ul>
      ) : null}
      {field && mode === "rename" ? (
        <form onSubmit={rename} className="flex flex-col gap-3 pb-2">
          <label htmlFor={`${id}-name`} className="text-sm font-semibold">
            {t("name")}
          </label>
          <input id={`${id}-name`} name="name" defaultValue={field.name} maxLength={80} required autoFocus className={INPUT_CLASS} />
          <Button type="submit" disabled={busy}>
            {t("saveName")}
          </Button>
        </form>
      ) : null}
      {field && mode === "delete" ? (
        <div className="flex flex-col gap-3 pb-2">
          <p>{t("deleteConfirm", { name: field.name })}</p>
          <Button variant="danger" disabled={busy} onClick={() => void run(() => deleteField(field.id))}>
            {t("delete")}
          </Button>
          <Button variant="quiet" onClick={() => setMode("menu")}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="pb-2 text-sm text-status-bad">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
