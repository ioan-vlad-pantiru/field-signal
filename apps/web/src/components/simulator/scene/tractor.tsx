"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { FrameSource } from "./field-work";

/**
 * An original, generic tractor built from boxes and cylinders: graphite chassis, warm off-white
 * bonnet and cab, no logos, no brand colour scheme. Local +X is forward; origin is the rear axle
 * on the ground. Real-world size (about 4.5 m long) so it matches the 6 m drill.
 */

const GRAPHITE = "#3b4045";
const CREAM = "#e4ddcc";
const WARM_GREY = "#a39b8c";
const TYRE = "#25292d";
const HUB = "#8d9196";
/** The tractor is drawn larger than life so it reads from the overview; the implement is
 * shrunk by the same factor so it still covers exactly one working width. */
const SCALE = 1.6;
const REAR_R = 0.85;
const FRONT_R = 0.52;

function Wheel({ r, width, x, z, spin }: { r: number; width: number; x: number; z: number; spin: React.Ref<Group> }) {
  return (
    <group position={[x, r, z]}>
      <group ref={spin}>
        <mesh rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[r, r, width, 14]} />
          <meshLambertMaterial color={TYRE} />
        </mesh>
        <mesh rotation-x={Math.PI / 2} position-z={z > 0 ? width / 2 + 0.01 : -width / 2 - 0.01}>
          <cylinderGeometry args={[r * 0.5, r * 0.5, 0.04, 8]} />
          <meshLambertMaterial color={HUB} />
        </mesh>
      </group>
    </group>
  );
}

function SeedDrill({ width }: { width: number }) {
  const discs = Array.from({ length: 12 }, (_, i) => -width / 2 + width * ((i + 0.5) / 12));
  return (
    <group position-x={-2.6}>
      <mesh position={[0.9, 0.6, 0]}>
        <boxGeometry args={[1.4, 0.14, 0.14]} />
        <meshLambertMaterial color={GRAPHITE} />
      </mesh>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.45, 0.22, width]} />
        <meshLambertMaterial color={GRAPHITE} />
      </mesh>
      <mesh position={[0.05, 1.12, 0]}>
        <boxGeometry args={[1.0, 0.85, width - 0.4]} />
        <meshLambertMaterial color={WARM_GREY} />
      </mesh>
      <mesh position={[0.05, 1.57, 0]}>
        <boxGeometry args={[1.08, 0.06, width - 0.3]} />
        <meshLambertMaterial color={CREAM} />
      </mesh>
      {discs.map((z) => (
        <mesh key={z} position={[-0.25, 0.26, z]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.26, 0.26, 0.04, 10]} />
          <meshLambertMaterial color={HUB} />
        </mesh>
      ))}
    </group>
  );
}

function Header({ width }: { width: number }) {
  return (
    <group position-x={3.3}>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[1.0, 0.45, width]} />
        <meshLambertMaterial color={WARM_GREY} />
      </mesh>
      <mesh position={[0.25, 0.95, 0]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.32, 0.32, width - 0.2, 10]} />
        <meshLambertMaterial color={GRAPHITE} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0, 0.7, (side * width) / 2]}>
          <boxGeometry args={[1.1, 1.0, 0.06]} />
          <meshLambertMaterial color={CREAM} />
        </mesh>
      ))}
      <mesh position={[-0.9, 0.9, 0]}>
        <boxGeometry args={[1.2, 0.3, 1.0]} />
        <meshLambertMaterial color={GRAPHITE} />
      </mesh>
    </group>
  );
}

