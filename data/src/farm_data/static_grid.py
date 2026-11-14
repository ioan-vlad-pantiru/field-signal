"""Static inputs of the trained crop model on the planner grid: soil and terrain per cell.

    uv run --package farm-data python -m farm_data.static_grid

Writes `cache/static_grid.npz`: int16 arrays [1880, 3840] on the planner grid (EPSG:4326, step
0.0025°, west 20.2, north 48.3; row 0 is the north edge). Each channel matches the model's
training features (`model/code/gee.py`, `_soil` and `_srtm`):

    clay, sand   % (x10)      SoilGrids 2.0 mean, 0-30 cm thickness-weighted (5:10:15)
    soc          g/kg (x10)   same
    ph           pH H2O (x100) same
    elevation    m (x1)       DEM at the cell centre (nearest native pixel)
    slope        degrees (x100) slope of the native DEM (central differences), at the centre

value = stored / scale; -32768 = no data (sea, outside SoilGrids or the DEM). The scales are
also stored as JSON in the `scale` entry. A cell is no data in every channel if any is missing.

Also writes `cache/power_cell_elevation.csv` (cell_id, elevation_m): mean elevation of the valid
cells inside each NASA POWER cell box (0.5° x 0.625°) listed in the planner's weather table.

Sources:
- ISRIC SoilGrids 2.0, WCS at 0.0025° (aligned with the planner grid), CC BY 4.0.
- Copernicus GLO-30 DEM, public COG tiles on AWS (`copernicus-dem-30m`), © DLR e.V. 2010-2014
  and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the EU and ESA;
  free licence. The model was trained on SRTMGL1 (30 m); GLO-30 is the closest open stand-in.
  Sea tiles that do not exist (404) are skipped. Slope at tile edges uses one-sided differences.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import rasterio
import requests

from farm_data import CACHE, DATA_DIR, RAW
from farm_data.soil import DEPTHS, WCS

STEP, WEST, NORTH, COLS, ROWS = 0.0025, 20.2, 48.3, 3840, 1880
EAST, SOUTH = WEST + COLS * STEP, NORTH - ROWS * STEP  # 29.8, 43.6
SOIL_DIR = RAW / "soilgrids_grid"
DEM_DIR = RAW / "copernicus_dem30"
DEM_URL = (
    "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N{la:02d}_00_E{lo:03d}_00_DEM/"
    "Copernicus_DSM_COG_10_N{la:02d}_00_E{lo:03d}_00_DEM.tif"
)
WEATHER = DATA_DIR.parent / "services/api/src/api/planner/data/weather_monthly.csv.gz"
OUT = CACHE / "static_grid.npz"
POWER_OUT = CACHE / "power_cell_elevation.csv"
SOIL = {"clay": "clay", "sand": "sand", "soc": "soc", "ph": "phh2o"}  # channel -> SoilGrids name
SCALE = {"clay": 10, "sand": 10, "soc": 10, "ph": 100, "elevation": 1, "slope": 100}
NODATA = -32768
DLAT, DLON = 0.5, 0.625  # NASA POWER cell
_A, _E2 = 6378137.0, 0.00669437999014  # WGS84


def download_soil() -> None:
    SOIL_DIR.mkdir(parents=True, exist_ok=True)
    for p in SOIL.values():
        for d in DEPTHS:
            out = SOIL_DIR / f"{p}_{d}_mean.tif"
            if out.exists():
                continue
            url = WCS.format(p=p, d=d, w=WEST, e=EAST, s=SOUTH, n=NORTH)
            r = requests.get(url, timeout=900)
            r.raise_for_status()
            part = out.with_suffix(".part")
            part.write_bytes(r.content)
            part.rename(out)
            print("soilgrids", out.name, len(r.content) // 2**20, "MB")


def _dem_tile(la: int, lo: int) -> None:
    out = DEM_DIR / f"N{la:02d}_E{lo:03d}.tif"
    if out.exists() or out.with_suffix(".missing").exists():
        return
    r = requests.get(DEM_URL.format(la=la, lo=lo), timeout=900)
    if r.status_code == 404:  # sea tile
        out.with_suffix(".missing").touch()
        return
    r.raise_for_status()
    part = out.with_suffix(".part")
    part.write_bytes(r.content)
    part.rename(out)


def download_dem() -> None:
    DEM_DIR.mkdir(parents=True, exist_ok=True)
    tiles = [(la, lo) for la in range(int(SOUTH), int(NORTH) + 1) for lo in range(int(WEST), int(EAST) + 1)]
    with ThreadPoolExecutor(4) as pool:
        list(pool.map(lambda t: _dem_tile(*t), tiles))


def _grid_window(transform) -> tuple[int, int]:
    """(row, col) offset of a raster's origin on the planner grid; it must sit on the grid."""
    assert abs(transform.a - STEP) < 1e-9 and abs(transform.e + STEP) < 1e-9, transform
    r, c = (NORTH - transform.f) / STEP, (transform.c - WEST) / STEP
    assert abs(r - round(r)) < 1e-6 and abs(c - round(c)) < 1e-6, transform
    return round(r), round(c)


