import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import { HEX_SIDE_M, type Hex } from "@/lib/field-plan";

/** Why a hexagon is not farmland. */
export type NonFarmland = "road" | "building" | "water" | "woods" | "built_up";

const ROAD_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "rail",
  "transit",
]);
const BUILT_UP_CLASSES = new Set([
  "residential",
  "industrial",
  "commercial",
  "retail",
  "cemetery",
  "quarry",
  "railway",
  "school",
  "hospital",
]);
const WOODS_CLASSES = new Set(["wood", "forest", "wetland"]);

/** Reads an OpenMapTiles feature (the schema OpenFreeMap serves) as a reason not to farm there. */
function reasonFor(feature: MapGeoJSONFeature): NonFarmland | null {
  const cls = String(feature.properties?.class ?? "");
  switch (feature.sourceLayer) {
    case "transportation":
      // Field tracks and footpaths run through farmland; real roads and railways do not.
      return ROAD_CLASSES.has(cls) ? "road" : null;
    case "building":
      return "building";
    case "water":
      return "water";
    case "waterway":
      return cls === "river" || cls === "canal" ? "water" : null;
    case "landcover":
      return WOODS_CLASSES.has(cls) ? "woods" : null;
    case "landuse":
      return BUILT_UP_CLASSES.has(cls) ? "built_up" : null;
    default:
      return null;
  }
}

/** Centre plus six points halfway to the corners: enough to catch a road crossing a hexagon. */
function samplePoints(hex: Hex): [number, number][] {
  const [lon, lat] = hex.center;
  const corners = hex.ring.slice(0, 6);
  return [hex.center, ...corners.map(([x, y]): [number, number] => [(lon + x) / 2, (lat + y) / 2])];
}

/**
 * Marks hexagons that sit on roads, buildings, water, woods or built-up land, using the
 * OpenStreetMap features the basemap has already rendered. A proof of concept: in production
 * this comes from LPIS/IACS parcels or a cropland mask (ESA WorldCover, EUCROPMAP).
 * Call it once the map is idle so the tiles under the field are loaded.
 */
export function findNonFarmland(map: MapLibreMap, hexes: Hex[], ownSources: string[]): Map<string, NonFarmland> {
  const found = new Map<string, NonFarmland>();
  // ~1/6 of a hexagon side either way of each sample, in screen pixels at the current zoom.
  const metresPerPixel =
    (40_075_016 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const pad = Math.max(2, HEX_SIDE_M / 6 / metresPerPixel);
  for (const hex of hexes) {
    for (const point of samplePoints(hex)) {
      const { x, y } = map.project(point);
      const features = map.queryRenderedFeatures([
        [x - pad, y - pad],
        [x + pad, y + pad],
      ]);
      const reason = features
        .filter((f) => !ownSources.includes(f.source))
        .map(reasonFor)
        .find((r): r is NonFarmland => r !== null);
      if (reason) {
        found.set(hex.id, reason);
        break;
      }
    }
  }
  return found;
}
