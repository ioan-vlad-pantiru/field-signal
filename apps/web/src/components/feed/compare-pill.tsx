"use client";

import { useTranslations } from "next-intl";
import { Button, IconButton } from "@/components/ui/button";
import { CrossIcon } from "@/components/ui/icons";

/**
 * Floats above the nav once a commune is ticked: "Tick 1 more", then "Compare 2", which opens the
 * comparison sheet. The cross clears the ticks.
 */
export function ComparePill({
  count,
  onCompare,
  onClear,
}: {
  count: number;
  onCompare: () => void;
  onClear: () => void;
}) {
  const t = useTranslations("Feed.compare");
  return (
    <div
      aria-live="polite"
      className="no-print pointer-events-none fixed inset-x-0 bottom-[calc(var(--bar-space)+0.5rem)] z-30 flex justify-center px-gutter sm:bottom-6"
    >
      {count > 0 ? (
        <div className="rise pointer-events-auto flex items-center gap-1 rounded-pill bg-glass p-1 shadow-float backdrop-blur-md">
          {count >= 2 ? (
            <Button aria-haspopup="dialog" onClick={onCompare}>
              {t("pill", { count })}
            </Button>
          ) : (
            <p className="px-4 text-sm font-semibold">{t("pickOne")}</p>
          )}
          <IconButton label={t("clear")} onClick={onClear}>
            <CrossIcon size={18} />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
