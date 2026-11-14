"""Build the parcel file for "tap your parcel" from APIA's open LPIS layer.

Input: the parcels declared to APIA in the 2025 single applications (data.gov.ro, CC BY 4.0),
https://data.gov.ro/dataset/parcele_agricole_agionline_apia — download the zip (1.6 GB), then:

    uv run --all-packages python data/scripts/build_apia_parcels.py \
        path/to/parcele_fermieri_apia_agi_online.zip

Each parcel also gets its mapped crop history and topsoil (skip with --no-enrich). That needs
the rasters under data/raw/, clipped to an area covering the county:

    uv run --package farm-data python -m farm_data.cropmap   # JRC EUCROPMAP 2018 + 2022, 10 m
    uv run --package farm-data python -m farm_data.soil      # ISRIC SoilGrids 2.0, 250 m

- crop_history: per year, the majority EUCROPMAP class over the 10 m pixels whose centre falls
  inside the parcel, and its share of those pixels (crop null if none / all nodata).
- soil: SoilGrids 0-30 cm (thickness-weighted 0-5/5-15/15-30 cm, as farm_data.soil) averaged
  over the 250 m pixels whose centre falls inside the parcel; most parcels are smaller than a
  pixel, so those take the pixel under their centroid.

Output: services/api/parcels/apia_parcels_alba.sqlite, read by the API (api.parcels). Publish it
for the deploy with:

    gh release create apia-parcels-2025 services/api/parcels/apia_parcels_alba.sqlite  # first time
    gh release upload apia-parcels-2025 services/api/parcels/apia_parcels_alba.sqlite --clobber
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import pyogrio
import rasterio
import shapely
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.windows import Window

from api.parcels import ParcelRow, write_db
from farm_data import cropmap, soil

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "services" / "api" / "parcels" / "apia_parcels_alba.sqlite"

# The layer says "Dealul Piscului 1970 / Stereo 70" but carries no datum shift, which would put
# every outline 100 m or more off. EPSG:3844 is the same projection with the official shift.
SOURCE_CRS = "EPSG:3844"
# Outlines are simplified by up to this many metres (in Stereo 70, before reprojecting).
SIMPLIFY_M = 1.0
# The API and saved fields accept at most 500 corners.
MAX_CORNERS = 500
# Five decimals is about 1 m: plenty for a field outline, and it halves the file.
DECIMALS = 5
CROP_YEARS = (2018, 2022)
# Crop-map rows rasterized at once (10 m pixels; ~2k rows x ~13k columns per tile for Alba).
TILE_ROWS = 2048


def outer_ring(geom: shapely.Geometry) -> list[tuple[float, float]] | None:
    """The largest polygon's outer ring, simplified, without the closing point."""
    if isinstance(geom, shapely.MultiPolygon):
        geom = max(geom.geoms, key=lambda g: g.area)
    if not isinstance(geom, shapely.Polygon) or geom.is_empty:
        return None
    ring = shapely.Polygon(geom.exterior)
    tolerance = SIMPLIFY_M
    simple = ring.simplify(tolerance, preserve_topology=True)
    while len(simple.exterior.coords) - 1 > MAX_CORNERS:
        tolerance *= 2
        simple = ring.simplify(tolerance, preserve_topology=True)
    coords = list(simple.exterior.coords)[:-1]
    return coords if len(coords) >= 3 else None


def reproject(geoms: np.ndarray, crs: Any) -> np.ndarray:
    tf = Transformer.from_crs(SOURCE_CRS, crs, always_xy=True)
    return shapely.transform(geoms, lambda xy: np.column_stack(tf.transform(xy[:, 0], xy[:, 1])))


