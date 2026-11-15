"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  type DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  type InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  type Texture,
  UnsignedByteType,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type { Crop } from "@/lib/contracts";
import { CROP_COLORS } from "@/lib/crops";
import { cropFor } from "@/lib/field-plan";
import { HORIZON, SOIL, Sky } from "@/components/simulator/scene/landscape";
import {
  FIELD_HALF_WIDTH,
  FIELD_NORTH,
  FIELD_SOUTH,
  fieldPlotAt,
  type House,
  RIVER_HALF_WIDTH,
  ROAD_HALF_WIDTH,
  WATER_LEVEL,
  distToRiver,
  distToRoad,
  heightAt,
  isForest,
  mulberry32,
  plotBands,
  roadZ,
} from "./valley";

export interface HeroCanvasProps {
  sequence: readonly Crop[];
  houses: readonly House[];
  /** How many plots the field is cut into. */
  plots: number;
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
const DESCEND = 6.5;
const REVEAL = 2.0;
const SEASON_START = 6.8;
const SEASON = 5.6;
const STILL_T = SEASON_START + 3.2;

const MAX_PLOTS = 4;
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

/** One texel of the plot map, in world units: fine enough that a plot edge looks smooth. */
const PLOT_TEXEL = 0.05;

/**
 * A plot map over the valley floor: each texel holds the plot index + 1 of the land under it, or
 * 0 where nothing is farmed. The overlay is coloured through it, so plots read as continuous
 * shapes and no hexagon edges show.
 */
function plotTexture(houses: readonly House[], plots: number) {
  const width = 2 * FIELD_HALF_WIDTH;
  const height = FIELD_SOUTH + FIELD_NORTH;
  const nx = Math.ceil(width / PLOT_TEXEL);
  const ny = Math.ceil(height / PLOT_TEXEL);
  const data = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const z = -FIELD_NORTH + (j + 0.5) * PLOT_TEXEL;
    for (let i = 0; i < nx; i++) {
      const x = -FIELD_HALF_WIDTH + (i + 0.5) * PLOT_TEXEL;
      const plot = fieldPlotAt(x, z, houses, plots);
      data[j * nx + i] = plot < 0 ? 0 : plot + 1;
    }
  }
  const texture = new DataTexture(data, nx, ny, RedFormat, UnsignedByteType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A plane over the same bounds, draped on the ground; the shader colours it by plot. */
function overlayGeometry() {
  const width = 2 * FIELD_HALF_WIDTH;
  const height = FIELD_SOUTH + FIELD_NORTH;
  const geometry = new PlaneGeometry(width, height, 140, 70);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, (FIELD_SOUTH - FIELD_NORTH) / 2);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)) + 0.03);
  geometry.computeVertexNormals();
  return geometry;
}

/** Half-width, in world units, of the white line drawn between two plots. */
const PLOT_LINE = 0.07;

/**
 * The overlay's material: one colour per plot, set every frame, white lines on the plot edges and
 * a ripple from the centre when the plan is laid out.
 */
function overlayMaterial(texture: Texture, plots: number) {
  const bands = plotBands(plots);
  const uniforms = {
    uTime: { value: 0 },
    uPlot: { value: texture },
    uBounds: {
      value: new Vector4(
        -FIELD_HALF_WIDTH,
        -FIELD_NORTH,
        1 / (2 * FIELD_HALF_WIDTH),
        1 / (FIELD_SOUTH + FIELD_NORTH),
      ),
    },
    uColor: { value: Array.from({ length: MAX_PLOTS }, () => new Color(SOIL)) },
    uBands: { value: new Vector4(bands.axisX, bands.axisZ, bands.u0, bands.width) },
  };
  const material = new MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        varying vec2 vXZ; varying float vReveal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vXZ = position.xz;
        float delay = ${REVEAL.toFixed(2)} + length(position.xz) * 0.07;
        vReveal = smoothstep(delay, delay + 0.85, uTime);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uPlot; uniform vec4 uBounds; uniform vec3 uColor[${MAX_PLOTS}];
        uniform vec4 uBands;
        varying vec2 vXZ; varying float vReveal;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float id = texture2D(uPlot, (vXZ - uBounds.xy) * uBounds.zw).r * 255.0;
        if (id < 0.5) discard;
        float rows = 0.5 + 0.5 * sin(dot(vXZ, vec2(0.407, 0.914)) * 140.0);
        diffuseColor.rgb = uColor[int(id - 1.0)] * mix(0.94, 1.02, rows);
        // White line down the middle of each plot edge (fract is 0 on an edge).
        float bandPos = (dot(vXZ, uBands.xy) - uBands.z) / uBands.w;
        float edge = min(fract(bandPos), 1.0 - fract(bandPos)) * uBands.w;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), smoothstep(${PLOT_LINE.toFixed(3)}, ${(PLOT_LINE / 2).toFixed(3)}, edge));
        diffuseColor.a *= vReveal;`,
      );
  };
  const target = new Color();
  return {
    material,
    /** Sets each plot's crop colour for time `t`; returns the season index. */
    update(t: number, sequence: readonly Crop[], plots: number): number {
      uniforms.uTime.value = t;
      const since = t - SEASON_START;
      const season = since < 0 ? -1 : Math.floor(since / SEASON);
      const local = since - Math.max(season, 0) * SEASON;
      for (let p = 0; p < MAX_PLOTS; p++) {
        const color = uniforms.uColor.value[p];
        if (season < 0 || p >= plots) {
          color.copy(SOIL_COLOR);
          continue;
        }
        const crop = cropFor(sequence, p, season);
        const grow = settle((local - p * 0.28) / 2.9);
        const harvest = smooth(SEASON - 1.2, SEASON - 0.15, local - p * 0.28);
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
  houses,
  plots,
  sequence,
  clock,
  onSeason,
}: {
  houses: readonly House[];
  plots: number;
  sequence: readonly Crop[];
  clock: SceneClock;
  onSeason: (index: number) => void;
}) {
  const texture = useMemo(() => plotTexture(houses, plots), [houses, plots]);
  const geometry = useMemo(() => overlayGeometry(), []);
  const om = useMemo(() => overlayMaterial(texture, plots), [texture, plots]);
  const shown = useRef(-2);

  useFrame(() => {
    const season = om.update(clock.t, sequence, plots);
    if (season !== shown.current) {
      shown.current = season;
      onSeason(season);
    }
  });

  return <mesh geometry={geometry} material={om.material} receiveShadow renderOrder={1} />;
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
  plots,
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
      <Field houses={houses} plots={plots} sequence={sequence} clock={clock} onSeason={onSeason} />
    </Canvas>
  );
}
