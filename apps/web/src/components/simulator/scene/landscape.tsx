"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BackSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from "three";
import { Line } from "@react-three/drei";
import { bounds, insetPolygon, pointInPolygon, type Polygon } from "@/lib/sim/geometry";
import type { FieldWorkPlan } from "@/lib/sim/path-planner";
import { seeded } from "./crop-geometry";

export const SOIL = "#6e5139";
export const HEADLAND_SOIL = "#80624a";
export const HORIZON = "#dfe7e1";

/** Flat polygon on the ground. Local metres (x east, y north) → three.js (x, 0, −y). */
function groundShape(polygon: Polygon): ShapeGeometry {
  const shape = new Shape(polygon.map(([x, y]) => new Vector2(x, y)));
  return new ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

export function Sky() {
  return (
    <mesh renderOrder={-1}>
      <sphereGeometry args={[2600, 24, 12]} />
      <shaderMaterial
        side={BackSide}
        depthWrite={false}
        fog={false}
        uniforms={{ top: { value: new Color("#8db6d6") }, horizon: { value: new Color(HORIZON) } }}
        vertexShader={`varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
        fragmentShader={`uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
          void main(){ float h = clamp(normalize(vPos).y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, h), 1.0);
          #include <colorspace_fragment>
          }`}
      />
    </mesh>
  );
}

/** Meadow, field margin, field soil with a lighter headland, and the headland boundary line. */
export function Ground({ plan }: { plan: FieldWorkPlan }) {
  const geos = useMemo(
    () => ({
      margin: groundShape(insetPolygon(plan.outline, -9)),
      field: groundShape(plan.outline),
      interior: groundShape(plan.interior),
    }),
    [plan],
  );
  const headlandLine = useMemo(
    () => [...plan.interior, plan.interior[0]].map(([x, y]) => [x, 0.12, -y] as [number, number, number]),
    [plan],
  );

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.08}>
        <circleGeometry args={[2400, 48]} />
        <meshLambertMaterial color="#97ab70" />
      </mesh>
      <mesh geometry={geos.margin} position-y={-0.04}>
        <meshLambertMaterial color="#86a05c" />
      </mesh>
      <mesh geometry={geos.field} position-y={0}>
        <meshLambertMaterial color={HEADLAND_SOIL} />
      </mesh>
      <mesh geometry={geos.interior} position-y={0.01}>
        <meshLambertMaterial color={SOIL} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <Line points={headlandLine} color="#efe6d2" lineWidth={1.5} dashed dashSize={4} gapSize={3} transparent opacity={0.8} />
    </group>
  );
}

/** Simple post-and-rail fence 5 m outside the field edge. */
export function Fence({ outline }: { outline: Polygon }) {
  const posts = useRef<InstancedMesh>(null);
  const rails = useRef<InstancedMesh>(null);
  const line = useMemo(() => insetPolygon(outline, -5), [outline]);
  const { postMatrices, railMatrices } = useMemo(() => {
    const postMatrices: Matrix4[] = [];
    const railMatrices: Matrix4[] = [];
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < line.length; i++) {
      const [x1, y1] = line[i];
      const [x2, y2] = line[(i + 1) % line.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const heading = Math.atan2(y2 - y1, x2 - x1);
      const q = new Quaternion().setFromAxisAngle(up, heading);
      const n = Math.max(1, Math.round(len / 8));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        postMatrices.push(new Matrix4().compose(new Vector3(x1 + (x2 - x1) * t, 0.6, -(y1 + (y2 - y1) * t)), q, new Vector3(1, 1, 1)));
      }
      for (const h of [0.55, 1.0]) {
        railMatrices.push(
          new Matrix4().compose(new Vector3((x1 + x2) / 2, h, -(y1 + y2) / 2), q, new Vector3(len, 1, 1)),
        );
      }
    }
    return { postMatrices, railMatrices };
  }, [line]);

  useLayoutEffect(() => {
    postMatrices.forEach((m, i) => posts.current?.setMatrixAt(i, m));
    railMatrices.forEach((m, i) => rails.current?.setMatrixAt(i, m));
    if (posts.current) posts.current.instanceMatrix.needsUpdate = true;
    if (rails.current) rails.current.instanceMatrix.needsUpdate = true;
  }, [postMatrices, railMatrices]);

  const postGeo = useMemo(() => new BoxGeometry(0.14, 1.2, 0.14), []);
  const railGeo = useMemo(() => new BoxGeometry(1, 0.08, 0.06), []);
  return (
    <group>
      <instancedMesh ref={posts} args={[postGeo, undefined, postMatrices.length]} frustumCulled={false}>
        <meshLambertMaterial color="#8b7355" />
      </instancedMesh>
      <instancedMesh ref={rails} args={[railGeo, undefined, railMatrices.length]} frustumCulled={false}>
        <meshLambertMaterial color="#9c8466" />
      </instancedMesh>
    </group>
  );
}

/** Scattered low-poly trees and distant hills, so the field sits in a landscape. */
export function Surroundings({ outline, treeCount }: { outline: Polygon; treeCount: number }) {
  const trunks = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  const keepOut = useMemo(() => insetPolygon(outline, -22), [outline]);
  const trees = useMemo(() => {
    const rnd = seeded(97);
    const b = bounds(outline);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const r0 = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
    const out: { x: number; y: number; s: number; tint: number }[] = [];
    let guard = 0;
    while (out.length < treeCount && guard++ < treeCount * 20) {
      const a = rnd() * Math.PI * 2;
      const r = r0 + 30 + rnd() * 320;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.8;
      if (pointInPolygon([x, y], keepOut)) continue;
      out.push({ x, y, s: 0.8 + rnd() * 0.7, tint: rnd() });
    }
    return out;
  }, [outline, keepOut, treeCount]);

  useLayoutEffect(() => {
    const q = new Quaternion();
    const c = new Color();
    trees.forEach((t, i) => {
      trunks.current?.setMatrixAt(i, new Matrix4().compose(new Vector3(t.x, 1.6 * t.s, -t.y), q, new Vector3(t.s, t.s, t.s)));
      crowns.current?.setMatrixAt(i, new Matrix4().compose(new Vector3(t.x, 5.2 * t.s, -t.y), q, new Vector3(t.s, t.s * 1.15, t.s)));
      crowns.current?.setColorAt(i, c.set(t.tint > 0.5 ? "#5d7f4a" : "#6f8f52"));
    });
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
    if (crowns.current) {
      crowns.current.instanceMatrix.needsUpdate = true;
      if (crowns.current.instanceColor) crowns.current.instanceColor.needsUpdate = true;
    }
  }, [trees]);

  const trunkGeo = useMemo(() => new CylinderGeometry(0.25, 0.35, 3.2, 5), []);
  const crownGeo = useMemo(() => new IcosahedronGeometry(3.4, 0), []);
  const hills = useMemo(
    () =>
      [
        [-900, 700, 420],
        [300, 1100, 520],
        [1100, 300, 380],
        [-1200, -500, 460],
        [600, -1150, 400],
      ] as const,
    [],
  );

  return (
    <group>
      <instancedMesh ref={trunks} args={[trunkGeo, undefined, trees.length]} frustumCulled={false}>
        <meshLambertMaterial color="#6b5440" />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[crownGeo, undefined, trees.length]} frustumCulled={false}>
        <meshLambertMaterial color="#ffffff" flatShading />
      </instancedMesh>
      {hills.map(([x, z, r]) => (
        <mesh key={`${x},${z}`} position={[x, -r * 0.82, z]} scale={[1, 1, 1]}>
          <sphereGeometry args={[r, 20, 10]} />
          <meshLambertMaterial color="#8fa676" flatShading />
        </mesh>
      ))}
    </group>
  );
}
