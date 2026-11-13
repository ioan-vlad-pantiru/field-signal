"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

/** Translates the plain units the API uses ("days", "seasons"); others (mm, NDVI) pass through. */
export function useUnitLabel(): (unit: string) => string {
  const t = useTranslations("Units");
  return useCallback((unit: string) => (t.has(unit) ? t(unit) : unit), [t]);
}
