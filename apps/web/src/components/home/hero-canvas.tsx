"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  type DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  type InstancedMesh,
  LineBasicMaterial,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type { Crop } from "@/lib/contracts";
import { CROP_COLORS, CROP_HEIGHT_M } from "@/lib/crops";
import { cropFor } from "@/lib/field-plan";
import { HORIZON, SOIL, Sky } from "@/components/simulator/scene/landscape";
import {
  type House,
  RIVER_HALF_WIDTH,
  ROAD_HALF_WIDTH,
  type ValleyField,
  WATER_LEVEL,
  distToRiver,
  distToRoad,
  heightAt,
  hexRing,
  isForest,
  mulberry32,
  roadZ,
} from "./valley";

export interface HeroCanvasProps {
  sequence: readonly Crop[];
  houses: readonly House[];
  field: ValleyField;
  /** Render one finished frame and stop (prefers-reduced-motion). */
  still: boolean;
  /** False while the hero is off screen or the tab is hidden. */
  running: boolean;
  lowDetail: boolean;
  onReady: () => void;
  /** Called with the season index when a new season starts (−1 before the first). */
  onSeason: (index: number) => void;
}

// Timeline, in seconds from the first frame.
const DESCEND = 4.2;
const HEX_REVEAL = 1.4;
const FLAG_AT = 2.6;
const SEASON_START = 4.4;
const SEASON = 3.6;
const STILL_T = SEASON_START + 2.2;

const MAX_PLOTS = 4;
/** Crop heights are exaggerated so a 2.5 m maize crop reads against 100 m hexagons. */
const CROP_SCALE = 0.13;
const PLINTH = 0.035;
const SPROUT = new Color("#8fb653");
const STUBBLE = new Color("#d4c08e");
const SOIL_COLOR = new Color(SOIL);

const settle = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 4);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Advances only while the scene renders, so the intro resumes where it was. */
class SceneClock {
  t = 0;
  advance(delta: number, still: boolean) {
    this.t = still ? STILL_T : this.t + Math.min(delta, 1 / 20);
  }
}

// ---------------------------------------------------------------------------------------------
// Ground

const FARM_TONES = ["#8d9c55", "#a9a462", "#748f4a", "#b8a46b", "#80984f", "#9aa65a", "#c2b077"].map(
  (c) => new Color(c),
);

function farmTone(x: number, z: number): Color {
  // Neighbouring farms: plots of about 150 x 70 m on a slightly turned grid.
  const u = Math.floor((x * 0.92 + z * 0.38) / 1.5);
  const v = Math.floor((-x * 0.38 + z * 0.92) / 0.7);
  const r = Math.sin(u * 12.9898 + v * 78.233) * 43758.5453;
  return FARM_TONES[Math.floor((r - Math.floor(r)) * FARM_TONES.length)];
}

function terrainGeometry(lowDetail: boolean) {
  const size = 120;
  const segs = lowDetail ? 220 : 320;
  const geo = new PlaneGeometry(size, size, segs, segs).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  const forest = new Color("#2d4a2b");
  const forestLight = new Color("#3b5a33");
  const rock = new Color("#8a8072");
  const bank = new Color("#5d7a45");
  const verge = new Color("#9a9a7a");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    c.copy(farmTone(x, z));
    if (isForest(x, z)) c.copy(forest).lerp(forestLight, (Math.sin(x * 3.1) * Math.cos(z * 2.7) + 1) / 2);
    if (h > 5.4) c.lerp(rock, smooth(5.4, 6.6, h));
    const dr = distToRiver(x, z);
    if (dr < RIVER_HALF_WIDTH + 0.5) c.lerp(bank, smooth(RIVER_HALF_WIDTH + 0.5, RIVER_HALF_WIDTH, dr));
    if (distToRoad(x, z) < ROAD_HALF_WIDTH + 0.12) c.lerp(verge, 0.6);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function Terrain({ lowDetail }: { lowDetail: boolean }) {
  const geometry = useMemo(() => terrainGeometry(lowDetail), [lowDetail]);
  return (
    <mesh geometry={geometry} receiveShadow castShadow={!lowDetail}>
      <meshStandardMaterial vertexColors roughness={0.96} metalness={0} />
    </mesh>
  );
}

function Water() {
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={WATER_LEVEL} receiveShadow>
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial color="#4f86a3" roughness={0.18} metalness={0.1} />
    </mesh>
  );
}

