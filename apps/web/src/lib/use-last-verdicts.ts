"use client";

import { useMemo, useSyncExternalStore } from "react";
import { LAST_VERDICT_KEY, parseVerdicts, withVerdict, type LastVerdict } from "./last-verdict";
import { poorSeasons, type Verdict } from "./results";

const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.localStorage.getItem(LAST_VERDICT_KEY);
  } catch {
    return null;
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

/** Each field's last answer on this device, by My fields id (or LOCAL_FIELD). */
export function useLastVerdicts(): Record<string, LastVerdict> {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  return useMemo(() => parseVerdicts(raw), [raw]);
}

/** Remember the answer just shown for a field. Storage failures are ignored: it is a convenience. */
export function rememberVerdict(id: string, v: Verdict) {
  const entry: LastVerdict = {
    kind: v.kind,
    best: [...v.best.sequence],
    bestPoor: poorSeasons(v.best),
    currentPoor: poorSeasons(v.current),
    at: new Date().toISOString().slice(0, 10),
  };
  try {
    window.localStorage.setItem(LAST_VERDICT_KEY, JSON.stringify(withVerdict(parseVerdicts(read()), id, entry)));
  } catch {
    return;
  }
  listeners.forEach((notify) => notify());
}
