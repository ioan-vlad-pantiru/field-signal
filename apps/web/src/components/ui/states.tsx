"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DataOrigin } from "@/lib/api";
import { AlertIcon } from "./icons";
import { Button } from "./button";

/**
 * Shown whenever the data has `mock: true`, so demo numbers are never mistaken for real ones:
 * a small chip, the full note one tap away.
 */
export function DemoBanner({ origin }: { origin: DataOrigin }) {
  const t = useTranslations("Banner");
  const id = useId();
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className="press inline-flex min-h-tap w-fit items-center gap-1.5 rounded-pill bg-status-watch-tint px-3 text-sm font-semibold text-ink"
      >
        <AlertIcon size={16} className="text-status-watch" />
        {t("title")}
      </button>
      <div id={id} popover="auto" role="note" className="tip">
        <p className="font-semibold">{t("title")}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {t("text")} {origin === "fallback" ? t("offline") : null}
        </p>
      </div>
    </>
  );
}

/** One friendly line and a retry. */
export function ErrorState({ onRetry, children }: { onRetry: () => void; children?: ReactNode }) {
  const t = useTranslations("Common");
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] bg-surface px-5 py-8 text-center shadow-1">
      <span className="flex size-12 items-center justify-center rounded-full bg-status-bad-tint text-status-bad">
        <AlertIcon size={22} />
      </span>
      <p className="font-semibold">{children ?? t("errorTitle")}</p>
      <Button onClick={onRetry}>{t("retry")}</Button>
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border-2 border-dashed border-line px-5 py-8 text-center text-ink-muted">
      <p>{children}</p>
      {action}
    </div>
  );
}
