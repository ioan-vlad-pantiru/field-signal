import type { ButtonHTMLAttributes, ReactNode } from "react";

const BASE =
  "press inline-flex min-h-tap shrink-0 select-none items-center gap-2 whitespace-nowrap rounded-pill px-4 text-sm font-semibold";

export function chipClass(selected = false, className = "") {
  return `${BASE} ${
    selected ? "bg-ink text-surface" : "bg-surface text-ink shadow-1 ring-1 ring-line hover:ring-ink-muted"
  } ${className}`;
}

/** A pill to pick or filter with. Pass `selected` for a toggle (sets aria-pressed). */
export function Chip({
  selected,
  className = "",
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; children: ReactNode }) {
  return (
    <button type={type} aria-pressed={selected} className={chipClass(selected, className)} {...props}>
      {children}
    </button>
  );
}

/** A row of chips that scrolls sideways on narrow screens instead of wrapping. */
export function ChipRow({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`no-scrollbar -mx-gutter flex gap-2 overflow-x-auto px-gutter py-1 ${className}`}
    >
      {children}
    </div>
  );
}
