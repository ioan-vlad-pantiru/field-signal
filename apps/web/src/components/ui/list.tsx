import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { ChevronRightIcon } from "./icons";

/** A rounded group of rows, as on a phone's settings screen. */
export function ListGroup({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {title ? <h2 className="mb-2 px-1 text-sm font-semibold text-ink-muted">{title}</h2> : null}
      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-1">{children}</ul>
    </section>
  );
}

const ROW = "press flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-sunken";

/** One row: icon, label, optional value on the right, and a chevron when it leads somewhere. A full URL opens in a new tab. */
export function ListRow({
  icon,
  label,
  detail,
  value,
  href,
  onClick,
  locale,
}: {
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
  locale?: string;
}) {
  const body = (
    <>
      {icon ? <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-field-soft text-field-strong">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {detail ? <span className="block truncate text-sm text-ink-muted">{detail}</span> : null}
      </span>
      {value ? <span className="shrink-0 text-sm text-ink-muted">{value}</span> : null}
      {href || onClick ? <ChevronRightIcon size={18} className="shrink-0 text-ink-muted" /> : null}
    </>
  );
  return (
    <li>
      {href && /^https?:\/\//.test(href) ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={ROW}>
          {body}
        </a>
      ) : href ? (
        <Link href={href} locale={locale} className={ROW}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={ROW}>
          {body}
        </button>
      ) : (
        <div className="flex min-h-14 items-center gap-3 px-4 py-2">{body}</div>
      )}
    </li>
  );
}
