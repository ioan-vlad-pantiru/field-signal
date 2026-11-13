"use client";

import { useId, type ReactNode } from "react";

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  valueText,
  hint,
}: {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  valueText: string;
  hint?: ReactNode;
}) {
  const id = useId();
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <span className="tabular-nums text-ink-muted" aria-hidden="true">
          {valueText}
        </span>
      </div>
      {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
      <input
        id={id}
        type="range"
        className="slider w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--fill": fill } as React.CSSProperties}
      />
    </div>
  );
}
