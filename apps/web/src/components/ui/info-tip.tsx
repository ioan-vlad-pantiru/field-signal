"use client";

import { useId, type ReactNode } from "react";
import { InfoIcon } from "./icons";

/**
 * A plain-language note one tap away, as a small floating card (native popover: light dismiss,
 * Escape, aria-expanded on the trigger). Sits above the floating nav on phones.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={label}
        title={label}
        className="press -m-2 inline-flex size-tap shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink"
      >
        <InfoIcon size={18} />
      </button>
      <Tip id={id} title={label}>
        {children}
      </Tip>
    </>
  );
}

/** A word of jargon, dotted-underlined; tapping it shows a one-line definition. */
export function Term({ children, definition }: { children: ReactNode; definition: ReactNode }) {
  const id = useId();
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className="inline cursor-help rounded-xs font-[inherit] underline decoration-ink-muted decoration-dotted decoration-2 underline-offset-4 hover:decoration-field"
      >
        {children}
      </button>
      <Tip id={id} title={children}>
        {definition}
      </Tip>
    </>
  );
}

function Tip({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <div id={id} popover="auto" role="note" className="tip">
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-sm text-ink-muted">{children}</div>
    </div>
  );
}
