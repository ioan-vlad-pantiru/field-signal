"use client";

import { useTranslations } from "next-intl";
import type { DataOrigin } from "@/lib/api";
import { AlertIcon } from "./icons";

/** Shown whenever the data has `mock: true`, so demo numbers are never mistaken for real ones. */
export function DemoBanner({ origin }: { origin: DataOrigin }) {
  const t = useTranslations("Banner");
  return (
    <div role="status" className="flex gap-3 rounded-2xl border-2 border-watch bg-watch-soft px-4 py-3">
      <AlertIcon className="mt-0.5 shrink-0 text-watch" />
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
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-bad bg-bad-soft p-4">
      <p className="font-semibold">{t("errorTitle")}</p>
      <p>{t("errorText")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-xl bg-primary px-4 font-semibold text-on-primary"
      >
        {t("retry")}
      </button>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-border p-6 text-center text-muted">{children}</p>
  );
}
