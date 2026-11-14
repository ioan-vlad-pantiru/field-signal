import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section style={style} className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h2 className="text-xl font-semibold tracking-tight">{children}</h2>
      {hint ? <p className="mt-1 text-ink-muted">{hint}</p> : null}
    </div>
  );
}
