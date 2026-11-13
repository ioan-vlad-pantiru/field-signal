// MapLibre builds its worker URL at runtime (new URL("./maplibre-gl-worker.mjs", import.meta.url)),
// which bundlers cannot follow, so the worker 404s. We serve a copy from public/ instead and point
// MapLibre at it with setWorkerUrl (see src/components/map/use-map.ts). Runs before dev and build.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = dirname(fileURLToPath(import.meta.resolve("maplibre-gl")));
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "vendor");
mkdirSync(target, { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), join(target, "maplibre-gl-worker.mjs"));