function ribbon(x0: number, x1: number, halfWidth: number, lift: number, out: number[]) {
  const at = (x: number) => {
    const z = roadZ(x);
    const dz = (roadZ(x + 0.01) - roadZ(x - 0.01)) / 0.02;
    const n = Math.hypot(1, dz);
    return { x, z, nx: -dz / n, nz: 1 / n };
  };
  const edge = (q: ReturnType<typeof at>, side: number) => {
    const px = q.x + q.nx * halfWidth * side;
    const pz = q.z + q.nz * halfWidth * side;
    return [px, heightAt(px, pz) + lift, pz];
  };
  const a = at(x0);
  const b = at(x1);
  const a0 = edge(a, -1);
  const a1 = edge(a, 1);
  const b0 = edge(b, -1);
  const b1 = edge(b, 1);
  out.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0);
}

function flatGeometry(positions: number[]) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute("normal", new BufferAttribute(normals, 3));
  return g;
}

/** The road on its levelled bed, with a dashed centre line. */
function Road() {
  const geometry = useMemo(() => {
    const road: number[] = [];
    const line: number[] = [];
    const step = 0.2;
    for (let i = 0; i < 600; i++) {
      const x = -60 + i * step;
      ribbon(x, x + step, ROAD_HALF_WIDTH, 0.03, road);
      if (i % 3 === 0) ribbon(x, x + step, 0.012, 0.034, line);
    }
    return { road: flatGeometry(road), line: flatGeometry(line) };
  }, []);

  return (
    <group>
      <mesh geometry={geometry.road} receiveShadow>
        <meshStandardMaterial color="#5d5f5a" roughness={0.9} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <mesh geometry={geometry.line}>
        <meshStandardMaterial color="#e9e4d4" roughness={0.8} side={DoubleSide} polygonOffset polygonOffsetFactor={-3} />
      </mesh>
    </group>
  );
}

function Houses({ houses }: { houses: readonly House[] }) {
  const walls = useRef<InstancedMesh>(null);
  const roofs = useRef<InstancedMesh>(null);
  const geos = useMemo(
    () => ({
      wall: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      roof: new ConeGeometry(0.75, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    }),
    [],
  );
  useLayoutEffect(() => {
    const w = walls.current;
    const r = roofs.current;
    if (!w || !r) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const roofTones = [new Color("#a4533a"), new Color("#8f4632"), new Color("#b36a45")];
    houses.forEach((h, i) => {
      const y = heightAt(h.x, h.z);
      q.setFromAxisAngle(up, h.angle);
      m.compose(new Vector3(h.x, y - 0.05, h.z), q, new Vector3(h.w, h.h + 0.05, h.d));
      w.setMatrixAt(i, m);
      m.compose(new Vector3(h.x, y + h.h, h.z), q, new Vector3(h.w * 1.05, h.h * 0.85, h.d * 1.1));
      r.setMatrixAt(i, m);
      r.setColorAt(i, roofTones[i % roofTones.length]);
    });
    w.instanceMatrix.needsUpdate = true;
    r.instanceMatrix.needsUpdate = true;
    if (r.instanceColor) r.instanceColor.needsUpdate = true;
  }, [houses]);
  return (
    <group>
      <instancedMesh ref={walls} args={[geos.wall, undefined, houses.length]} castShadow receiveShadow>
        <meshStandardMaterial color="#ece6da" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[geos.roof, undefined, houses.length]} castShadow>
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
    </group>
  );
}

