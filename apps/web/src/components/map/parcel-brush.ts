"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Parcel } from "@/lib/contracts";

export interface ParcelBrushOptions {
  /** The fill layer whose features carry the parcel id in `properties.id`. */
  layer: string;
  /** The full parcel for an id on screen. */
  parcel: (id: number) => Parcel | undefined;
  /** Whether a parcel is selected now: a drag that starts on one removes instead of adds. */
  isSelected: (id: number) => boolean;
  /** Parcels a drag passed over, each reported once per drag. */
  onStroke: (parcels: Parcel[], action: "add" | "remove") => void;
  /** A tap (no drag) on a parcel. */
  onTap: (parcel: Parcel) => void;
}

/** Below this many pixels of movement a press is a tap, not a drag. */
const TAP_PX = 4;

/**
 * Drag-to-select on a MapLibre map: while `enabled`, one finger or the mouse paints over parcels
 * instead of moving the map; two fingers still zoom. Fast drags are sampled every few pixels so
 * no parcel in between is skipped.
 */
export function useParcelBrush(map: MapLibreMap | null, enabled: boolean, options: ParcelBrushOptions) {
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  useEffect(() => {
    if (!map || !enabled) return;
    map.dragPan.disable();
    map.dragRotate.disable();
    const canvas = map.getCanvasContainer();
    let stroke: {
      id: number;
      action: "add" | "remove";
      last: [number, number];
      moved: number;
      seen: Set<number>;
    } | null = null;
    const pointers = new Set<number>();

    const at = (event: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [event.clientX - r.left, event.clientY - r.top];
    };
    const parcelsAlong = (a: [number, number], b: [number, number]): Parcel[] => {
      if (!map.getLayer(opts.current.layer)) return [];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      const found = new Map<number, Parcel>();
      for (let i = 0; i <= steps; i++) {
        const x = a[0] + ((b[0] - a[0]) * i) / steps;
        const y = a[1] + ((b[1] - a[1]) * i) / steps;
        for (const f of map.queryRenderedFeatures([x, y], { layers: [opts.current.layer] })) {
          const parcel = opts.current.parcel(Number(f.properties?.id));
          if (parcel) found.set(parcel.id, parcel);
        }
      }
      return [...found.values()];
    };

    const down = (event: PointerEvent) => {
      pointers.add(event.pointerId);
      if (pointers.size > 1) {
        // A second finger: this is a zoom or pan, not a selection.
        stroke = null;
        map.dragPan.enable();
        return;
      }
      const point = at(event);
      const first = parcelsAlong(point, point)[0];
      stroke = {
        id: event.pointerId,
        action: first && opts.current.isSelected(first.id) ? "remove" : "add",
        last: point,
        moved: 0,
        seen: new Set(),
      };
      canvas.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!stroke || event.pointerId !== stroke.id) return;
      const point = at(event);
      stroke.moved += Math.hypot(point[0] - stroke.last[0], point[1] - stroke.last[1]);
      if (stroke.moved >= TAP_PX) {
        const current = stroke;
        const fresh = parcelsAlong(current.last, point).filter((p) => !current.seen.has(p.id));
        fresh.forEach((p) => current.seen.add(p.id));
        if (fresh.length > 0) opts.current.onStroke(fresh, current.action);
      }
      stroke.last = point;
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size === 0) map.dragPan.disable();
      if (!stroke || event.pointerId !== stroke.id) return;
      if (stroke.moved < TAP_PX) {
        const parcel = parcelsAlong(stroke.last, stroke.last)[0];
        if (parcel) opts.current.onTap(parcel);
      }
      stroke = null;
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    const cursor = map.getCanvas().style.cursor;
    map.getCanvas().style.cursor = "cell";
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      map.getCanvas().style.cursor = cursor;
      map.dragPan.enable();
      map.dragRotate.enable();
    };
  }, [map, enabled]);
}
