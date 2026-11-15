import type { ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

/** Detail that is one tap away: closed by default, open with `defaultOpen`. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={`group border-t border-line first:border-t-0 ${className}`}>
      <summary className="press flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-2 font-semibold [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDownIcon
          size={18}
          className="shrink-0 text-ink-muted transition-transform duration-[var(--duration-base)] ease-[var(--ease-settle)] group-open:rotate-180"
        />
      </summary>
      <div className="pb-5">{children}</div>
    </details>
  );
}