export function Tractor({ frame, workingWidthM }: { frame: FrameSource; workingWidthM: number }) {
  const root = useRef<Group>(null);
  const drill = useRef<Group>(null);
  const header = useRef<Group>(null);
  const rearL = useRef<Group>(null);
  const rearR = useRef<Group>(null);
  const frontL = useRef<Group>(null);
  const frontR = useRef<Group>(null);
  const marker = useRef<Group>(null);
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const { tractor } = frame.get();
    const g = root.current;
    if (!g) return;
    g.position.set(tractor.x, 0, -tractor.y);
    g.rotation.y = tractor.heading;
    const m = marker.current;
    if (m) {
      // Keep the marker a similar size on screen whatever the zoom.
      m.position.set(tractor.x, 0, -tractor.y);
      const dist = camera.position.distanceTo(m.position);
      const k = Math.min(8, Math.max(1, dist / 110));
      m.visible = dist > 140;
      m.scale.setScalar(k);
    }
    if (drill.current) drill.current.visible = tractor.implement === "drill";
    if (header.current) header.current.visible = tractor.implement === "header";
    for (const w of [rearL.current, rearR.current]) if (w) w.rotation.z = -tractor.d / (REAR_R * SCALE);
    for (const w of [frontL.current, frontR.current]) if (w) w.rotation.z = -tractor.d / (FRONT_R * SCALE);
  });

  return (
    <>
    {/* Marker so the tractor is easy to find from far away: a ring and a pin above it. */}
    <group ref={marker}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.2}>
        <ringGeometry args={[6.5, 7.8, 40]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.7} depthWrite={false} />
      </mesh>
      <mesh position-y={11} rotation-x={Math.PI}>
        <coneGeometry args={[1.8, 4, 4]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
    <group ref={root}>
      <group scale={SCALE}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.13}>
        <circleGeometry args={[2.6, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} depthWrite={false} />
      </mesh>

      {/* Chassis, bonnet, cab */}
      <mesh position={[0.8, 0.95, 0]}>
        <boxGeometry args={[3.2, 0.5, 0.95]} />
        <meshLambertMaterial color={GRAPHITE} />
      </mesh>
      <mesh position={[1.45, 1.45, 0]}>
        <boxGeometry args={[1.9, 0.85, 0.9]} />
        <meshLambertMaterial color={CREAM} />
      </mesh>
      <mesh position={[2.42, 1.35, 0]}>
        <boxGeometry args={[0.06, 0.5, 0.7]} />
        <meshLambertMaterial color={GRAPHITE} />
      </mesh>
      <mesh position={[-0.15, 1.35, 0]}>
        <boxGeometry args={[1.5, 0.3, 1.5]} />
        <meshLambertMaterial color={GRAPHITE} />
      </mesh>
      <mesh position={[-0.15, 2.25, 0]}>
        <boxGeometry args={[1.35, 1.5, 1.35]} />
        <meshLambertMaterial color="#9fb6c2" transparent opacity={0.55} />
      </mesh>
      <mesh position={[-0.15, 3.05, 0]}>
        <boxGeometry args={[1.6, 0.14, 1.6]} />
        <meshLambertMaterial color={CREAM} />
      </mesh>
      <mesh position={[-0.15, 3.18, 0.5]}>
        <cylinderGeometry args={[0.09, 0.09, 0.14, 8]} />
        <meshBasicMaterial color="#f0a43a" />
      </mesh>
      <mesh position={[1.2, 2.2, 0.32]}>
        <cylinderGeometry args={[0.05, 0.05, 1.1, 6]} />
        <meshLambertMaterial color={GRAPHITE} />
      </mesh>

      <Wheel r={REAR_R} width={0.5} x={0} z={0.9} spin={rearL} />
      <Wheel r={REAR_R} width={0.5} x={0} z={-0.9} spin={rearR} />
      <Wheel r={FRONT_R} width={0.32} x={2.0} z={0.75} spin={frontL} />
      <Wheel r={FRONT_R} width={0.32} x={2.0} z={-0.75} spin={frontR} />

      <group ref={drill} visible={false}>
        <SeedDrill width={workingWidthM / SCALE} />
      </group>
      <group ref={header} visible={false}>
        <Header width={workingWidthM / SCALE} />
      </group>
      </group>
    </group>
    </>
  );
}
