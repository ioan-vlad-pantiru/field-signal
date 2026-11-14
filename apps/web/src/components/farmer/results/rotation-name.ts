"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { Strategy } from "@/lib/contracts";
import { useLocalized } from "@/lib/localized";

/**
 * One name per rotation on the whole page: the farmer's current rotation is always "Your rotation
 * now", whatever the API calls it; the others keep their API names.
 */
export function useRotationName(): (strategy: Pick<Strategy, "name" | "is_current">) => string {
  const t = useTranslations("Results.rotations");
  const l = useLocalized();
  return useCallback((strategy) => (strategy.is_current ? t("current") : l(strategy.name)), [t, l]);
}
