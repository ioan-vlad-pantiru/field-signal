"""Arable-land mask at 10 m for Alba county, and the cropland fraction of each web field hexagon.

Rule: a hexagon's `cropland_fraction` is the share of its 10 m pixels (by pixel centre) that are
arable in EITHER source:
- APIA 2025 declared farm parcels (LPIS) with `cat_use = 'TA'` (arable land),
  https://data.gov.ro/dataset/parcele_agricole_agionline_apia, CC BY 4.0, (c) APIA;
- JRC EUCROPMAP 2022 arable classes (`cropmap.ARABLE`, the classes `zones.py` samples on),
  EC reuse notice (Commission Decision of 12 Dec 2011); acknowledge the source.
Each pixel stores bit flags (APIA = 1, EUCROPMAP = 2), so either source can be read alone. The
grid is EPSG:3844 (Stereo 70) over Alba's bounding box (NUTS 2024 RO121), so a field on the county
border also sees the neighbouring county. Without the APIA zip the mask holds EUCROPMAP alone;
the GeoTIFF tag SOURCES records which bits were built, and asking for an unbuilt source gives
None (unknown), never 0.

Why both: APIA holds only land declared for 2025 subsidies (undeclared arable land reads 0), and
EUCROPMAP is a classifier (79.3 % accurate at 7 classes). At the demo field (46.30, 23.75) APIA
'TA' covers 40 % of the 37 ha, EUCROPMAP 93 %, either 93 %. 'TAn' parcels (code undocumented;
1.4 % of the arable area in the box) are left out. With ~100 pixels per 1 ha hexagon a fraction
is good to about +-0.01.

    from farm_data.landmask import hex_fractions, APIA
    hex_fractions(46.30, 23.75)                # {"0,0": 0.97, ...}: every built source
    hex_fractions(lat, lon, rings=12)          # a drawn field: pass the web's centroid and rings
    hex_fractions(46.30, 23.75, sources=APIA)  # one source; None if APIA was not built

Build the mask (the 1.5 GB zip is read in place, never unzipped) and run the self-check:

    uv run --package farm-data python -m farm_data.landmask [parcele_fermieri_apia_agi_online.zip]
"""

from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pyogrio
import rasterio
import shapely
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.warp import reproject
from rasterio.windows import Window
from shapely.geometry import Polygon

from farm_data import CACHE, RAW, cropmap
from farm_data.zones import COUNTIES, DEMO_FIELD

APIA_ZIP = RAW / "apia_2025" / "parcele_fermieri_apia_agi_online.zip"
MASK = CACHE / "landmask" / "arable_alba_10m.tif"
CRS = "EPSG:3844"  # the shapefile's .qmd says 3844; its .prj names the older Dealul Piscului 1970
RES = 10
APIA, EUCROPMAP = 1, 2  # bit flags per mask pixel

# Copied from apps/web/src/lib/field-plan.ts: pointy-top 1 ha hexagons with axial ids "q,r",
# FIELD_RINGS rings around the pin (37 cells), at most MAX_RINGS for a drawn field (centred on
# the boundary's centroid), local metres -> degrees on a flat-earth scale.
HEX_SIDE_M = math.sqrt(20_000 / (3 * math.sqrt(3)))
FIELD_RINGS = 3
MAX_RINGS = 20
METRES_PER_DEGREE_LAT = 111_320

_TO_MASK = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)


def hexes(lat: float, lon: float, rings: int = FIELD_RINGS) -> dict[str, Polygon]:
    """The web's hexagons within `rings` of a centre: {"q,r": hexagon in EPSG:3844}."""
    if not 0 <= rings <= MAX_RINGS:
        raise ValueError(f"rings must be 0-{MAX_RINGS}, got {rings}")
    s = HEX_SIDE_M
    m_lon = METRES_PER_DEGREE_LAT * math.cos(math.radians(lat))
    corners = [math.radians(60 * k - 30) for k in range(6)]
    out = {}
    for q in range(-rings, rings + 1):
        for r in range(-rings, rings + 1):
            if abs(q + r) > rings:
                continue
            x, y = s * math.sqrt(3) * (q + r / 2), -s * 1.5 * r
            lons = [lon + (x + s * math.cos(a)) / m_lon for a in corners]
            lats = [lat + (y + s * math.sin(a)) / METRES_PER_DEGREE_LAT for a in corners]
            out[f"{q},{r}"] = Polygon(zip(*_TO_MASK.transform(lons, lats), strict=True))
    return out


def built_sources() -> int:
    """Source bits the mask was built from (APIA | EUCROPMAP); 0 if not built."""
    if not MASK.exists():
        return 0
    with rasterio.open(MASK) as src:
        return int(src.tags().get("SOURCES", 0))


def hex_fractions(
    lat: float, lon: float, rings: int = FIELD_RINGS, sources: int | None = None
) -> dict[str, float] | None:
    """Share of each hexagon's pixels that `sources` mark arable (default: every built source),
    0-1; None if the field is not fully inside the mask or a requested source was not built."""
    built = built_sources()
    sources = built if sources is None else sources
    if not built or sources & ~built:
        return None
    hx = hexes(lat, lon, rings)
    minx, miny, maxx, maxy = shapely.total_bounds(list(hx.values()))
    with rasterio.open(MASK) as src:
        c0, r0 = (math.floor(v) for v in ~src.transform * (minx, maxy))
        c1, r1 = (math.ceil(v) for v in ~src.transform * (maxx, miny))
        if c0 < 0 or r0 < 0 or c1 > src.width or r1 > src.height:
            return None
        win = Window(c0, r0, c1 - c0, r1 - r0)
        arable = (src.read(1, window=win).ravel() & sources) > 0
        tf = src.window_transform(win)
    labels = rasterize(
        ((p, k) for k, p in enumerate(hx.values(), 1)),
        out_shape=(win.height, win.width),
        transform=tf,
        dtype="uint16",
    ).ravel()
    n = np.bincount(labels, minlength=len(hx) + 1)
    a = np.bincount(labels, weights=arable, minlength=len(hx) + 1)
    return {i: round(float(a[k] / n[k]), 2) for k, i in enumerate(hx, 1)}


