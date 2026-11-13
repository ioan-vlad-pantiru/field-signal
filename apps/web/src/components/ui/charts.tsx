import type { Range, YearValue } from "@/lib/contracts";

/**
 * Hand-built SVG sparkline. Gaps (null) break the line; the dashed line is the multi-year mean
 * and the last point is emphasised because the card compares it with the mean.
 */
export function Sparkline({
  series,
  baseline,
  label,
  width = 280,
  height = 56,
}: {
  series: YearValue[];
  baseline: number | null;
  label: string;
  width?: number;
  height?: number;
}) {
  const values = series.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const pad = 4;
  const lo = Math.min(...values, baseline ?? Infinity);
  const hi = Math.max(...values, baseline ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / Math.max(series.length - 1, 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);

  const segments: string[] = [];
  let current = "";
  series.forEach((point, i) => {
    if (point.value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(point.value).toFixed(1)}`;
  });
  if (current) segments.push(current);

  const lastIndex = series.findLastIndex((p) => p.value !== null);
  const last = series[lastIndex];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-14 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {baseline !== null ? (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="var(--muted)"
          strokeDasharray="4 4"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {segments.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {last?.value != null ? (
        <circle cx={x(lastIndex)} cy={y(last.value)} r={3.5} fill="var(--accent)" />
      ) : null}
    </svg>
  );
}

/**
 * Low–mid–high range on a fixed 0–100 axis (or a custom domain). The band is the range,
 * the tick is the central estimate.
 */
export function RangeBar({
  range,
  domain = [0, 100],
  label,
}: {
  range: Range;
  domain?: [number, number];
  label: string;
}) {
  const [min, max] = domain;
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
  return (
    <div role="img" aria-label={label} className="relative h-3 w-full rounded-full bg-surface-muted">
      <div
        className="absolute inset-y-0 rounded-full bg-primary-soft ring-1 ring-primary/40"
        style={{ left: pct(range.low), right: `calc(100% - ${pct(range.high)})` }}
      />
      <div
        className="absolute -inset-y-1 w-1 -translate-x-1/2 rounded-full bg-primary"
        style={{ left: pct(range.mid) }}
      />
    </div>
  );
}

/** Horizontal bar for one 0–100 score component. */
export function ScoreBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-surface-muted" aria-hidden="true">
      <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
