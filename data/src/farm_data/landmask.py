"""Arable-land mask at 10 m for Alba county, and the cropland fraction of each web field hexagon.

Source: APIA 2025 declared farm parcels (LPIS), https://data.gov.ro/dataset/parcele_agricole_agionline_apia,
CC BY 4.0. Parcels with `cat_use = 'TA'` (arable land) are burned by pixel centre onto a 10 m
EPSG:3844 (Stereo 70) grid over Alba's bounding box (NUTS 2024 RO121), so a field on the county
border also sees the neighbouring county's parcels.

Limits: only land declared for 2025 subsidies is in the mask, so undeclared arable land reads as 0.
At the demo field (46.30, 23.75) APIA 'TA' covers 41 % of the 37 ha while EUCROPMAP 2022 reads 93 %
arable: read a low fraction as "not declared arable in 2025", not "not farmed".
'TAn' parcels (code undocumented; 1.4 % of the arable area in the box) are left out. With ~100
pixels per 1 ha hexagon a fraction is good to about ±0.01.

    from farm_data.landmask import hex_fractions
    hex_fractions(46.30, 23.75)   # {"0,0": 0.97, "1,0": 1.0, ...}; None outside the mask

Build the mask (the 1.5 GB zip is read in place, never unzipped) and run the self-check:

    uv run --package farm-data python -m farm_data.landmask [parcele_fermieri_apia_agi_online.zip]
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pyogrio
import rasterio
import shapely
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.windows import Window
from shapely.geometry import Polygon

from farm_data import CACHE, RAW
from farm_data.zones import COUNTIES, DEMO_FIELD

APIA_ZIP = RAW / "apia_2025" / "parcele_fermieri_apia_agi_online.zip"
MASK = CACHE / "landmask" / "arable_alba_10m.tif"
CRS = "EPSG:3844"  # the shapefile's .qmd says 3844; its .prj names the older Dealul Piscului 1970
RES = 10

# Copied from apps/web/src/lib/field-plan.ts: pointy-top 1 ha hexagons with axial ids "q,r",
# FIELD_RINGS rings around the pin (37 cells), local metres -> degrees on a flat-earth scale.
HEX_SIDE_M = math.sqrt(20_000 / (3 * math.sqrt(3)))
FIELD_RINGS = 3
METRES_PER_DEGREE_LAT = 111_320

_TO_MASK = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)


def hexes(lat: float, lon: float) -> dict[str, Polygon]:
    """The web's default field around a pin: {"q,r": hexagon in EPSG:3844}."""
    s = HEX_SIDE_M
    m_lon = METRES_PER_DEGREE_LAT * math.cos(math.radians(lat))
    corners = [math.radians(60 * k - 30) for k in range(6)]
    out = {}
    for q in range(-FIELD_RINGS, FIELD_RINGS + 1):
        for r in range(-FIELD_RINGS, FIELD_RINGS + 1):
            if abs(q + r) > FIELD_RINGS:
                continue
            x, y = s * math.sqrt(3) * (q + r / 2), -s * 1.5 * r
            lons = [lon + (x + s * math.cos(a)) / m_lon for a in corners]
            lats = [lat + (y + s * math.sin(a)) / METRES_PER_DEGREE_LAT for a in corners]
            out[f"{q},{r}"] = Polygon(zip(*_TO_MASK.transform(lons, lats), strict=True))
    return out


def hex_fractions(lat: float, lon: float) -> dict[str, float] | None:
    """Share of each field hexagon on APIA 2025 arable parcels, 0-1; None if the field is not
    fully inside the mask (or the mask is not built)."""
    if not MASK.exists():
        return None
    hx = hexes(lat, lon)
    minx, miny, maxx, maxy = shapely.total_bounds(list(hx.values()))
    with rasterio.open(MASK) as src:
        c0, r0 = (math.floor(v) for v in ~src.transform * (minx, maxy))
        c1, r1 = (math.ceil(v) for v in ~src.transform * (maxx, miny))
        if c0 < 0 or r0 < 0 or c1 > src.width or r1 > src.height:
            return None
        win = Window(c0, r0, c1 - c0, r1 - r0)
        arable = src.read(1, window=win).ravel()
        tf = src.window_transform(win)
    labels = rasterize(
        ((p, k) for k, p in enumerate(hx.values(), 1)),
        out_shape=(win.height, win.width),
        transform=tf,
        dtype="uint8",
    ).ravel()
    n = np.bincount(labels, minlength=len(hx) + 1)
    a = np.bincount(labels, weights=arable, minlength=len(hx) + 1)
    return {i: round(float(a[k] / n[k]), 2) for k, i in enumerate(hx, 1)}


def build(zip_path: Path = APIA_ZIP) -> Path:
    """Rasterize APIA 'TA' parcels over Alba's bounding box to MASK (uint8 1 = arable, deflate)."""
    nuts = RAW / "boundaries" / "NUTS_2024.gpkg"
    alba = gpd.read_file(nuts, where=f"NUTS_ID = '{COUNTIES['AB']}'").to_crs(CRS)
    minx, miny, maxx, maxy = alba.total_bounds
    x0, y1 = math.floor(minx / RES) * RES, math.ceil(maxy / RES) * RES
    w, h = math.ceil((maxx - x0) / RES), math.ceil((y1 - miny) / RES)
    parcels = pyogrio.read_dataframe(
        f"/vsizip/{zip_path}/ipa_2025_f.shp",
        bbox=(x0, y1 - h * RES, x0 + w * RES, y1),
        where="cat_use = 'TA'",
        columns=["cat_use"],
    )
    tf = Affine(RES, 0, x0, 0, -RES, y1)
    arr = rasterize(
        ((g, 1) for g in parcels.geometry), out_shape=(h, w), transform=tf, dtype="uint8"
    )
    MASK.parent.mkdir(parents=True, exist_ok=True)
    part = MASK.with_suffix(".part")
    prof = {
        "driver": "GTiff",
        "width": w,
        "height": h,
        "count": 1,
        "dtype": "uint8",
        "crs": CRS,
        "transform": tf,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 512,
        "blockysize": 512,
    }
    with rasterio.open(part, "w", **prof) as dst:
        dst.write(arr, 1)
    part.rename(MASK)
    print(f"{len(parcels)} TA parcels -> {MASK} ({w}x{h}, {arr.mean():.1%} arable)")
    return MASK


if __name__ == "__main__":
    if not MASK.exists():
        build(Path(sys.argv[1]) if len(sys.argv) > 1 else APIA_ZIP)
    lat, lon = DEMO_FIELD
    fr = hex_fractions(lat, lon)
    assert fr is not None, "demo field outside the mask"
    assert len(fr) == 37 == len(set(fr)), len(fr)
    assert all(0 <= v <= 1 for v in fr.values()), fr
    area_ha = sum(p.area for p in hexes(lat, lon).values()) / 10_000
    assert abs(area_ha - 37) <= 0.37, area_ha
    assert hex_fractions(44.0, 26.0) is None  # Bucharest: outside the Alba mask
    mean = np.mean(list(fr.values()))
    print(f"demo field {lat},{lon}: 37 hexes, {area_ha:.2f} ha, mean cropland {mean:.2f}")
    print(fr)
