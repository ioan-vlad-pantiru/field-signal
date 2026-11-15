"use client";

import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CrossIcon } from "./icons";
import { dismissAfterDrag } from "./sheet-drag";

/** Open sheets on the page; the floating assistant button hides while any is open. */
function countOpenSheet(delta: 1 | -1) {
  const root = document.documentElement;
  const next = Math.max(0, Number(root.dataset.sheets ?? 0) + delta);
  if (next === 0) delete root.dataset.sheets;
  else root.dataset.sheets = String(next);
}

/**
 * Bottom sheet on phones, centred dialog from 640px. Built on <dialog> for focus trapping, Escape
 * to close, a real modal backdrop and focus returned to the opener.
 * Drag the handle or the header down to dismiss; with `snap`, the sheet opens at about two thirds
 * of the screen and a drag up expands it.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  snap = false,
  transitionName,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One short line under the title. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Sticky actions at the bottom of the sheet, such as the primary button. */
  footer?: ReactNode;
  snap?: boolean;
  /** Shared view-transition name, so a card can morph into this sheet's header. */
  transitionName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useTranslations("Common");
  const titleId = useId();
  const [expanded, setExpanded] = useState(!snap);
  const drag = useRef<{ startY: number; startT: number; dy: number } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      countOpenSheet(1);
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Leaving the page with a sheet open must not leave the counter up.
  useEffect(
    () => () => {
      if (ref.current?.open) countOpenSheet(-1);
    },
    [],
  );

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,a,input,select,textarea")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startT: event.timeStamp, dy: 0 };
    ref.current?.setAttribute("data-dragging", "");
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const dialog = ref.current;
    if (!state || !dialog) return;
    state.dy = event.clientY - state.startY;
    // Down follows the finger; up is resisted (it only expands a snapped sheet).
    const offset = state.dy > 0 ? state.dy : state.dy / 6;
    dialog.style.transform = `translateY(${offset}px)`;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const dialog = ref.current;
    drag.current = null;
    if (!state || !dialog) return;
    dialog.removeAttribute("data-dragging");
    dialog.style.transform = "";
    const ms = Math.max(1, event.timeStamp - state.startT);
    if (dismissAfterDrag(state.dy, state.dy / ms, dialog.offsetHeight)) onClose();
    else if (snap && state.dy < -40) setExpanded(true);
  }

  const height = expanded ? "max-h-[92dvh]" : "max-h-[66dvh]";

  return (
    <dialog
      ref={ref}
      onClose={() => {
        countOpenSheet(-1);
        if (snap) setExpanded(false);
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby={titleId}
      className={`sheet m-0 mt-auto w-full max-w-none overflow-hidden rounded-t-[var(--radius-xl)] bg-surface-raised p-0 text-ink shadow-3 sm:m-auto sm:max-h-[85dvh] sm:max-w-lg sm:rounded-[var(--radius-xl)] ${height}`}
    >
      <div className={`flex flex-col sm:max-h-[85dvh] ${height}`}>
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="shrink-0 cursor-grab touch-none select-none px-5 pb-3 pt-2 active:cursor-grabbing sm:cursor-auto sm:pt-4"
          style={transitionName ? { viewTransitionName: transitionName } : undefined}
        >
          <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line sm:hidden" />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-semibold leading-snug">
                {title}
              </h2>
              {subtitle ? <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="press -mr-2 inline-flex size-tap shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted hover:text-ink"
            >
              <CrossIcon size={18} />
            </button>
          </div>
        </div>
        {/* Focus lands here on open (not on the close button), so arrow keys scroll the sheet. */}
        <div
          tabIndex={-1}
          autoFocus
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none"
        >
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-1px_0_var(--line)]">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
