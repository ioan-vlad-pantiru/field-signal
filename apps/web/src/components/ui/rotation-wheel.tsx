"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Crop } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";

/** Ring radii in a 100 × 100 box centred on 0,0. */
const OUTER = 48;
const INNER = 23;
/** Degrees left empty between two years, so repeated crops still read as separate years. */
const GAP = 4;

type Glyph = "cereal" | "maize" | "pod" | "sunflower" | "sprout" | "soil";

const GLYPH: Record<Crop, Glyph> = {
  wheat: "cereal",
  barley: "cereal",
  maize: "maize",
  soybean: "pod",
  pea: "pod",
  cover_vetch: "pod",
  sunflower: "sunflower",
  cover_mustard: "sprout",
  cover_phacelia: "sprout",
  fallow: "soil",
};

/** Each crop family as a small mark drawn in a 24 × 24 box. */
function GlyphMark({ glyph }: { glyph: Glyph }): ReactNode {
  switch (glyph) {
    case "cereal":
      return (
        <>
          <path d="M12 22V5" fill="none" />
          {[7, 11.5, 16].map((y) => (
            <g key={y}>
              <ellipse
                cx="9.4"
                cy={y}
                rx="1.9"
                ry="3"
                transform={`rotate(-32 9.4 ${y})`}
              />
              <ellipse
                cx="14.6"
                cy={y}
                rx="1.9"
                ry="3"
                transform={`rotate(32 14.6 ${y})`}
              />
            </g>
          ))}
        </>
      );
    case "maize":
      return (
        <>
          <ellipse cx="12" cy="10" rx="3.6" ry="7" />
          <path
            d="M12 22c-4-1.5-6.5-5-6.5-10M12 22c4-1.5 6.5-5 6.5-10"
            fill="none"
          />
        </>
      );
    case "pod":
      return (
        <>
          <path
            d="M4 17c3.5-8 11-11.5 16-10.5-1.5 5-7.5 11.5-16 10.5z"
            fill="none"
          />
          <circle cx="8.6" cy="14.2" r="1.7" />
          <circle cx="12" cy="11.6" r="1.7" />
          <circle cx="15.4" cy="9.2" r="1.7" />
        </>
      );
    case "sunflower":
      return (
        <>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <ellipse
              key={a}
              cx="12"
              cy="5.2"
              rx="1.9"
              ry="3"
              transform={`rotate(${a} 12 12)`}
            />
          ))}
          <circle cx="12" cy="12" r="3.6" />
        </>
      );
    case "sprout":
      return (
        <>
          <path d="M12 22v-9" fill="none" />
          <path d="M12 13C12 8.5 9 6 4.5 6c0 4.5 3 7 7.5 7zM12 11c0-3.5 2.6-6 7-6 0 3.5-2.6 6-7 6z" />
        </>
      );
    case "soil":
      return (
        <path
          d="M3 9c3-2 6 2 9 0s6-2 9 0M3 14c3-2 6 2 9 0s6-2 9 0M6 19c2-1.4 4 1.4 6 0s4-1.4 6 0"
          fill="none"
        />
      );
  }
}

/** Dark marks on light crop colours, light marks on dark ones. */
function markColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "rgba(20, 24, 20, 0.78)" : "rgba(255, 255, 255, 0.92)";
}

function point(angle: number, radius: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [radius * Math.cos(rad), radius * Math.sin(rad)];
}

/** One year as a ring segment from `from`° to `to`° (0° = 3 o'clock, clockwise). */
function segment(from: number, to: number): string {
  const large = to - from > 180 ? 1 : 0;
  const [x1, y1] = point(from, OUTER);
  const [x2, y2] = point(to, OUTER);
  const [x3, y3] = point(to, INNER);
  const [x4, y4] = point(from, INNER);
  const f = (n: number) => n.toFixed(2);
  return `M${f(x1)} ${f(y1)}A${OUTER} ${OUTER} 0 ${large} 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${INNER} ${INNER} 0 ${large} 0 ${f(x4)} ${f(y4)}Z`;
}

/** The accessible sentence for a rotation: "3-year rotation: year 1 barley, …, then it repeats". */
export function useRotationLabel() {
  const t = useTranslations("Common");
  const crops = useTranslations("Crops");
  return (sequence: readonly Crop[]) =>
    t("wheel", {
      count: sequence.length,
      crops: sequence
        .map((crop, i) => t("wheelYear", { n: i + 1, crop: crops(crop) }))
        .join(", "),
    });
}

/**
 * A rotation as a ring: one coloured segment per year, starting at the top and going clockwise,
 * each with its crop's mark; the arrow in the middle says the cycle starts over.
 * Colours match the crop dots and the field plan map.
 */
export function RotationWheel({
  sequence,
  size = 72,
  animate = false,
  className = "",
}: {
  sequence: readonly Crop[];
  /** Diameter in CSS pixels. */
  size?: number;
  /** Draw the years in one after another on mount. */
  animate?: boolean;
  className?: string;
}) {
  const label = useRotationLabel()(sequence);
  const step = 360 / sequence.length;
  const mark = (OUTER - INNER) * 1.08;
  // Small wheels (a field card, a plan row) keep only the coloured years: marks would blur.
  const detailed = size >= 56;
  return (
    <svg
      viewBox="-50 -50 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={`shrink-0 overflow-visible ${className}`}
    >
      {sequence.map((crop, i) => {
        const from = -90 + i * step + GAP / 2;
        const to = -90 + (i + 1) * step - GAP / 2;
        const [cx, cy] = point((from + to) / 2, (OUTER + INNER) / 2);
        const color = CROP_COLORS[crop];
        const ink = markColor(color);
        const style = animate ? ({ "--i": i } as CSSProperties) : undefined;
        return (
          <g key={i} className={animate ? "wheel-in" : undefined} style={style}>
            <path d={segment(from, to)} fill={color} />
            {detailed ? (
              <g
                transform={`translate(${cx - mark / 2} ${cy - mark / 2}) scale(${mark / 24})`}
                fill={ink}
                stroke={ink}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <GlyphMark glyph={GLYPH[crop]} />
              </g>
            ) : null}
          </g>
        );
      })}
      {/* Starts over: a clockwise arrow round the centre. */}
      {detailed ? (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={3.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-muted"
        >
          <path d="M0 -13A13 13 0 1 1 -12.2 -4.4" />
          <path d="M-17.6 -1.9L-12.2 -4.4L-9.7 1" />
        </g>
      ) : null}
    </svg>
  );
}

/** The years in order, numbered, for a wheel that needs its crops spelled out. */
export function RotationLegend({
  sequence,
  className = "",
}: {
  sequence: readonly Crop[];
  className?: string;
}) {
  const t = useTranslations("Common");
  const crops = useTranslations("Crops");
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <ol className="flex flex-col gap-1" aria-label={t("sequence")}>
        {sequence.map((crop, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-4 text-right text-sm tabular-nums text-ink-muted">
              {i + 1}
            </span>
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full ring-1 ring-ink/15"
              style={{ background: CROP_COLORS[crop] }}
            />
            <span className="font-semibold">{crops(crop)}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-ink-muted">
        {t("repeats", { count: sequence.length })}
      </p>
    </div>
  );
}
