"""JRC EUCROPMAP crop-type maps, 2018 and 2022 (10 m, EPSG:3035, LUCAS codes, CC BY 4.0).

    from farm_data.cropmap import crop_at, crop_area_ha, sample_points
    crop_at(46.30, 23.75)                 # 'maize' / 'grassland' / ...
    crop_area_ha(county_geometry, 2022)   # {'maize': 41_200.0, ...}

Accuracy: 2022 map 79.3% (7 classes) / 70.6% (19 crops); the 2018 map is Sentinel-1 only
(d'Andrimont et al. 2021 RSE; Ghassemi et al. 2024 Sci Data). Treat shares as estimates.

Download (windowed HTTP read of the EU-wide GeoTIFF, pilot area only):

    uv run --package farm-data python -m farm_data.cropmap
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.warp import transform, transform_bounds, transform_geom
from rasterio.windows import Window, from_bounds
from sklearn.cluster import KMeans

from farm_data import RAW

JRC = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/EUCROPMAP"
URLS = {
    2018: f"{JRC}/2018/EUCROPMAP_2018.tif",
    2022: f"{JRC}/2022/EU_CropMap_22_v1_stratum_EU27-HR.tif",
}
LEGEND = {
    100: "artificial",
    211: "common_wheat",
    212: "durum_wheat",
    213: "barley",
    214: "rye",
    215: "oats",
    216: "maize",
    217: "rice",
    218: "triticale",
    219: "other_cereals",
    221: "potatoes",
    222: "sugar_beet",
    223: "other_root_crops",
    230: "other_industrial_crops",
    231: "sunflower",
    232: "rapeseed",
    233: "soybean",
    240: "dry_pulses",
    250: "fodder_crops",
    290: "bare_arable",
    300: "woodland_shrubland",
    500: "grassland",
    600: "bare_land",
    700: "water",
    800: "wetlands",
}
# Contract crop id -> EUCROPMAP codes. Pea has no class of its own: "dry pulses" is a proxy.
CROP_CODES = {
    "wheat": (211, 212),
    "barley": (213,),
    "maize": (216,),
    "sunflower": (231,),
    "soybean": (233,),
    "pea": (240,),
}
ARABLE = tuple(c for c in LEGEND if 211 <= c <= 290)
# ponytail: shares and sample points read every 10th pixel (100 m); fine for county and commune
# totals, read at full resolution if a zone is smaller than a few km².
DECIMATE = 10
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_MAX_RETRY": "5",
    "GDAL_HTTP_RETRY_DELAY": "3",
    "CPL_VSIL_CURL_CHUNK_SIZE": 4 << 20,
}


def path(year: int) -> Path:
    return RAW / "eucropmap" / f"EUCROPMAP_{year}.tif"


def download(
    year: int, bbox: tuple[float, float, float, float], src: str | None = None, rows: int = 1024
) -> None:
    """Clip the EU-wide map (or a local copy, `src`) to `bbox` (W, S, E, N in EPSG:4326)."""
    out = path(year)
    if out.exists():
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.Env(**GDAL_ENV), rasterio.open(src or "/vsicurl/" + URLS[year]) as s:
        w = from_bounds(*transform_bounds("EPSG:4326", s.crs, *bbox, densify_pts=21), s.transform)
        c0, r0 = max(0, math.floor(w.col_off)), max(0, math.floor(w.row_off))
        c1 = min(s.width, math.ceil(w.col_off + w.width))
        r1 = min(s.height, math.ceil(w.row_off + w.height))
        w = Window(c0, r0, c1 - c0, r1 - r0)
        prof = {
            **s.profile,
            "driver": "GTiff",
            "dtype": "int16",
            "width": w.width,
            "height": w.height,
            "transform": s.window_transform(w),
            "compress": "deflate",
            "tiled": True,
            "blockxsize": 512,
            "blockysize": 512,
            "BIGTIFF": "IF_SAFER",
        }
        part = out.with_suffix(".part")
        with rasterio.open(part, "w", **prof) as d:
            for r in range(0, w.height, rows):
                h = min(rows, w.height - r)
                block = s.read(window=Window(w.col_off, w.row_off + r, w.width, h))
                d.write(block.astype("int16"), window=Window(0, r, w.width, h))
        part.rename(out)


def crop_at(lat: float, lon: float, year: int = 2022) -> str | None:
    """EUCROPMAP class at a point, e.g. 'maize'; None outside the map."""
    with rasterio.open(path(year)) as src:
        (x,), (y,) = transform("EPSG:4326", src.crs, [lon], [lat])
        row, col = src.index(x, y)
        if not (0 <= row < src.height and 0 <= col < src.width):
            return None
        v = int(src.read(1, window=Window(col, row, 1, 1))[0, 0])
    return LEGEND.get(v)


def _read_zone(geom: dict[str, Any], year: int) -> tuple[np.ndarray, Any, Any]:
    """Codes inside a WGS84 geometry at 100 m, outside pixels set to 0, plus transform and CRS."""
    with rasterio.open(path(year)) as src:
        g = transform_geom("EPSG:4326", src.crs, geom)
        xs, ys = zip(*_coords(g), strict=True)
        win = from_bounds(min(xs), min(ys), max(xs), max(ys), src.transform)
        win = win.round_offsets().round_lengths().intersection(Window(0, 0, src.width, src.height))
        shape = (max(1, int(win.height) // DECIMATE), max(1, int(win.width) // DECIMATE))
        codes = src.read(1, window=win, out_shape=shape, resampling=Resampling.nearest)
        wt = src.window_transform(win)
        tf = wt * rasterio.Affine.scale(win.width / shape[1], win.height / shape[0])
        outside = geometry_mask([g], out_shape=shape, transform=tf)
        return np.where(outside, 0, codes), tf, src.crs


def _coords(g: dict[str, Any]) -> list[tuple[float, float]]:
    rings = g["coordinates"] if g["type"] == "Polygon" else [r for p in g["coordinates"] for r in p]
    return [(x, y) for ring in rings for x, y in ring]


def crop_area_ha(geom: dict[str, Any], year: int = 2022) -> dict[str, float]:
    """Hectares per EUCROPMAP class inside a WGS84 geometry (100 m sampling, 1 pixel = 1 ha)."""
    codes, tf, _ = _read_zone(geom, year)
    px_ha = abs(tf.a * tf.e) / 10_000
    vals, counts = np.unique(codes[codes > 0], return_counts=True)
    return {LEGEND.get(int(v), str(v)): float(n * px_ha) for v, n in zip(vals, counts, strict=True)}


def sample_points(geom: dict[str, Any], k: int, year: int = 2022) -> list[tuple[float, float]]:
    """`k` (lat, lon) points on arable pixels spread over the zone's cropland (k-means centres
    snapped to the nearest arable pixel). Empty if the zone has no arable pixels."""
    codes, tf, crs = _read_zone(geom, year)
    rows, cols = np.nonzero(np.isin(codes, ARABLE))
    if len(rows) == 0:
        return []
    xy = np.column_stack([cols, rows]).astype(float)
    k = min(k, len(xy))
    centres = KMeans(n_clusters=k, n_init=4, random_state=0).fit(xy).cluster_centers_
    picked = [xy[np.argmin(((xy - c) ** 2).sum(axis=1))] for c in centres]
    xs, ys = zip(*(tf * (c + 0.5, r + 0.5) for c, r in picked), strict=True)
    lons, lats = transform(crs, "EPSG:4326", list(xs), list(ys))
    return [(round(la, 5), round(lo, 5)) for la, lo in zip(lats, lons, strict=True)]


if __name__ == "__main__":
    from farm_data.zones import pilot_bbox

    for y in URLS:
        download(y, pilot_bbox())
        print(f"EUCROPMAP {y}: {path(y)}")
