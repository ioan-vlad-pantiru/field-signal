"""MODIS NDVI/EVI at the zone sample points from a local MODIS VI cube, so `ndvi_peak` exists
for points the AppEEARS task does not cover (or before it finishes).

The cube is not in the repo (a large raster); pass its folder. One NetCDF per year, 2001-2026:
Microsoft Planetary Computer collection `modis-13Q1-061` (MOD13Q1 Terra + MYD13Q1 Aqua v061,
16-day composites), bands 250m_16_days_NDVI and 250m_16_days_EVI as raw int16, loaded with
odc-stac on a 0.01 deg EPSG:4326 grid (nearest resampling, one slice per solar day) over
16-31 E, 41.2-48.8 N.

    uv run --package farm-data python -m farm_data.modis_cube <cube_dir>

Output data/cache/modis_cube/modis.parquet, the columns of appeears' modis.parquet:
zone_id, point, date (composite start), ndvi, evi (x 0.0001; fill dropped), reliability (null:
the cube has no QA layer, so cloud/snow composites cannot be screened out), satellite
(MOD13Q1 composites start on day-of-year 1+16k = terra, MYD13Q1 on 9+16k = aqua).

Caveat: each value is one 0.01 deg cell (~1 km), coarser than the 250 m pixel AppEEARS returns.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio

from farm_data import CACHE, zones

OUT = CACHE / "modis_cube"
VARS = {"ndvi": "250m_16_days_NDVI", "evi": "250m_16_days_EVI"}
VALID = (-2000, 10000)  # MOD13Q1 valid raw range; fill (-3000) and off-swath values fall outside


def _sample(path: Path, var: str, lon: np.ndarray, lat: np.ndarray) -> tuple[pd.Index, np.ndarray]:
    """(composite dates, scaled values points x dates) for one variable of one year file."""
    # GDAL reports no CRS for these files; the grid is EPSG:4326, so lon/lat index it directly
    with rasterio.open(f"netcdf:{path}:{var}") as ds:
        units = ds.tags()["time#units"]
        assert units.startswith("days since "), units
        days = [int(ds.tags(b)["NETCDF_DIM_time"]) for b in ds.indexes]
        dates = pd.Timestamp(units.removeprefix("days since ")) + pd.to_timedelta(days, unit="D")
        raw = np.array(list(ds.sample(zip(lon, lat, strict=True))), dtype="float64")
    ok = (raw >= VALID[0]) & (raw <= VALID[1])
    return dates, np.where(ok, raw * 0.0001, np.nan)


def build(cube_dir: Path) -> pd.DataFrame:
    _, pts = zones.load()
    lon, lat = pts["lon"].to_numpy(), pts["lat"].to_numpy()
    frames = []
    for f in sorted(cube_dir.glob("*.nc")):
        (dates, ndvi), (evi_dates, evi) = (_sample(f, v, lon, lat) for v in VARS.values())
        assert dates.equals(evi_dates), f
        frames.append(
            pd.DataFrame(
                {
                    "i": np.repeat(np.arange(len(pts)), len(dates)),
                    "date": np.tile(dates, len(pts)),
                    "ndvi": ndvi.ravel(),
                    "evi": evi.ravel(),
                }
            )
        )
    if not frames:
        raise FileNotFoundError(f"no *.nc in {cube_dir}")
    # a composite that straddles New Year sits in both year files
    df = pd.concat(frames, ignore_index=True).drop_duplicates(["i", "date"])
    df = df.dropna(subset=["ndvi", "evi"], how="all")
    doy = df["date"].dt.day_of_year
    assert ((doy - 1) % 8 == 0).all(), "date off the MOD13Q1/MYD13Q1 composite calendar"
    df = df.assign(
        zone_id=pts["zone_id"].to_numpy()[df["i"]],
        point=pts["point"].to_numpy()[df["i"]],
        ndvi=df["ndvi"].round(4),
        evi=df["evi"].round(4),
        reliability=pd.array([pd.NA] * len(df), dtype="Int8"),
        satellite=np.where((doy - 1) % 16 == 0, "terra", "aqua"),
    )
    cols = ["zone_id", "point", "date", "ndvi", "evi", "reliability", "satellite"]
    return df[cols].sort_values(["zone_id", "point", "date"], ignore_index=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    df = build(Path(sys.argv[1]))
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT / "modis.parquet", index=False)
    print(f"{len(df)} rows, {df['date'].min():%Y-%m-%d}..{df['date'].max():%Y-%m-%d} -> {OUT}")
