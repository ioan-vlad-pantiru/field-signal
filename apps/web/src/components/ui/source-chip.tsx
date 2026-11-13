import type { DataSource } from "@/lib/contracts";

/** Dataset · resolution · period, so every number shows where it came from. */
export function SourceChip({ source }: { source: DataSource }) {
  const text = `${source.dataset} · ${source.resolution} · ${source.period}`;
  const className =
    "inline-flex max-w-full items-center rounded-md bg-surface-muted px-2 py-1 text-xs text-muted";
  if (!source.url) return <span className={className}>{text}</span>;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className={`${className} underline-offset-2 hover:underline`}
      title={source.product}
    >
      <span className="truncate">{text}</span>
    </a>
  );
}