def build(zip_path: Path = APIA_ZIP) -> Path:
    """Write MASK over Alba's bounding box: bit APIA = a 'TA' parcel, bit EUCROPMAP = an arable
    class in EUCROPMAP 2022 (uint8, deflate). Without the APIA zip only the EUCROPMAP bit is set;
    the tag SOURCES records the bits built."""
    nuts = RAW / "boundaries" / "NUTS_2024.gpkg"
    alba = gpd.read_file(nuts, where=f"NUTS_ID = '{COUNTIES['AB']}'").to_crs(CRS)
    minx, miny, maxx, maxy = alba.total_bounds
    x0, y1 = math.floor(minx / RES) * RES, math.ceil(maxy / RES) * RES
    w, h = math.ceil((maxx - x0) / RES), math.ceil((y1 - miny) / RES)
    tf = Affine(RES, 0, x0, 0, -RES, y1)
    arr = np.zeros((h, w), "uint8")
    built = EUCROPMAP
    if Path(zip_path).exists():
        parcels = pyogrio.read_dataframe(
            f"/vsizip/{zip_path}/ipa_2025_f.shp",
            bbox=(x0, y1 - h * RES, x0 + w * RES, y1),
            where="cat_use = 'TA'",
            columns=["cat_use"],
        )
        rasterize(((g, APIA) for g in parcels.geometry), out=arr, transform=tf)
        built |= APIA
        print(f"APIA: {len(parcels)} TA parcels")
    else:
        print(f"APIA zip not found ({zip_path}): mask from EUCROPMAP 2022 alone")
    codes = np.zeros((h, w), "int16")
    with rasterio.open(cropmap.path(2022)) as src:
        reproject(
            rasterio.band(src, 1),
            codes,
            dst_transform=tf,
            dst_crs=CRS,
            resampling=Resampling.nearest,
        )
    arr[np.isin(codes, cropmap.ARABLE)] |= EUCROPMAP
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
        dst.update_tags(SOURCES=built)
    part.rename(MASK)
    shares = {s: f"{((arr & b) > 0).mean():.1%}" for s, b in [("APIA", 1), ("EUCROPMAP", 2)]}
    print(f"{MASK} ({w}x{h}), arable share of the box: {shares}, either {(arr > 0).mean():.1%}")
    return MASK


if __name__ == "__main__":
    zip_path = Path(sys.argv[1]) if len(sys.argv) > 1 else APIA_ZIP
    if not built_sources() or (zip_path.exists() and not built_sources() & APIA):
        build(zip_path)  # missing, untagged, or built before the APIA zip arrived
    lat, lon = DEMO_FIELD
    fr, e, a = (hex_fractions(lat, lon, sources=s) for s in (None, EUCROPMAP, APIA))
    assert fr is not None and e is not None, "demo field outside the mask"
    assert len(fr) == 37 == len(set(fr)), len(fr)
    assert all(0 <= v <= 1 for v in fr.values()), fr
    if a is not None:  # union: at least either source, at most their sum (+0.01 for rounding)
        assert all(max(a[i], e[i]) <= fr[i] <= a[i] + e[i] + 0.01 for i in fr), (a, e, fr)
    area_ha = sum(p.area for p in hexes(lat, lon).values()) / 10_000
    assert abs(area_ha - 37) <= 0.37, area_ha
    # rings: the 20-ring grid holds the 3-ring grid unchanged; area 1261 ha +-1 %
    big = hex_fractions(lat, lon, rings=MAX_RINGS)
    assert big is not None and len(big) == 3 * 20 * 21 + 1, big and len(big)
    assert all(big[i] == fr[i] for i in fr)
    big_ha = sum(p.area for p in hexes(lat, lon, MAX_RINGS).values()) / 10_000
    assert abs(big_ha - 1261) <= 12.61, big_ha
    try:
        hexes(lat, lon, MAX_RINGS + 1)
        raise AssertionError("rings > MAX_RINGS accepted")
    except ValueError:
        pass
    assert hex_fractions(44.0, 26.0) is None  # Bucharest: outside the Alba mask
    # a mask built without APIA answers None (unknown) for APIA, not 0, and still serves EUCROPMAP
    full = MASK
    with tempfile.TemporaryDirectory() as d:
        MASK = Path(d) / "no_apia.tif"
        build(Path(d) / "missing.zip")
        assert hex_fractions(lat, lon, sources=APIA) is None, "APIA-less mask gave an APIA value"
        assert hex_fractions(lat, lon) == e
    MASK = full
    means = {
        k: None if v is None else round(float(np.mean(list(v.values()))), 2)
        for k, v in zip(("APIA", "EUCROPMAP", "either"), (a, e, fr), strict=True)
    }
    print(f"demo field {lat},{lon}: 37 hexes, {area_ha:.2f} ha; mean cropland {means}")
    print(f"20 rings: {len(big)} hexes, {big_ha:.1f} ha")
    print(fr)
