import type { ReactNode } from "react";

/** Evidence that is one tap away: closed by default, open with `defaultOpen`. */
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
    <details open={defaultOpen} className={`group border-t border-line ${className}`}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 font-medium [&::-webkit-details-marker]:hidden">
        {summary}
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}
