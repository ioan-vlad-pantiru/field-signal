import type { ReactNode } from "react";

/** A screen's title, one optional short line, and its actions on the right. */
export function ScreenHeader({
  title,
  meta,
  actions,
  back,
  as: Heading = "h1",
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** A back control before the title. */
  back?: ReactNode;
  as?: "h1" | "h2";
}) {
  return (
    <header className="flex items-start gap-2">
      {back}
      <div className="min-w-0 flex-1 pt-1">
        <Heading className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{title}</Heading>
        {meta ? <p className="mt-1 text-sm tabular-nums text-ink-muted">{meta}</p> : null}
      </div>
      {actions ? <div className="no-print flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}
