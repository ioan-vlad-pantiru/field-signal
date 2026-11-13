"use client";

import { useId, useState } from "react";
import { InfoIcon } from "./icons";

/** Tap-friendly explanation: a 44px info button that reveals a plain-language note inline. */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-foreground"
      >
        <InfoIcon size={20} />
      </button>
      <p
        id={id}
        hidden={!open}
        className="basis-full rounded-lg bg-primary-soft px-3 py-2 text-sm text-foreground"
      >
        {children}
      </p>
    </>
  );
}