def crop_history(geoms: np.ndarray, year: int) -> list[dict[str, Any]]:
    """Majority EUCROPMAP class and its share per parcel, by rasterizing parcel numbers on the
    map's own grid tile by tile and counting (parcel, class) pairs."""
    codes = sorted(cropmap.LEGEND)
    lut = np.zeros(1000, dtype=np.int16)  # map code -> class index + 1; 0 = nodata / unknown
    for i, c in enumerate(codes):
        lut[c] = i + 1
    n_cls = len(codes) + 1
    counts = np.zeros(len(geoms) * n_cls, dtype=np.int64)
    with rasterio.open(cropmap.path(year)) as src:
        g = reproject(geoms, src.crs)
        bounds = shapely.bounds(g)
        x0, y1 = src.bounds.left, src.bounds.top
        res = src.res[0]
        # Parcel bounds as pixel rows (row grows southwards).
        r_top = np.floor((y1 - bounds[:, 3]) / res)
        r_bot = np.ceil((y1 - bounds[:, 1]) / res)
        inside = (bounds[:, 0] < src.bounds.right) & (bounds[:, 2] > x0)
        for r in range(0, src.height, TILE_ROWS):
            h = min(TILE_ROWS, src.height - r)
            sel = np.nonzero(inside & (r_bot > r) & (r_top < r + h))[0]
            if len(sel) == 0:
                continue
            win = Window(0, r, src.width, h)
            labels = rasterize(
                zip(g[sel], sel + 1, strict=True),
                out_shape=(h, src.width),
                transform=src.window_transform(win),
                fill=0,
                dtype="int32",
            )
            hit = labels > 0
            vals = src.read(1, window=win)[hit]
            cls = lut[np.clip(vals, 0, 999)].astype(np.int64)
            counts += np.bincount(
                (labels[hit].astype(np.int64) - 1) * n_cls + cls, minlength=len(counts)
            )
    counts = counts.reshape(len(geoms), n_cls)
    total = counts.sum(axis=1)
    best = counts[:, 1:].argmax(axis=1)
    best_n = counts[np.arange(len(geoms)), best + 1]
    out = []
    for t, b, n in zip(total, best, best_n, strict=True):
        if n == 0:
            out.append({"year": year, "crop": None, "share": 0.0})
        else:
            out.append({"year": year, "crop": cropmap.LEGEND[codes[b]], "share": round(n / t, 2)})
    return out


def soil_0_30() -> tuple[dict[str, np.ndarray], Any]:
    """The four 0-30 cm SoilGrids layers as arrays (NaN = no data), plus their transform."""
    layers = {}
    for p, (col, div) in soil.PROPS.items():
        acc = None
        for d, w in soil.DEPTHS.items():
            with rasterio.open(soil.DIR / f"{p}_{d}_mean.tif") as src:
                v = src.read(1).astype(float)
                tf, crs = src.transform, src.crs
            v = np.where(v > 0, v, np.nan) * w
            acc = v if acc is None else acc + v
        layers[col] = acc / sum(soil.DEPTHS.values()) / div
    assert crs.to_epsg() == 4326, crs
    return layers, tf


