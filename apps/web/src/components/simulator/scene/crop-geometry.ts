import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Crop } from "@/lib/contracts";
import type { SceneState } from "@/lib/sim/scene-state";

/**
 * Low-poly plant "clumps", one geometry per crop, each a few plants on roughly a 1.6 m square.
 * One clump per instance keeps the instance count low while the field still looks full.
 * Original shapes built from primitives; colours carried as vertex colours.
 */

type Part = { geo: BufferGeometry; color: string; pos: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] };

/** Deterministic pseudo-random numbers so the field looks the same on every load. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function build(parts: Part[], height: number): BufferGeometry {
  const geos = parts.map(({ geo, color, pos, rot = [0, 0, 0], scale = [1, 1, 1] }) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as BufferGeometry;
    g.deleteAttribute("uv");
    g.applyMatrix4(
      new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...scale)),
    );
    const c = new Color(color);
    const position = g.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      // Darker near the ground: cheap ambient occlusion instead of shadows.
      const shade = 0.55 + 0.45 * Math.min(1, Math.max(0, position.getY(i) / height));
      colors[i * 3] = c.r * shade;
      colors[i * 3 + 1] = c.g * shade;
      colors[i * 3 + 2] = c.b * shade;
    }
    g.setAttribute("color", new BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) throw new Error("could not merge plant geometry");
  merged.computeBoundingSphere();
  return merged;
}

const stalk = (r: number, h: number) => new CylinderGeometry(r * 0.7, r, h, 5, 1).translate(0, h / 2, 0);
const blade = (h: number) => new ConeGeometry(0.03, h, 3, 1).translate(0, h / 2, 0);
const blob = (r: number) => new IcosahedronGeometry(r, 0);
const leaf = (len: number) => new ConeGeometry(0.09, len, 3, 1).translate(0, len / 2, 0).scale(1, 1, 0.25);

function maize(): BufferGeometry {
  const rnd = seeded(11);
  const parts: Part[] = [];
  for (const [x, z] of [[-0.45, -0.4], [0.4, -0.35], [-0.35, 0.45], [0.45, 0.4]]) {
    const h = 2.2 + rnd() * 0.4;
    parts.push({ geo: stalk(0.04, h), color: "#5f8f3b", pos: [x, 0, z] });
    for (let k = 0; k < 4; k++) {
      const a = rnd() * Math.PI * 2;
      parts.push({ geo: leaf(0.9), color: "#6f9e45", pos: [x, 0.5 + k * 0.35, z], rot: [Math.cos(a) * 1.0, a, Math.sin(a) * 1.0] });
    }
    parts.push({ geo: new CylinderGeometry(0.055, 0.06, 0.28, 5), color: "#d9c27a", pos: [x + 0.07, 1.2, z], rot: [0, 0, -0.3] });
    parts.push({ geo: new ConeGeometry(0.06, 0.35, 4), color: "#d8c48a", pos: [x, h + 0.15, z] });
  }
  return build(parts, 2.5);
}

function cereal(earColor: string, height: number, seed: number): BufferGeometry {
  const rnd = seeded(seed);
  const parts: Part[] = [];
  for (let i = 0; i < 16; i++) {
    const x = (rnd() - 0.5) * 1.6;
    const z = (rnd() - 0.5) * 1.6;
    const h = height * (0.85 + rnd() * 0.25);
    const tilt: [number, number, number] = [(rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.35];
    parts.push({ geo: blade(h), color: "#7ea44a", pos: [x, 0, z], rot: tilt });
    parts.push({ geo: new ConeGeometry(0.045, 0.2, 3), color: earColor, pos: [x - tilt[2] * h, h, z + tilt[0] * h], rot: tilt });
  }
  return build(parts, height);
}

function soybean(): BufferGeometry {
  const rnd = seeded(23);
  const parts: Part[] = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.25 + rnd() * 0.15;
    parts.push({ geo: blob(r), color: i % 2 ? "#4f8a3c" : "#5d9845", pos: [(rnd() - 0.5) * 1.3, r * 0.75, (rnd() - 0.5) * 1.3], scale: [1, 0.85, 1] });
  }
  return build(parts, 0.8);
}

function sunflower(): BufferGeometry {
  const rnd = seeded(31);
  const parts: Part[] = [];
  for (const [x, z] of [[-0.4, -0.3], [0.45, 0.05], [-0.15, 0.5]]) {
    const h = 1.7 + rnd() * 0.3;
    parts.push({ geo: stalk(0.045, h), color: "#5b8a3a", pos: [x, 0, z] });
    parts.push({ geo: blob(0.22), color: "#5f9442", pos: [x + 0.15, h * 0.45, z], scale: [1.2, 0.25, 0.8] });
    parts.push({ geo: blob(0.2), color: "#5f9442", pos: [x - 0.12, h * 0.65, z + 0.05], scale: [1.1, 0.25, 0.8] });
    // Head tilted to the east, like a field in the morning.
    parts.push({ geo: new CylinderGeometry(0.24, 0.24, 0.05, 10), color: "#f2b630", pos: [x + 0.06, h, z], rot: [0, 0, -1.1] });
    parts.push({ geo: new CylinderGeometry(0.14, 0.14, 0.06, 10), color: "#5b3a1e", pos: [x + 0.09, h + 0.02, z], rot: [0, 0, -1.1] });
  }
  return build(parts, 2);
}

function lowMounds(colors: string[], count: number, r: number, squash: number, seed: number, height: number): BufferGeometry {
  const rnd = seeded(seed);
  const parts: Part[] = [];
  for (let i = 0; i < count; i++) {
    const rr = r * (0.75 + rnd() * 0.5);
    parts.push({
      geo: blob(rr),
      color: colors[i % colors.length],
      pos: [(rnd() - 0.5) * 1.7, rr * squash * 0.6, (rnd() - 0.5) * 1.7],
      scale: [1, squash, 1],
    });
  }
  return build(parts, height);
}

export interface CropLook {
  geometry: BufferGeometry;
  /** Canopy colour seen from far away (drives the row-strip tint). */
  canopy: string;
  /** Colour at maturity / harvest. */
  ripe: string;
  /** How much ground the canopy hides at full growth (row crops leave soil visible). */
  cover: number;
}

