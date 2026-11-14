"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { FieldRequest, LatLon } from "@/lib/contracts";

/** The last field, rotation and priorities, kept on this device only. */
export interface SavedField {
  request: FieldRequest;
  boundary: LatLon[];
  /** Name of the nearest commune when it was saved. */
  near: string | null;
}

const KEY = "field-signal.last-field.v1";
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): SavedField | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SavedField;
    const ok =
      Array.isArray(value.boundary) &&
      value.boundary.length >= 3 &&
      value.request?.location != null &&
      Array.isArray(value.request.current_rotation);
    return ok ? value : null;
  } catch {
    return null;
  }
}

export function saveField(field: SavedField) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(field));
  } catch {
    // Private mode or full storage: the farmer just draws again next time.
  }
  listeners.forEach((notify) => notify());
}

export function forgetField() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

/** The saved field, or null; always null while prerendering. */
export function useSavedField(): SavedField | null {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  // The snapshot is the raw string, which compares stable between renders.
  return useMemo(() => parse(raw), [raw]);
}
