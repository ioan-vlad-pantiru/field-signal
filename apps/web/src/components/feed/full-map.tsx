"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { IconButton } from "@/components/ui/button";
import { ArrowLeftIcon } from "@/components/ui/icons";

/**
 * Phones: the map opened full-bleed over the page, as a modal <dialog> (Escape and Back close it,
 * focus returns to the card). The map mounts only while open, so MapLibre measures the full screen.
 * A commune's sheet opens on top of it.
 */
export function FullMap({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const t = useTranslations("Feed.map");
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-ground p-0 text-ink backdrop:bg-scrim"
    >
      {open ? (
        <div className="relative h-full">
          {children}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-gutter pt-[max(0.75rem,env(safe-area-inset-top))]">
            <IconButton label={t("close")} variant="float" onClick={onClose} className="pointer-events-auto">
              <ArrowLeftIcon size={20} />
            </IconButton>
            <p className="min-w-0 truncate rounded-pill bg-glass px-4 py-2.5 text-sm font-semibold shadow-float backdrop-blur-md">
              {title}
            </p>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
