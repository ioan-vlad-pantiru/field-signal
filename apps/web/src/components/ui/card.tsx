import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h2 className="text-xl font-semibold tracking-tight">{children}</h2>
      {hint ? <p className="mt-1 text-muted">{hint}</p> : null}
    </div>
  );
}