def soil_grid() -> dict[str, np.ndarray]:
    """0-30 cm channels on the grid, float32, NaN where SoilGrids has no data (0)."""
    out = {}
    for ch, p in SOIL.items():
        acc = np.zeros((ROWS, COLS), np.float32)
        for d, w in DEPTHS.items():
            with rasterio.open(SOIL_DIR / f"{p}_{d}_mean.tif") as src:
                r0, c0 = _grid_window(src.transform)
                v = src.read(1).astype(np.float32)
            full = np.full((ROWS, COLS), np.nan, np.float32)
            rr, cc = slice(max(r0, 0), min(r0 + v.shape[0], ROWS)), slice(max(c0, 0), min(c0 + v.shape[1], COLS))
            full[rr, cc] = v[rr.start - r0 : rr.stop - r0, cc.start - c0 : cc.stop - c0]
            acc += np.where(full > 0, full, np.nan) * w
        out[ch] = acc / sum(DEPTHS.values()) / 10
    return out


def _metres_per_degree(lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    w = np.sqrt(1 - _E2 * np.sin(np.radians(lat)) ** 2)
    k = np.pi / 180
    return k * _A * np.cos(np.radians(lat)) / w, k * _A * (1 - _E2) / w**3


def dem_grid() -> tuple[np.ndarray, np.ndarray]:
    """Elevation (m) and slope (degrees) at each cell centre, nearest native DEM pixel."""
    elev = np.full((ROWS, COLS), np.nan, np.float32)
    slope = np.full((ROWS, COLS), np.nan, np.float32)
    lat_c = NORTH - (np.arange(ROWS) + 0.5) * STEP
    lon_c = WEST + (np.arange(COLS) + 0.5) * STEP
    for f in sorted(DEM_DIR.glob("*.tif")):
        with rasterio.open(f) as src:
            z = src.read(1).astype(np.float32)
            t, nd = src.transform, src.nodata
        if nd is not None:
            z[z == nd] = np.nan
        lats = t.f + (np.arange(z.shape[0]) + 0.5) * t.e  # pixel-centre latitudes
        mx, my = _metres_per_degree(lats)
        dzdy, dzdx = np.gradient(z)  # per pixel; rows run south
        dzdx /= (t.a * mx)[:, None]
        dzdy /= (-t.e * my)[:, None]
        s = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
        # Planner cells whose centre falls in this tile -> nearest native pixel.
        rows = np.flatnonzero((lat_c < t.f) & (lat_c > t.f + z.shape[0] * t.e))
        cols = np.flatnonzero((lon_c > t.c) & (lon_c < t.c + z.shape[1] * t.a))
        pr = np.floor((lat_c[rows] - t.f) / t.e).astype(int)
        pc = np.floor((lon_c[cols] - t.c) / t.a).astype(int)
        elev[np.ix_(rows, cols)] = z[np.ix_(pr, pc)]
        slope[np.ix_(rows, cols)] = s[np.ix_(pr, pc)]
    return elev, slope


def power_cells(elev: np.ndarray) -> pd.DataFrame:
    ids = sorted(pd.read_csv(WEATHER, usecols=["cell_id"])["cell_id"].unique())
    lat_c = NORTH - (np.arange(ROWS) + 0.5) * STEP
    lon_c = WEST + (np.arange(COLS) + 0.5) * STEP
    rows = []
    for cid in ids:
        la, lo = map(float, cid.split("_"))
        r = (lat_c >= la - DLAT / 2) & (lat_c < la + DLAT / 2)
        c = (lon_c >= lo - DLON / 2) & (lon_c < lo + DLON / 2)
        rows.append((cid, round(float(np.nanmean(elev[np.ix_(r, c)])), 1)))
    return pd.DataFrame(rows, columns=["cell_id", "elevation_m"])


def quantise(chans: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    valid = np.logical_and.reduce([np.isfinite(v) for v in chans.values()])
    out = {}
    for k, v in chans.items():
        q = np.round(np.where(valid, v, 0) * SCALE[k])
        out[k] = np.where(valid, np.clip(q, NODATA + 1, 32767), NODATA).astype(np.int16)
    return out


def _report(chans: dict[str, np.ndarray]) -> None:
    train = {"clay": (36.0, 9.2), "sand": (24.5, 12.4), "soc": (19.8, 3.1), "ph": (6.9, 0.49),
             "elevation": (175, 163), "slope": (2.34, 2.06)}  # fmt: skip
    valid = np.logical_and.reduce([np.isfinite(v) for v in chans.values()])
    print(f"cells with data: {valid.mean():.1%} of {valid.size}")
    print(f"{'channel':10} {'min':>8} {'median':>8} {'max':>8} {'mean':>8} {'std':>8}  train mean/std")
    for k, v in chans.items():
        x = v[valid]
        m, s = train[k]
        print(f"{k:10} {x.min():8.2f} {np.median(x):8.2f} {x.max():8.2f} {x.mean():8.2f} {x.std():8.2f}  {m}/{s}")


if __name__ == "__main__":
    download_soil()
    download_dem()
    chans = soil_grid()
    chans["elevation"], chans["slope"] = dem_grid()
    _report(chans)
    q = quantise(chans)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT, **q, scale=np.array(json.dumps({**SCALE, "nodata": NODATA})))
    print(f"{OUT.name}: {OUT.stat().st_size / 2**20:.1f} MB")
    elev = np.where(q["elevation"] != NODATA, q["elevation"], np.nan).astype(np.float32)
    pc = power_cells(elev)
    pc.to_csv(POWER_OUT, index=False)
    print(f"{POWER_OUT.name}: {len(pc)} cells, {pc['elevation_m'].isna().sum()} without land")
