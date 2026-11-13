"use client";

import { useTranslations } from "next-intl";
import type { DataOrigin } from "@/lib/api";
import { AlertIcon } from "./icons";

/** Shown whenever the data has `mock: true`, so demo numbers are never mistaken for real ones. */
export function DemoBanner({ origin }: { origin: DataOrigin }) {
  const t = useTranslations("Banner");
  return (
    <div role="status" className="flex gap-3 rounded-2xl border-2 border-status-watch bg-status-watch-tint px-4 py-3">
      <AlertIcon className="mt-0.5 shrink-0 text-status-watch" />
      <div>
        <p className="font-semibold">{t("title")}</p>
        <p className="text-sm">
          {t("text")} {origin === "fallback" ? t("offline") : null}
        </p>
      </div>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("Common");
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-status-bad bg-status-bad-tint p-4">
      <p className="font-semibold">{t("errorTitle")}</p>
      <p>{t("errorText")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="press min-h-11 rounded-xl bg-field px-4 font-semibold text-on-field"
      >
        {t("retry")}
      </button>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-line p-6 text-center text-ink-muted">{children}</p>
  );
}
