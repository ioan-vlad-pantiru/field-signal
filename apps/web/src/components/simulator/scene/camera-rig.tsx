"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { bounds, type Polygon } from "@/lib/sim/geometry";
import type { FrameSource } from "./field-work";

export type CameraMode = "overview" | "follow" | "top";

/**
 * Camera presets. Overview and top-down glide to a framing of the field and then hand over to
 * touch/mouse orbit; follow trails the tractor. With reduced motion the camera jumps instead.
 */
export function CameraRig({
  mode,
  outline,
  frame,
  instant,
}: {
  mode: CameraMode;
  outline: Polygon;
  frame: FrameSource;
  instant: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const goal = useRef<{ pos: Vector3; target: Vector3 } | null>(null);
  const heading = useRef<number | null>(null);
  const tmp = useMemo(() => ({ pos: new Vector3(), look: new Vector3() }), []);

  const framing = useMemo(() => {
    const b = bounds(outline);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const r = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
    // Portrait screens need to stand further back to fit the field's width.
    const k = aspect < 1 ? Math.min(2.4, 1.35 / aspect) : 1;
    return {
      target: new Vector3(cx, 0, -cy),
      overview: new Vector3(cx - 0.6 * r * k, 1.0 * r * k, -cy + 1.35 * r * k),
      top: new Vector3(cx, 2.3 * r * k, -cy + 1),
    };
  }, [outline, aspect]);

  useEffect(() => {
    if (mode === "follow") {
      goal.current = null;
    } else {
      goal.current = { pos: mode === "top" ? framing.top : framing.overview, target: framing.target };
    }
    invalidate();
  }, [mode, framing, invalidate]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (mode === "follow") {
      const { tractor } = frame.get();
      // The tractor moves in time-lapse, so stay locked to it and only smooth the heading,
      // otherwise every headland turn would whip the camera round.
      const h = heading.current ?? tractor.heading;
      const diff = Math.atan2(Math.sin(tractor.heading - h), Math.cos(tractor.heading - h));
      const smoothed = instant ? tractor.heading : h + diff * (1 - Math.exp(-dt * 2.5));
      heading.current = smoothed;
      const fx = Math.cos(smoothed);
      const fz = -Math.sin(smoothed);
      tmp.pos.set(tractor.x - fx * 30, 16, -tractor.y - fz * 30);
      tmp.look.set(tractor.x + fx * 6, 1, -tractor.y + fz * 6);
      camera.position.copy(tmp.pos);
      camera.lookAt(tmp.look);
      c?.target.copy(tmp.look);
      if (Math.abs(diff) > 0.01) invalidate();
      return;
    }
    const g = goal.current;
    if (!g || !c) return;
    const k = instant ? 1 : 1 - Math.exp(-dt * 4);
    camera.position.lerp(g.pos, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.pos) < 0.5) goal.current = null;
    else invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={mode !== "follow"}
      enableDamping={!instant}
      maxPolarAngle={1.42}
      minDistance={12}
      maxDistance={1400}
      onStart={() => {
        // The user took over: stop gliding to the preset.
        goal.current = null;
      }}
    />
  );
}
