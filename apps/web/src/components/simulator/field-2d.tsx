"use client";

import { useMemo } from "react";
import { CROP_COLORS } from "@/lib/crops";
import { bounds } from "@/lib/sim/geometry";
import type { FieldWorkPlan } from "@/lib/sim/path-planner";
import type { SceneState } from "@/lib/sim/scene-state";

export const SOIL_2D = "#7a5b40";
export const DRILLED_2D = "#5b4231";
export const STUBBLE_2D = "#d8c48f";

/** The path as "x,y" pairs (SVG y points down, so north is flipped) up to distance `d`. */
function pathUpTo(plan: FieldWorkPlan, d: number): string {
  const out: string[] = [];
  const path = plan.path;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (p.d <= d) {
      out.push(`${p.x.toFixed(1)},${(-p.y).toFixed(1)}`);
      continue;
    }
    const a = path[i - 1];
    if (a) {
      const t = (d - a.d) / (p.d - a.d);
      out.push(`${(a.x + (p.x - a.x) * t).toFixed(1)},${(-(a.y + (p.y - a.y) * t)).toFixed(1)}`);
    }
    break;
  }
  return out.join(" ");
}

/**
 * Flat top-down view of the same simulation: used when WebGL is unavailable. The worked path is
 * drawn with a stroke as wide as the drill, so coverage reads exactly like the 3D view.
 */
export function Field2D({ plan, state, label }: { plan: FieldWorkPlan; state: SceneState; label: string }) {
  const b = useMemo(() => bounds(plan.outline), [plan]);
  const pad = 16;
  const viewBox = `${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`;
  const outline = plan.outline.map(([x, y]) => `${x},${-y}`).join(" ");
  const interior = plan.interior.map(([x, y]) => `${x},${-y}`).join(" ");
  const cropColor = CROP_COLORS[state.crop];
  const sownColor = state.growth > 0.2 ? cropColor : DRILLED_2D;
  const w = plan.workingWidthM;
  const { tractor } = state;

  return (
    <svg viewBox={viewBox} role="img" aria-label={label} className="h-full w-full">
      <defs>
        <clipPath id="field-clip">
          <polygon points={outline} />
        </clipPath>
      </defs>
      <rect x={b.minX - pad} y={-b.maxY - pad} width={b.maxX - b.minX + pad * 2} height={b.maxY - b.minY + pad * 2} fill="#9db27a" />
      <polygon points={outline} fill={SOIL_2D} stroke="#8b7355" strokeWidth={2} />
      <g clipPath="url(#field-clip)" fill="none" strokeLinejoin="round" strokeWidth={w}>
        {state.sowD > 0 ? <polyline points={pathUpTo(plan, state.sowD)} stroke={sownColor} opacity={0.35 + 0.65 * Math.min(1, state.growth + 0.3)} /> : null}
        {state.harvestD > 0 ? <polyline points={pathUpTo(plan, state.harvestD)} stroke={STUBBLE_2D} /> : null}
      </g>
      <polygon points={interior} fill="none" stroke="#efe6d2" strokeWidth={1.2} strokeDasharray="5 4" />
      <g transform={`translate(${tractor.x} ${-tractor.y}) rotate(${(-tractor.heading * 180) / Math.PI})`}>
        <circle r={9} fill="#ffffff" opacity={0.75} />
        <rect x={-3} y={-1.6} width={6} height={3.2} rx={0.8} fill="#3b4045" />
        <rect x={0.8} y={-1.2} width={2} height={2.4} fill="#e4ddcc" />
      </g>
    </svg>
  );
}
