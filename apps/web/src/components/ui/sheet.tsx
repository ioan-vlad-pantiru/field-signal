"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CrossIcon } from "./icons";

/**
 * Bottom sheet on mobile, centred dialog on desktop. Built on <dialog> for focus trapping,
 * Escape to close and a real modal backdrop.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useTranslations("Common");

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
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="sheet-title"
      className="sheet m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-3xl bg-surface p-0 text-ink sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
          <div id="sheet-title" className="min-w-0 flex-1 text-lg font-semibold">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="-mr-2 -mt-1 inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-sunken"
          >
            <CrossIcon />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {children}
        </div>
      </div>
    </dialog>
  );
}
