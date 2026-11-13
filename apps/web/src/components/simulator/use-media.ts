"use client";

import { useSyncExternalStore } from "react";

/** Live `matchMedia` result; `serverValue` is used during SSR and the first client render. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}

let webglCache: boolean | null = null;

/** Whether this browser can create a WebGL context. Checked once, client-side only. */
export function useWebGLSupport(): boolean | null {
  return useSyncExternalStore(
    () => () => {},
    () => {
      if (webglCache === null) {
        try {
          const canvas = document.createElement("canvas");
          webglCache = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
        } catch {
          webglCache = false;
        }
      }
      return webglCache;
    },
    () => null,
  );
}
