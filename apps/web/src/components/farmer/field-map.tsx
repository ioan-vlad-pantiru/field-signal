"use client";

import { useEffect, useRef } from "react";
import { Marker } from "maplibre-gl";
import type { LatLon } from "@/lib/contracts";
import { useMap } from "@/components/map/use-map";

/** Tap the map to move the field pin. The pin can also be dragged. */
export function FieldMap({
  value,
  onChange,
  label,
}: {
  value: LatLon;
  onChange: (point: LatLon) => void;
  label: string;
}) {
  const { container, map } = useMap([value.lon, value.lat], 11);
  const marker = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!map) return;
    const pin = new Marker({ color: "#1f6b45", draggable: true, className: "field-pin" })
      .setLngLat([value.lon, value.lat])
      .addTo(map);
    const emit = (lng: number, lat: number) =>
      onChangeRef.current({ lat: Number(lat.toFixed(4)), lon: Number(lng.toFixed(4)) });
    pin.on("dragend", () => {
      const { lng, lat } = pin.getLngLat();
      emit(lng, lat);
    });
    map.on("click", (event) => emit(event.lngLat.lng, event.lngLat.lat));
    marker.current = pin;
    return () => {
      pin.remove();
      marker.current = null;
    };
    // The marker is created once per map; position updates happen in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    const pin = marker.current;
    if (!pin) return;
    pin.setLngLat([value.lon, value.lat]);
    // Replay the drop animation on the pin's icon each time it moves.
    const icon = pin.getElement().firstElementChild as HTMLElement | null;
    if (icon) {
      icon.style.animation = "none";
      void icon.offsetWidth;
      icon.style.animation = "";
    }
  }, [value]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={label}
      className="h-64 w-full overflow-hidden rounded-2xl border border-line bg-surface-sunken sm:h-80"
    />
  );
}
