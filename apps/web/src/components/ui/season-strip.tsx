import type { CSSProperties } from "react";
import type { SeasonOutcome, Status } from "@/lib/contracts";

/**
 * Good seasons stay quiet; only weak ones carry colour and a mark. `no_data` is a dashed outline.
 * Pair every strip with a `SeasonLegend` so the marks are explained in words.
 */
const CELL: Record<Status, { className: string; mark: string }> = {
  good: { className: "bg-surface-sunken", mark: "" },
  watch: { className: "bg-status-watch text-on-status", mark: "!" },
  bad: { className: "bg-status-bad text-on-status", mark: "×" },
  no_data: { className: "border border-dashed border-line", mark: "" },
};

/** Weak-evidence seasons (before SMAP, 2015) keep their mark but in a fainter, tinted cell. */
const FAINT: Partial<Record<Status, string>> = {
  watch: "bg-status-watch-tint text-status-watch",
  bad: "bg-status-bad-tint text-status-bad",
};

const HEIGHT = { sm: "h-4 text-[10px]", md: "h-6 text-xs", lg: "h-9 text-sm" } as const;

function columns(count: number): CSSProperties {
  return { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
}

/**
 * One rotation's outcome in every season, drawn on a shared year axis: pass the same `years` to
 * every strip (and to `SeasonAxis`) on a screen so columns line up.
 * With `onSelectYear` the cells are buttons; without it the strip is one labelled image.
 */
export function SeasonStrip({
  outcomes,
  years,
  label,
  cellLabel,
  selectedYear = null,
  onSelectYear,
  size = "md",
  animate = false,
  className = "",
}: {
  outcomes: readonly SeasonOutcome[];
  years: readonly number[];
  /** Accessible name of the strip, e.g. the rotation's name and a one-line summary. */
  label: string;
  /** Accessible name of one cell; required when cells are selectable. */
  cellLabel?: (outcome: SeasonOutcome) => string;
  selectedYear?: number | null;
  onSelectYear?: (year: number) => void;
  size?: keyof typeof HEIGHT;
  /** Fill the cells in from the first year to the last on mount. */
  animate?: boolean;
  className?: string;
}) {
  const byYear = new Map(outcomes.map((o) => [o.year, o]));
  const interactive = onSelectYear != null;
  return (
    <div
      role={interactive ? "group" : "img"}
      aria-label={label}
      style={columns(years.length)}
      className={`grid gap-[3px] ${className}`}
    >
      {years.map((year, col) => {
        const outcome = byYear.get(year);
        const status = outcome?.status ?? "no_data";
        const cell = CELL[status];
        const tone = (outcome?.evidence_level === "low" && FAINT[status]) || cell.className;
        const selected = selectedYear === year;
        const dimmed = selectedYear != null && !selected;
        const classes = `flex items-center justify-center rounded-[3px] font-bold leading-none ${HEIGHT[size]} ${tone} ${selected ? "outline outline-2 outline-offset-1 outline-ink" : ""} ${dimmed ? "opacity-45" : ""} ${animate ? "season-in" : ""}`;
        const style = animate ? ({ "--col": col } as CSSProperties) : undefined;
        if (interactive && outcome) {
          return (
            <button
              key={year}
              type="button"
              aria-pressed={selected}
              aria-label={cellLabel ? cellLabel(outcome) : String(year)}
              onClick={() => onSelectYear(year)}
              style={style}
              className={`${classes} cursor-pointer transition-opacity`}
            >
              <span aria-hidden="true">{cell.mark}</span>
            </button>
          );
        }
        return (
          <span key={year} aria-hidden="true" style={style} className={classes}>
            {cell.mark}
          </span>
        );
      })}
    </div>
  );
}

/** Year labels under a set of strips: the first year, then every fifth. */
export function SeasonAxis({
  years,
  selectedYear = null,
  className = "",
}: {
  years: readonly number[];
  selectedYear?: number | null;
  className?: string;
}) {
  return (
    <div aria-hidden="true" style={columns(years.length)} className={`grid gap-[3px] text-xs tabular-nums text-ink-muted ${className}`}>
      {years.map((year, index) => (
        <span key={year} className={`overflow-visible whitespace-nowrap ${selectedYear === year ? "font-semibold text-ink" : ""}`}>
          {index === 0 || year % 5 === 0 || selectedYear === year ? year : ""}
        </span>
      ))}
    </div>
  );
}

/** The words behind the marks. Labels come from the caller's translations. */
export function SeasonLegend({
  labels,
  className = "",
}: {
  labels: Record<Status, string> & { lowEvidence?: string };
  className?: string;
}) {
  const items: { key: string; swatch: string; mark: string; text: string }[] = (
    ["good", "watch", "bad", "no_data"] as const
  ).map((status) => ({ key: status, swatch: CELL[status].className, mark: CELL[status].mark, text: labels[status] }));
  if (labels.lowEvidence) items.push({ key: "low", swatch: FAINT.watch ?? "", mark: "!", text: labels.lowEvidence });
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted ${className}`}>
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`flex h-4 w-4 items-center justify-center rounded-[3px] text-[10px] font-bold leading-none ${item.swatch}`}
          >
            {item.mark}
          </span>
          {item.text}
        </li>
      ))}
    </ul>
  );
}
