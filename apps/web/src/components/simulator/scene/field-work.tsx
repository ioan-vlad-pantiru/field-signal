"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { Crop } from "@/lib/contracts";
import { sampleWork, type FieldWorkPlan } from "@/lib/sim/path-planner";
import type { SceneState } from "@/lib/sim/scene-state";
import { cropLook, plantMaterial, seeded, type CropLook } from "./crop-geometry";

export type FrameSource = { get: () => SceneState };

const UP = new Vector3(0, 1, 0);
/** Plants are drawn about twice life size so crop height differences read from the overview. */
const PLANT_SCALE = 2.2;

/**
 * The drilled rows: one flat strip per working stretch of the path, revealed by the shader as the
 * drill passes, then tinted towards the crop's canopy colour as it grows and to stubble after
 * harvest. This is what makes "bare soil" vs "covered" readable from any distance.
 */
export function RowStrips({ plan, frame, looks }: { plan: FieldWorkPlan; frame: FrameSource; looks: Map<Crop, CropLook> }) {
  const mesh = useRef<InstancedMesh>(null);
  const segments = useMemo(() => {
    const out: { x: number; y: number; heading: number; len: number; d0: number; lap: boolean }[] = [];
    const lapsFrom = passesEndD(plan);
    for (let i = 1; i < plan.path.length; i++) {
      const a = plan.path[i - 1];
      const b = plan.path[i];
      if (!b.working) continue;
      out.push({ x: a.x, y: a.y, heading: Math.atan2(b.y - a.y, b.x - a.x), len: b.d - a.d, d0: a.d, lap: a.d >= lapsFrom - 1e-6 });
    }
    return out;
  }, [plan]);

  const geometry = useMemo(() => {
    const g = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    g.setAttribute("aD0", new InstancedBufferAttribute(new Float32Array(segments.map((s) => s.d0)), 1));
    g.setAttribute("aLen", new InstancedBufferAttribute(new Float32Array(segments.map((s) => s.len)), 1));
    return g;
  }, [segments]);

  const strips = useMemo(() => stripMaterial(), []);
  const material = strips.material;

  useLayoutEffect(() => {
    const m = new Matrix4();
    const q = new Quaternion();
    segments.forEach((s, i) => {
      q.setFromAxisAngle(UP, s.heading);
      // Laps sit a hair above passes so overlapping corners don't flicker.
      m.compose(new Vector3(s.x, s.lap ? 0.05 : 0.04, -s.y), q, new Vector3(s.len, 1, plan.workingWidthM));
      mesh.current?.setMatrixAt(i, m);
    });
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true;
  }, [segments, plan.workingWidthM]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const st = frame.get();
    strips.update(st, looks.get(st.crop));
  });

  return <instancedMesh ref={mesh} args={[geometry, material, segments.length]} frustumCulled={false} />;
}

/**
 * Strip material: the shader reveals each strip up to the drill (`uSowD`), draws furrows across
 * the drill width, tints towards the canopy as the crop grows, and switches to stubble behind
 * the harvester (`uHarvD`). `update` copies the frame's state into the uniforms.
 */
