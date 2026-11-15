"use client";

import { useId, type InputHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { AccountError } from "@/lib/account";

/** Text input style shared by every account and save-field form. */
export const INPUT =
  "min-h-tap w-full rounded-sm border border-line bg-surface px-3 text-base outline-offset-2 placeholder:text-ink-muted focus-visible:outline-3 focus-visible:outline-[var(--focus)]";

/** Translates an API error code, falling back to the generic one. */
export function useErrorText() {
  const t = useTranslations("Account.errors");
  return (error: unknown) => {
    const code = error instanceof AccountError ? error.code : "server";
    return t.has(code) ? t(code) : t("server");
  };
}

/** A labelled input, label above. */
export function TextField({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input id={id} className={INPUT} {...props} />
    </div>
  );
}

/** One line under a form: an error (alert) or a confirmation (status). */
export function FormNote({ error, done }: { error?: string | null; done?: string | null }) {
  if (error)
    return (
      <p role="alert" className="rounded-sm bg-status-bad-tint px-3 py-2 text-sm">
        {error}
      </p>
    );
  return (
    <p role="status" className="text-sm text-field empty:hidden">
      {done ?? ""}
    </p>
  );
}
