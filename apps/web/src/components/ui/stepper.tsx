import { CheckIcon } from "./icons";

/** "1 Field · 2 Rotation · 3 Priorities". Finished steps can be reopened when `onSelect` is given. */
export function Stepper({
  label,
  steps,
  current,
  onSelect,
}: {
  /** Accessible name for the list. */
  label: string;
  steps: readonly string[];
  /** Index of the step being worked on. */
  current: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const content = (
          <>
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
                done ? "bg-field text-on-field" : active ? "bg-ink text-surface" : "bg-surface-sunken text-ink-muted"
              }`}
            >
              {done ? <CheckIcon size={16} /> : index + 1}
            </span>
            <span className={active ? "font-semibold" : done ? "" : "text-ink-muted"}>{step}</span>
          </>
        );
        return (
          <li key={step} aria-current={active ? "step" : undefined}>
            {done && onSelect ? (
              <button type="button" onClick={() => onSelect(index)} className="press flex min-h-11 items-center gap-2 rounded-lg">
                {content}
              </button>
            ) : (
              <span className="flex min-h-11 items-center gap-2">{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
