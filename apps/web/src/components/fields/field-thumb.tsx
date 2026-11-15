import type { LatLon } from "@/lib/contracts";
import { fieldRings } from "@/lib/geo";
import { shapePath } from "@/lib/shape-path";

/** The field's own outline as a small rounded tile, so each card is recognisable at a glance. */
export function FieldThumb({ boundary, parts = [], size = 56 }: { boundary: LatLon[]; parts?: LatLon[][]; size?: number }) {
  const d = shapePath(fieldRings({ boundary, parts }), 48, 6);
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-field-soft text-field"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 48 48" width={size - 8} height={size - 8}>
        <path d={d} fill="currentColor" fillOpacity={0.22} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      </svg>
    </span>
  );
}