function stripMaterial() {
  const uniforms = {
    uSowD: { value: -1 },
    uHarvD: { value: -1 },
    uCover: { value: 0 },
    uTilled: { value: new Color("#5b4231") },
    uCanopy: { value: new Color("#5f8f3b") },
    uStubble: { value: new Color("#c8b07a") },
  };
  const tmp = new Color();
  const material = new MeshLambertMaterial({ color: "#ffffff", polygonOffset: true, polygonOffsetFactor: -2 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      "attribute float aD0;\nattribute float aLen;\nvarying float vD;\nvarying float vAcross;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvD = aD0 + position.x * aLen;\nvAcross = position.z + 0.5;",
      );
    shader.fragmentShader =
      "uniform float uSowD;\nuniform float uHarvD;\nuniform float uCover;\nuniform vec3 uTilled;\nuniform vec3 uCanopy;\nuniform vec3 uStubble;\nvarying float vD;\nvarying float vAcross;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (vD > uSowD) discard;
        float f = abs(fract(vAcross * 8.0) - 0.5) * 2.0;
        float furrow = smoothstep(0.55, 1.0, f) * (1.0 - smoothstep(0.15, 0.45, fwidth(vAcross * 8.0)));
        vec3 col = mix(uTilled, uTilled * 0.72, furrow);
        col = mix(col, uCanopy * mix(1.0, 0.85, furrow), uCover);
        if (vD < uHarvD) col = mix(uStubble, uStubble * 0.78, furrow);
        diffuseColor.rgb = col;`,
      );
  };
  return {
    material,
    update(s: SceneState, look: CropLook | undefined) {
      uniforms.uSowD.value = s.sowD;
      uniforms.uHarvD.value = s.harvestD;
      uniforms.uCover.value = look ? Math.min(1, s.growth * 1.1) * look.cover : 0;
      if (look) {
        uniforms.uCanopy.value.set(look.canopy).lerp(tmp.set(look.ripe), s.ripe * 0.85);
        uniforms.uStubble.value.set("#ddd2b0");
      }
    },
  };
}

/** Path distance at the end of the last straight pass: the headland laps come after it. */
function passesEndD(plan: FieldWorkPlan) {
  let d = 0;
  const lastPass = plan.passes[plan.passes.length - 1];
  if (!lastPass) return 0;
  for (const p of plan.path) {
    if (Math.abs(p.x - lastPass.end[0]) < 1e-6 && Math.abs(p.y - lastPass.end[1]) < 1e-6) d = p.d;
  }
  return d;
}

/** Instanced plants for one crop; hidden unless that crop is on the field. */
function CropPlants({
  crop,
  look,
  plan,
  frame,
  maxInstances,
}: {
  crop: Crop;
  look: CropLook;
  plan: FieldWorkPlan;
  frame: FrameSource;
  maxInstances: number;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const samples = useMemo(() => {
    const offsets = [-plan.workingWidthM / 3, 0, plan.workingWidthM / 3];
    const spacing = Math.max(1.8, (plan.workingDistanceM * offsets.length) / maxInstances);
    return sampleWork(plan, spacing, offsets).slice(0, maxInstances);
  }, [plan, maxInstances]);

  const geometry = useMemo(() => {
    const g = look.geometry.clone();
    g.setAttribute("aSow", new InstancedBufferAttribute(new Float32Array(samples.map((s) => s.d)), 1));
    return g;
  }, [look, samples]);
  const plant = useMemo(() => plantMaterial(look.ripe, crop.startsWith("cover_")), [look, crop]);
  const material = plant.material;

  useLayoutEffect(() => {
    const rnd = seeded(crop.length * 7919);
    const m = new Matrix4();
    const q = new Quaternion();
    const v = new Vector3();
    const sc = new Vector3();
    samples.forEach((s, i) => {
      q.setFromAxisAngle(UP, rnd() * Math.PI * 2);
      const k = (0.85 + rnd() * 0.3) * PLANT_SCALE;
      m.compose(v.set(s.x + (rnd() - 0.5) * 0.6, 0.02, -s.y + (rnd() - 0.5) * 0.6), q, sc.set(k, k * (0.9 + rnd() * 0.2), k));
      mesh.current?.setMatrixAt(i, m);
    });
    if (mesh.current) {
      mesh.current.instanceMatrix.needsUpdate = true;
      mesh.current.computeBoundingSphere();
    }
  }, [samples, crop]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const s = frame.get();
    const on = s.crop === crop && !s.bare;
    const m = mesh.current;
    if (!m) return;
    m.visible = on;
    if (on) plant.update(s);
  });

  return <instancedMesh ref={mesh} args={[geometry, material, samples.length]} />;
}

export function Plants({
  plan,
  frame,
  looks,
  maxInstances,
}: {
  plan: FieldWorkPlan;
  frame: FrameSource;
  looks: Map<Crop, CropLook>;
  maxInstances: number;
}) {
  return (
    <>
      {[...looks.entries()].map(([crop, look]) => (
        <CropPlants key={crop} crop={crop} look={look} plan={plan} frame={frame} maxInstances={maxInstances} />
      ))}
    </>
  );
}

/** One look per distinct crop in the rotation (fallow has none). */
export function useCropLooks(sequence: readonly Crop[]): Map<Crop, CropLook> {
  const key = sequence.join(",");
  const looks = useMemo(() => {
    const map = new Map<Crop, CropLook>();
    for (const crop of key.split(",") as Crop[]) {
      if (map.has(crop)) continue;
      const look = cropLook(crop);
      if (look) map.set(crop, look);
    }
    return map;
  }, [key]);
  useEffect(() => () => looks.forEach((l) => l.geometry.dispose()), [looks]);
  return looks;
}
