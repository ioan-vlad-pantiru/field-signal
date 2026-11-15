import type { DataSource } from "@/lib/contracts";
import { SatelliteIcon } from "./icons";

/** Dataset · resolution · period, so every number shows where it came from. */
export function SourceChip({ source }: { source: DataSource }) {
  const text = `${source.dataset} · ${source.resolution} · ${source.period}`;
  const className =
    "inline-flex min-h-tap w-fit max-w-full items-center gap-1.5 rounded-lg bg-signal-tint px-2.5 py-1 text-sm tabular-nums text-ink";
  const icon = <SatelliteIcon size={14} className="shrink-0 text-signal" />;
  if (!source.url)
    return (
      <span className={className}>
        {icon}
        <span className="truncate">{text}</span>
      </span>
    );
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className={`${className} underline-offset-2 hover:underline`}
      title={source.product}
    >
      {icon}
      <span className="truncate">{text}</span>
    </a>
  );
}
