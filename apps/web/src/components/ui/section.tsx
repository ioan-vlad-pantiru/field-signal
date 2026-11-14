import type { ReactNode } from "react";

/** A page section: hairline, title, optional hint. Sections are separated by space, not by cards. */
export function Section({
  title,
  hint,
  id,
  children,
  className = "",
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** Anchor for in-page navigation. */
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mt-12 scroll-mt-24 border-t border-line pt-8 first:mt-0 first:border-t-0 first:pt-0 ${className}`}>
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {hint ? <p className="mt-1 max-w-[65ch] text-ink-muted">{hint}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}
