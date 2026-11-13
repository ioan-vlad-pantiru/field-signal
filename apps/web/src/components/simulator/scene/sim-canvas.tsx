"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { Crop } from "@/lib/contracts";
import type { FieldWorkPlan } from "@/lib/sim/path-planner";
import { sceneStateAt, type SceneState } from "@/lib/sim/scene-state";
import type { Timeline } from "@/lib/sim/timeline";
import type { SimClock } from "../sim-clock";
import { CameraRig, type CameraMode } from "./camera-rig";
import { Plants, RowStrips, useCropLooks, type FrameSource } from "./field-work";
import { Fence, Ground, HORIZON, Sky, Surroundings } from "./landscape";
import { Tractor } from "./tractor";

export interface SimCanvasProps {
  plan: FieldWorkPlan;
  timeline: Timeline;
  sequence: readonly Crop[];
  clock: SimClock;
  camera: CameraMode;
  /** Render continuously (playing and visible); otherwise only on change. */
  live: boolean;
  lowDetail: boolean;
  reducedMotion: boolean;
  onContextLost?: () => void;
  onReady?: () => void;
}

function frameSource(clock: SimClock, timeline: Timeline, plan: FieldWorkPlan): FrameSource {
  let t = clock.time;
  let state: SceneState = sceneStateAt(timeline, plan, t);
  return {
    get: () => {
      if (clock.time !== t) {
        t = clock.time;
        state = sceneStateAt(timeline, plan, t);
      }
      return state;
    },
  };
}

/** Re-renders a paused scene when the clock is scrubbed. */
function InvalidateOnClock({ clock }: { clock: SimClock }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => clock.subscribe(() => invalidate()), [clock, invalidate]);
  return null;
}

function ContextLossWatcher({ onLost }: { onLost?: () => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!onLost) return;
    const canvas = gl.domElement;
    const handler = (e: Event) => {
      e.preventDefault();
      onLost();
    };
    canvas.addEventListener("webglcontextlost", handler);
    return () => canvas.removeEventListener("webglcontextlost", handler);
  }, [gl, onLost]);
  return null;
}

export default function SimCanvas({
  plan,
  timeline,
  sequence,
  clock,
  camera,
  live,
  lowDetail,
  reducedMotion,
  onContextLost,
  onReady,
}: SimCanvasProps) {
  const looks = useCropLooks(sequence);

  // Scene state computed at most once per clock value, shared by every component in the frame.
  const frame = useMemo(() => frameSource(clock, timeline, plan), [clock, timeline, plan]);

  return (
    <Canvas
      frameloop={live ? "always" : "demand"}
      dpr={lowDetail ? [1, 1.5] : [1, 2]}
      gl={{ antialias: !lowDetail, powerPreference: "high-performance" }}
      camera={{ fov: 45, near: 0.5, far: 6000, position: [-180, 160, 260] }}
      aria-hidden="true"
      onCreated={() => onReady?.()}
    >
      <fog attach="fog" args={[HORIZON, 450, 2400]} />
      <hemisphereLight args={["#e4eef4", "#6b5a45", 1.5]} />
      <directionalLight position={[240, 320, 140]} intensity={2.1} color="#fff1d6" />
      <Sky />
      <Ground plan={plan} />
      <Fence outline={plan.outline} />
      <Surroundings outline={plan.outline} treeCount={lowDetail ? 36 : 80} />
      <RowStrips plan={plan} frame={frame} looks={looks} />
      <Plants plan={plan} frame={frame} looks={looks} maxInstances={lowDetail ? 3500 : 11000} />
      <Tractor frame={frame} workingWidthM={plan.workingWidthM} />
      <CameraRig mode={camera} outline={plan.outline} frame={frame} instant={reducedMotion} />
      <InvalidateOnClock clock={clock} />
      <ContextLossWatcher onLost={onContextLost} />
    </Canvas>
  );
}
