"use client";

import { useId, type ReactNode } from "react";

/** An on/off switch with its label, the whole row a 44px target. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex min-h-tap cursor-pointer items-center justify-between gap-4 ${className}`}>
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        {description ? <span className="block text-sm text-ink-muted">{description}</span> : null}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-8 w-[3.25rem] shrink-0 rounded-pill bg-line transition-colors duration-[var(--duration-base)] peer-checked:bg-field peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] after:absolute after:left-1 after:top-1 after:size-6 after:rounded-full after:bg-surface after:shadow-1 after:transition-transform after:duration-[var(--duration-slow)] after:ease-[var(--ease-spring)] peer-checked:after:translate-x-5"
      />
    </label>
  );
}