/** Trees on the mountains, the hill and in small woods. */
function Trees({ count }: { count: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new ConeGeometry(0.5, 1, 7).translate(0, 0.5, 0), []);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const rand = mulberry32(11);
    const dummy = new Object3D();
    const tones = ["#27492a", "#33582f", "#2c5232", "#3f6834", "#21402a"].map((c) => new Color(c));
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      // Denser near the field, sparser towards the horizon.
      const r = Math.pow(rand(), 0.8) * 34;
      const a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r * 1.2;
      const z = Math.sin(a) * r - 4;
      if (!isForest(x, z)) continue;
      if (distToRoad(x, z) < 0.45 || distToRiver(x, z) < RIVER_HALF_WIDTH + 0.15) continue;
      const s = 0.75 + rand() * 0.6;
      dummy.position.set(x, heightAt(x, z) - 0.04, z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(0.34 * s, 0.85 * s, 0.34 * s);
      dummy.updateMatrix();
      m.setMatrixAt(placed, dummy.matrix);
      m.setColorAt(placed, tones[Math.floor(rand() * tones.length)]);
      placed++;
    }
    m.count = placed;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count]);
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]} castShadow receiveShadow>
      <meshStandardMaterial roughness={0.9} flatShading />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------------------------
// The field

/**
 * Farmed hexagons as one mesh. Each hexagon is draped on the ground (centre, corners and edge
 * midpoints follow the terrain) and lifted by its plot's crop in the vertex shader.
 */
