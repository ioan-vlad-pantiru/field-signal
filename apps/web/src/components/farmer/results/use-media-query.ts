"use client";

import { useSyncExternalStore } from "react";

/**
 * Laptop layout from Tailwind's `lg` breakpoint up: below it season cells are too narrow to tap,
 * so phones and tablets get the overview strips and the year sheet instead.
 */
export const LAPTOP = "(min-width: 1024px)";

/** Whether a media query matches; `false` on the server and before hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
