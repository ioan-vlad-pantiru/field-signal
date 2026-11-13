"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 900;

/**
 * Animates a number from its previous value to `target` (from 0 on first render).
 * Resolves instantly when the user prefers reduced motion.
 */
export function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = from.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = start + (target - start) * eased;
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}