function fieldGeometry(field: ValleyField) {
  const pos: number[] = [];
  const plot: number[] = [];
  const top: number[] = [];
  const delay: number[] = [];
  const rand: number[] = [];
  const rnd = mulberry32(3);
  for (const [id, p] of field.plotOf) {
    const center = field.centers.get(id);
    if (!center) continue;
    const [cx, cz] = center;
    const ring = hexRing(cx, cz, 0.9).map(([x, z]) => [x, heightAt(x, z) + PLINTH, z] as const);
    const c = [cx, heightAt(cx, cz) + PLINTH, cz] as const;
    const d = HEX_REVEAL + Math.hypot(cx, cz) * 0.07 + rnd() * 0.12;
    const r = rnd();
    const push = (v: readonly [number, number, number], isTop: number, dy = 0) => {
      pos.push(v[0], v[1] + dy, v[2]);
      plot.push(p);
      top.push(isTop);
      delay.push(d);
      rand.push(r);
    };
    for (let k = 0; k < 12; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % 12];
      push(c, 1);
      push(a, 1);
      push(b, 1);
      push(a, 1);
      push(a, 0, -0.35);
      push(b, 0, -0.35);
      push(a, 1);
      push(b, 0, -0.35);
      push(b, 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("aPlot", new Float32BufferAttribute(plot, 1));
  g.setAttribute("aTop", new Float32BufferAttribute(top, 1));
  g.setAttribute("aDelay", new Float32BufferAttribute(delay, 1));
  g.setAttribute("aRand", new Float32BufferAttribute(rand, 1));
  g.computeVertexNormals();
  return g;
}

/** The field's material, with one height and colour per plot set every frame. */
function fieldMaterial() {
  const uniforms = {
    uTime: { value: 0 },
    uHeight: { value: new Array<number>(MAX_PLOTS).fill(0) },
    uColor: { value: Array.from({ length: MAX_PLOTS }, () => new Color(SOIL)) },
    uSoil: { value: new Color(SOIL).multiplyScalar(0.8) },
  };
  const material = new MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aPlot; attribute float aTop; attribute float aDelay; attribute float aRand;
        uniform float uTime; uniform float uHeight[${MAX_PLOTS}]; uniform vec3 uColor[${MAX_PLOTS}];
        varying vec3 vCrop; varying float vTop; varying vec2 vXZ;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        int plotIndex = int(aPlot + 0.5);
        float rise = clamp((uTime - aDelay) / 0.7, 0.0, 1.0);
        rise = 1.0 - pow(1.0 - rise, 3.0);
        transformed.y += aTop * uHeight[plotIndex] * (0.85 + 0.3 * aRand) + (rise - 1.0) * 0.6;
        vCrop = uColor[plotIndex] * (0.94 + 0.12 * aRand);
        vTop = aTop;
        vXZ = position.xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uSoil;\nvarying vec3 vCrop;\nvarying float vTop;\nvarying vec2 vXZ;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float rows = 0.5 + 0.5 * sin(dot(vXZ, vec2(0.407, 0.914)) * 140.0);
        vec3 crop = vCrop * mix(0.88, 1.04, rows);
        diffuseColor.rgb = mix(uSoil, crop, smoothstep(0.55, 0.98, vTop));`,
      );
  };
  const target = new Color();
  return {
    material,
    /** Sets each plot's crop height and colour for time `t`; returns the season index. */
    update(t: number, sequence: readonly Crop[], plots: number): number {
      uniforms.uTime.value = t;
      const since = t - SEASON_START;
      const season = since < 0 ? -1 : Math.floor(since / SEASON);
      const local = since - Math.max(season, 0) * SEASON;
      for (let p = 0; p < MAX_PLOTS; p++) {
        const color = uniforms.uColor.value[p];
        if (season < 0 || p >= plots) {
          uniforms.uHeight.value[p] = 0;
          color.copy(SOIL_COLOR);
          continue;
        }
        const crop = cropFor(sequence, p, season);
        const l = local - p * 0.18;
        const grow = settle(l / 1.9);
        const harvest = smooth(SEASON - 0.75, SEASON - 0.1, l);
        uniforms.uHeight.value[p] = CROP_HEIGHT_M[crop] * CROP_SCALE * grow * (1 - harvest * 0.92);
        target.set(CROP_COLORS[crop]);
        if (grow < 0.35) color.copy(SOIL_COLOR).lerp(SPROUT, grow / 0.35);
        else color.copy(SPROUT).lerp(target, (grow - 0.35) / 0.65);
        if (harvest > 0) color.lerp(STUBBLE, harvest);
      }
      return season;
    },
  };
}

function Field({
  field,
  sequence,
  clock,
  onSeason,
}: {
  field: ValleyField;
  sequence: readonly Crop[];
  clock: SceneClock;
  onSeason: (index: number) => void;
}) {
  const geometry = useMemo(() => fieldGeometry(field), [field]);
  const fm = useMemo(() => fieldMaterial(), []);
  const shown = useRef(-2);

  useFrame(() => {
    const season = fm.update(clock.t, sequence, field.layout.plots.length);
    if (season !== shown.current) {
      shown.current = season;
      onSeason(season);
    }
  });

  return <mesh geometry={geometry} material={fm.material} receiveShadow />;
}

/**
 * Outlines of the hexagons left out of the plan (road, river, village, woods): they flash when
 * the plan is laid out, then stay as faint outlines.
 */
function blockedOutlines(field: ValleyField) {
  const pts: number[] = [];
  const lift = (x: number, z: number) => Math.max(heightAt(x, z), WATER_LEVEL) + 0.05;
  for (const id of field.reasons.keys()) {
    const center = field.centers.get(id);
    if (!center) continue;
    const ring = hexRing(center[0], center[1], 0.9);
    for (let k = 0; k < 12; k++) {
      const [ax, az] = ring[k];
      const [bx, bz] = ring[(k + 1) % 12];
      pts.push(ax, lift(ax, az), az, bx, lift(bx, bz), bz);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pts, 3));
  const material = new LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false });
  const flag = new Color("#ff8a78");
  const rest = new Color("#ffffff");
  return {
    geometry,
    material,
    update(t: number) {
      const on = smooth(FLAG_AT - 0.2, FLAG_AT + 0.2, t);
      const settled = smooth(FLAG_AT + 1.2, FLAG_AT + 2.2, t);
      material.opacity = on * (0.95 - 0.45 * settled);
      material.color.copy(flag).lerp(rest, settled);
    },
  };
}

function Blocked({ field, clock }: { field: ValleyField; clock: SceneClock }) {
  const outlines = useMemo(() => blockedOutlines(field), [field]);
  useFrame(() => outlines.update(clock.t));
  return <lineSegments geometry={outlines.geometry} material={outlines.material} renderOrder={2} />;
}

// ---------------------------------------------------------------------------------------------
// Camera, light, clock

function CameraRig({ clock, still }: { clock: SceneClock; still: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const pointer = useRef({ x: 0, y: 0 });
  const eased = useRef({ x: 0, y: 0 });
  const target = useMemo(() => new Vector3(), []);

  useLayoutEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: (e.clientX / window.innerWidth) * 2 - 1, y: (e.clientY / window.innerHeight) * 2 - 1 };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame((_, delta) => {
    const wide = size.width / size.height > 1.1;
    // Keep the field clear of the headline: to the right on wide screens, above it on phones.
    target.set(wide ? -8.8 : 4, 0.6, wide ? -0.6 : 17);

    const p = still ? 1 : settle(clock.t / DESCEND);
    const k = Math.min(delta * 2, 1);
    eased.current.x += (pointer.current.x - eased.current.x) * k;
    eased.current.y += (pointer.current.y - eased.current.y) * k;

    const drift = still ? 0 : Math.sin(clock.t * 0.07) * 0.14 + eased.current.x * 0.08;
    const polar = 0.3 + p * 0.86 + (still ? 0 : eased.current.y * 0.03);
    const radius = (wide ? 34 : 29) + (1 - p) * 14;
    const az = (1 - p) * -0.7 + p * (0.34 + drift);

    camera.position.set(
      target.x + radius * Math.sin(polar) * Math.sin(az),
      target.y + radius * Math.cos(polar),
      target.z + radius * Math.sin(polar) * Math.cos(az),
    );
    camera.lookAt(target);
  });
  return null;
}

function Sun({ lowDetail }: { lowDetail: boolean }) {
  const scene = useThree((s) => s.scene);
  const light = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);
  const map = lowDetail ? 1024 : 2048;
  return (
    <directionalLight
      ref={light}
      position={[-16, 13, 7]}
      intensity={2.7}
      color="#ffe2b6"
      castShadow
      shadow-mapSize={[map, map]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
      shadow-camera-left={-22}
      shadow-camera-right={22}
      shadow-camera-top={18}
      shadow-camera-bottom={-18}
      shadow-camera-near={1}
      shadow-camera-far={60}
    />
  );
}

class FrameCounter {
  frames = 0;
  tick() {
    this.frames++;
    return this.frames;
  }
}

function Driver({ clock, still, onReady }: { clock: SceneClock; still: boolean; onReady: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const [counter] = useState(() => new FrameCounter());
  useFrame((_, delta) => {
    clock.advance(delta, still);
    const n = counter.tick();
    if (n === 2) onReady();
    if (still && n < 3) invalidate();
  });
  return null;
}

export default function HeroCanvas({
  sequence,
  houses,
  field,
  still,
  running,
  lowDetail,
  onReady,
  onSeason,
}: HeroCanvasProps) {
  const [clock] = useState(() => new SceneClock());
  return (
    <Canvas
      frameloop={still ? "demand" : running ? "always" : "never"}
      dpr={lowDetail ? [1, 1.5] : [1, 1.75]}
      shadows
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 34, near: 0.3, far: 3000, position: [0, 40, 10] }}
      aria-hidden="true"
    >
      <fog attach="fog" args={[HORIZON, 34, 95]} />
      <hemisphereLight args={["#d6e6ef", "#5b4a33", 1.05]} />
      <Sun lowDetail={lowDetail} />
      <Sky />
      <Driver clock={clock} still={still} onReady={onReady} />
      <CameraRig clock={clock} still={still} />
      <Terrain lowDetail={lowDetail} />
      <Water />
      <Road />
      <Houses houses={houses} />
      <Trees count={lowDetail ? 1400 : 3200} />
      <Field field={field} sequence={sequence} clock={clock} onSeason={onSeason} />
      <Blocked field={field} clock={clock} />
    </Canvas>
  );
}
