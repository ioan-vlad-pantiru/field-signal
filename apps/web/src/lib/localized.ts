"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";
import type { Localized } from "@/lib/contracts";

export type AppLocale = "ro" | "en";

export function useAppLocale(): AppLocale {
  return useLocale() === "en" ? "en" : "ro";
}

/** Returns a picker for the `{ ro, en }` strings the API sends. */
export function useLocalized(): (text: Localized) => string {
  const locale = useAppLocale();
  return useCallback((text: Localized) => text[locale], [locale]);
}
