import type { ReactNode } from "react";

/**
 * The thumb-zone bar on input screens: sticky at the bottom, above the floating nav on phones and
 * at the viewport bottom from 640px. Holds the step's primary action (and Back).
 */
export function ActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="no-print sticky bottom-[var(--bar-space)] z-20 -mx-gutter px-gutter pb-2 pt-3 sm:bottom-0 sm:pb-4">
      <div className="mx-auto flex max-w-xl flex-col gap-2 rounded-[var(--radius-xl)] bg-glass p-2 shadow-float backdrop-blur-md">
        {note ? (
          <p className="px-3 pt-1 text-center text-sm text-ink-muted" aria-live="polite">
            {note}
          </p>
        ) : null}
        <div className="flex gap-2">{children}</div>
      </div>
    </div>
  );
}
