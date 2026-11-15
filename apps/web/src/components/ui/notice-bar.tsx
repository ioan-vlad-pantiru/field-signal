import type { ReactNode } from "react";
import { AlertIcon, InfoIcon } from "./icons";

/** One-line notice, such as demo data or offline fallback. Never a large block. */
export function NoticeBar({
  children,
  tone = "watch",
  className = "",
}: {
  children: ReactNode;
  tone?: "watch" | "info";
  className?: string;
}) {
  const Icon = tone === "watch" ? AlertIcon : InfoIcon;
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm ${
        tone === "watch" ? "bg-status-watch-tint" : "bg-surface-sunken"
      } ${className}`}
    >
      <Icon size={18} className={`mt-px shrink-0 ${tone === "watch" ? "text-status-watch" : "text-ink-muted"}`} />
      <span>{children}</span>
    </p>
  );
}