def soil_means(geoms: np.ndarray) -> list[dict[str, float | None]]:
    """Mean 0-30 cm soil over the 250 m pixel centres inside each parcel, else the centroid's."""
    layers, tf = soil_0_30()
    height, width = next(iter(layers.values())).shape
    g = reproject(geoms, "EPSG:4326")
    inv = ~tf
    b = shapely.bounds(g)
    c0, r0 = inv * (b[:, 0], b[:, 3])
    c1, r1 = inv * (b[:, 2], b[:, 1])
    c0, r0 = np.floor(c0).astype(int), np.floor(r0).astype(int)
    nc = np.floor(c1).astype(int) - c0 + 1
    nr = np.floor(r1).astype(int) - r0 + 1
    # Every pixel whose cell overlaps the parcel's bounds, as (parcel, col, row) candidates.
    k = nc * nr
    idx = np.repeat(np.arange(len(g)), k)
    off = np.arange(k.sum()) - np.repeat(np.cumsum(k) - k, k)
    cols = c0[idx] + off % nc[idx]
    rows = r0[idx] + off // nc[idx]
    xs, ys = tf * (cols + 0.5, rows + 0.5)
    hit = shapely.contains_xy(g[idx], xs, ys)
    has = np.bincount(idx[hit], minlength=len(g)) > 0
    # Parcels with no pixel centre inside use the pixel under their centroid.
    cen = shapely.centroid(g[~has])
    cc, cr = inv * (shapely.get_x(cen), shapely.get_y(cen))
    p_idx = np.concatenate([idx[hit], np.nonzero(~has)[0]])
    p_col = np.concatenate([cols[hit], np.floor(cc).astype(int)])
    p_row = np.concatenate([rows[hit], np.floor(cr).astype(int)])
    ok = (p_col >= 0) & (p_col < width) & (p_row >= 0) & (p_row < height)
    p_idx, p_col, p_row = p_idx[ok], p_col[ok], p_row[ok]
    means = {}
    for col, arr in layers.items():
        v = arr[p_row, p_col]
        good = ~np.isnan(v)
        s = np.bincount(p_idx[good], weights=v[good], minlength=len(g))
        n = np.bincount(p_idx[good], minlength=len(g))
        with np.errstate(invalid="ignore", divide="ignore"):
            means[col] = np.round(s / n, 2)
    return [
        {col: None if np.isnan(m[i]) else float(m[i]) for col, m in means.items()}
        for i in range(len(g))
    ]


def enrich(geoms: np.ndarray) -> list[dict[str, Any] | None]:
    t = time.perf_counter()
    years = []
    for y in CROP_YEARS:
        years.append(crop_history(geoms, y))
        print(f"  crop map {y}: {time.perf_counter() - t:.0f} s")
    soils = soil_means(geoms)
    print(f"  soil: {time.perf_counter() - t:.0f} s")
    out: list[dict[str, Any] | None] = []
    for i, s in enumerate(soils):
        info = {
            "crop_history": [y[i] for y in years],
            "soil": s if any(v is not None for v in s.values()) else None,
        }
        out.append(info)
    return out


def rows(source: str, county: str, with_info: bool) -> Iterator[ParcelRow]:
    # The filtered column must be read too, or the shapefile driver returns nothing.
    df = pyogrio.read_dataframe(
        source, where=f"jud = '{county}'", columns=["gid", "cat_use", "area", "jud"]
    )
    print(f"{len(df):,} parcels in {county}")
    geoms = df.geometry.to_numpy()
    infos = enrich(geoms) if with_info else [None] * len(df)
    to_wgs84 = Transformer.from_crs(SOURCE_CRS, "EPSG:4326", always_xy=True)
    for gid, land_use, area, geom, info in zip(
        df["gid"], df["cat_use"], df["area"], geoms, infos, strict=True
    ):
        ring = outer_ring(geom)
        if ring is None:
            continue
        xs, ys = zip(*ring, strict=True)
        lons, lats = to_wgs84.transform(xs, ys)
        yield (
            int(gid),
            float(area),
            str(land_use) if land_use else None,
            [
                (round(lon, DECIMALS), round(lat, DECIMALS))
                for lon, lat in zip(lons, lats, strict=True)
            ],
            info,
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("zip", type=Path, help="the data.gov.ro zip (or the unzipped .shp)")
    parser.add_argument("--county", default="AB", help="county code, AB for Alba")
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument(
        "--no-enrich", action="store_true", help="skip crop history and soil (no rasters needed)"
    )
    args = parser.parse_args()

    path = args.zip.resolve()
    source = f"/vsizip/{path}" if path.suffix == ".zip" else str(path)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    count = write_db(args.out, rows(source, args.county, not args.no_enrich))
    size_mb = args.out.stat().st_size / 1e6
    print(f"wrote {count:,} parcels to {args.out.relative_to(REPO_ROOT)} ({size_mb:.0f} MB)")


if __name__ == "__main__":
    main()
