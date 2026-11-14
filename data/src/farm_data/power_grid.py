"""NASA POWER daily regional grid for Romania -> monthly weather table for the farm planner.

    uv run --package farm-data python -m farm_data.power_grid

Downloads the daily grid (community AG, NetCDF, one file per variable and year) into
`raw/power_grid/<PARAM>/<PARAM>_<year>.nc`, skipping files that exist, then writes
`services/api/src/api/planner/data/weather_monthly.csv.gz`: one row per cell, year and month for
every POWER meteorology cell (MERRA-2, 0.5° x 0.625°) whose box touches Romania, complete years
1981 to last year. `cell_id` is "{lat:.3f}_{lon:.3f}" of the cell centre.

Thresholds: frost day Tmin < 0 °C, dry day rain < 1 mm (ETCCDI FD, CDD); hot day Tmax >= 30 °C is
a placeholder. The longest dry spell is counted inside the month. Romania outline: GISCO NUTS 2024
(`raw/boundaries/NUTS_2024.gpkg`). Source: https://power.larc.nasa.gov, no account needed.
"""

from __future__ import annotations

import time
from datetime import date

import geopandas as gpd
import pandas as pd
import requests
import xarray as xr
from shapely.geometry import box

from farm_data import DATA_DIR, RAW

URL = "https://power.larc.nasa.gov/api/temporal/daily/regional"
SRC = RAW / "power_grid"
NUTS = RAW / "boundaries" / "NUTS_2024.gpkg"
OUT = DATA_DIR.parent / "services/api/src/api/planner/data/weather_monthly.csv.gz"
BBOX = (20.2, 43.6, 29.8, 48.3)  # west, south, east, north: Romania
FIRST_YEAR = 1981  # start of the POWER record
NAMES = {"T2M_MAX": "tmax", "T2M_MIN": "tmin", "PRECTOTCORR": "rain", "GWETROOT": "gwetroot"}
DLAT, DLON = 0.5, 0.625
# ponytail: the 30 °C hot-day cut-off is a placeholder for the world-model owner, not a crop value.
HOT_C, FROST_C, DRY_MM = 30.0, 0.0, 1.0
KEYS = ["cell_id", "year", "month"]


def download(last_year: int) -> None:
    w, s, e, n = BBOX
    for p in NAMES:
        for y in range(FIRST_YEAR, last_year + 1):
            f = SRC / p / f"{p}_{y}.nc"
            if f.exists():
                continue
            r = requests.get(
                URL,
                params={
                    "parameters": p,
                    "community": "AG",
                    "latitude-min": s,
                    "latitude-max": n,
                    "longitude-min": w,
                    "longitude-max": e,
                    "start": f"{y}0101",
                    "end": f"{y}1231",
                    "format": "NETCDF",
                },
                timeout=300,
            )
            r.raise_for_status()
            f.parent.mkdir(parents=True, exist_ok=True)
            tmp = f.with_suffix(".part")
            tmp.write_bytes(r.content)
            tmp.rename(f)
            time.sleep(1.5)  # be gentle with the public API


def daily(last_year: int) -> pd.DataFrame:
    cols = {}
    for p, name in NAMES.items():
        files = [SRC / p / f"{p}_{y}.nc" for y in range(FIRST_YEAR, last_year + 1)]
        da = xr.concat([xr.open_dataset(f)[p] for f in files], "time")
        cols[name] = da.where(da > -998).to_series()  # POWER fill value is -999
    d = pd.DataFrame(cols).reset_index()
    nuts = gpd.read_file(NUTS)
    ro = nuts[(nuts.LEVL_CODE == 0) & (nuts.CNTR_CODE == "RO")].to_crs(4326).geometry.iloc[0]
    cells = d[["lat", "lon"]].drop_duplicates()
    touches = [
        ro.intersects(box(x - DLON / 2, y - DLAT / 2, x + DLON / 2, y + DLAT / 2))
        for y, x in zip(cells.lat, cells.lon, strict=True)
    ]
    d = d.merge(cells[touches])
    assert not d[list(NAMES.values())].isna().any().any(), "gaps in the POWER grid"
    n_days = len(pd.date_range(f"{FIRST_YEAR}-01-01", f"{last_year}-12-31"))
    assert (d.groupby(["lat", "lon"]).size() == n_days).all(), "missing days"
    d["cell_id"] = d.lat.map("{:.3f}".format) + "_" + d.lon.map("{:.3f}".format)
    d["year"], d["month"] = d.time.dt.year, d.time.dt.month
    return d.sort_values([*KEYS, "time"], ignore_index=True)


def monthly(d: pd.DataFrame) -> pd.DataFrame:
    d = d.assign(hot=d.tmax >= HOT_C, frost=d.tmin < FROST_C, dry=d.rain < DRY_MM)
    grp = [d[k] for k in KEYS]
    # Longest dry spell inside the month: the run length restarts after every wet day.
    d["run"] = d.dry.groupby([*grp, (~d.dry).groupby(grp).cumsum()]).cumsum()
    m = d.groupby(KEYS).agg(
        tmax_mean_c=("tmax", "mean"),
        tmin_mean_c=("tmin", "mean"),
        rain_mm=("rain", "sum"),
        hot_days=("hot", "sum"),
        frost_days=("frost", "sum"),
        longest_dry_spell_days=("run", "max"),
        gwetroot_mean=("gwetroot", "mean"),
    )
    return m.round({"tmax_mean_c": 1, "tmin_mean_c": 1, "rain_mm": 1, "gwetroot_mean": 3})


if __name__ == "__main__":
    last = date.today().year - 1  # complete years only
    download(last)
    m = monthly(daily(last))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    m.to_csv(OUT, compression={"method": "gzip", "mtime": 0})
    cells = m.index.get_level_values("cell_id").nunique()
    print(f"{OUT.name}: {cells} cells, {FIRST_YEAR}-{last}, {len(m)} rows, {OUT.stat().st_size} B")