const LOOKS: Partial<Record<Crop, () => CropLook>> = {
  maize: () => ({ geometry: maize(), canopy: "#5f8f3b", ripe: "#a8873f", cover: 0.8 }),
  wheat: () => ({ geometry: cereal("#9fb456", 0.9, 41), canopy: "#7ea44a", ripe: "#d19f2e", cover: 0.95 }),
  barley: () => ({ geometry: cereal("#a9b866", 0.8, 43), canopy: "#86a84f", ripe: "#c49a3a", cover: 0.95 }),
  soybean: () => ({ geometry: soybean(), canopy: "#4f8a3c", ripe: "#a48437", cover: 0.85 }),
  sunflower: () => ({ geometry: sunflower(), canopy: "#5b8a3a", ripe: "#5e4a2e", cover: 0.75 }),
  pea: () => ({ geometry: lowMounds(["#5aa055", "#66aa5c"], 6, 0.26, 0.55, 53, 0.6), canopy: "#5aa055", ripe: "#b49a45", cover: 0.9 }),
  cover_mustard: () => ({ geometry: lowMounds(["#8fae3e", "#c9c24a"], 7, 0.28, 0.4, 61, 0.5), canopy: "#8fae3e", ripe: "#8f9a48", cover: 1 }),
  cover_phacelia: () => ({ geometry: lowMounds(["#5f8a4a", "#8c80c0"], 7, 0.28, 0.4, 67, 0.5), canopy: "#5f8a4a", ripe: "#6f7d52", cover: 1 }),
  cover_vetch: () => ({ geometry: lowMounds(["#4f8752", "#5c9460"], 7, 0.28, 0.35, 71, 0.4), canopy: "#4f8752", ripe: "#5f7d4c", cover: 1 }),
};

export function cropLook(crop: Crop): CropLook | null {
  return LOOKS[crop]?.() ?? null;
}

/**
 * Lambert material whose vertex shader scales each plant by growth and hides it until the drill
 * has reached it (`aSow` ≤ uSowD) and after the harvester has passed (`aSow` ≤ uHarvD). All
 * animation happens on the GPU, so the CPU only updates four numbers per frame.
 */
export function plantMaterial(ripe: string, cover: boolean) {
  const uniforms = {
    uSowD: { value: -1 },
    uHarvD: { value: -1 },
    uGrowth: { value: 0 },
    uRipe: { value: 0 },
    uRipeColor: { value: new Color(ripe) },
  };
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      "attribute float aSow;\nuniform float uSowD;\nuniform float uHarvD;\nuniform float uGrowth;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float sown = step(aSow, uSowD);
        float cut = step(aSow, uHarvD);
        transformed *= sown * (1.0 - cut) * uGrowth;`,
      );
    shader.fragmentShader =
      "uniform float uRipe;\nuniform vec3 uRipeColor;\n" +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uRipeColor, uRipe * 0.85);`,
      );
  };
  return {
    material,
    update(s: SceneState) {
      uniforms.uSowD.value = s.sowD;
      uniforms.uHarvD.value = s.harvestD;
      uniforms.uGrowth.value = s.growth;
      // Cover crops are worked in green; only a slight dulling towards the end.
      uniforms.uRipe.value = cover ? s.ripe * 0.4 : s.ripe;
    },
  };
}
