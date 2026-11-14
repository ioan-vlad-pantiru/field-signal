"""Monthly NASA POWER weather for the trained world model, built like the model's training inputs.

    uv run --package farm-data python -m farm_data.power_grid    # downloads, if not done yet
    uv run --package farm-data python -m farm_data.static_grid   # cell elevations for ET0
    uv run --package farm-data python -m farm_data.world_weather

Writes `services/api/src/api/planner/data/world_weather_monthly.csv.gz`: one row per POWER cell
(the cells of `weather_monthly.csv.gz`), year and month, from January 1984 (the first year of
POWER solar radiation) to the last complete year, with the ten channels of `model/code/build.py`
`build_weather` in its units and rules:

- t2m_max, t2m_min, rh2m, ws2m, solar: monthly means of the daily values (°C, %, m/s, MJ/m²/day);
- precip, et0: monthly sums (mm); et0 is daily FAO-56 Penman-Monteith (eq. 6, G = 0), the same
  formula as build.py `_fao56_et0`, with the cell centre latitude and the cell's mean DEM
  elevation (`data/cache/power_cell_elevation.csv`; build.py used the mean SRTM elevation of its
  sample points in the cell), negative daily values clamped to 0;
- solar comes on POWER's 1° grid: each cell takes the 1° cell nearest its centre (as the point API
  that fed build.py does); five missing days in 1987-1993 are filled linearly in time;
- hot_days: Tmax > 32 °C; frost_days: Tmin < 0 °C; dry_run_max: longest run of days with
  precipitation < 1 mm inside the month.

Source: https://power.larc.nasa.gov (community AG), no account needed.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import xarray as xr

from farm_data import CACHE, DATA_DIR
from farm_data.power_grid import SRC

OUT = DATA_DIR.parent / "services/api/src/api/planner/data/world_weather_monthly.csv.gz"
PLANNER = DATA_DIR.parent / "services/api/src/api/planner/data/weather_monthly.csv.gz"
ELEVATION = CACHE / "power_cell_elevation.csv"
FIRST_YEAR = 1984
PARAMS = {
    "T2M_MAX": "tmax",
    "T2M_MIN": "tmin",
    "RH2M": "rh",
    "WS2M": "ws",
    "ALLSKY_SFC_SW_DWN": "solar",
    "PRECTOTCORR": "rain",
}
CHANNELS = ["t2m_max", "t2m_min", "rh2m", "ws2m", "solar", "precip", "et0",
            "hot_days", "frost_days", "dry_run_max"]  # fmt: skip
SOLAR = "ALLSKY_SFC_SW_DWN"
HOT_C, FROST_C, DRY_MM = 32.0, 0.0, 1.0


def fao56_et0(tmax, tmin, rh, rs, u2, doy, lat_deg, z):  # type: ignore[no-untyped-def]
    """Copied from model/code/build.py `_fao56_et0` (MJ m-2 d-1 in, mm/day out)."""
    es_max = 0.6108 * np.exp(17.27 * tmax / (tmax + 237.3))
    es_min = 0.6108 * np.exp(17.27 * tmin / (tmin + 237.3))
    es = (es_max + es_min) / 2.0
    tmean = (tmax + tmin) / 2.0
    ea = rh / 100.0 * es
    delta = 4098.0 * (0.6108 * np.exp(17.27 * tmean / (tmean + 237.3))) / (tmean + 237.3) ** 2
    gamma = 0.000665 * 101.3 * ((293.0 - 0.0065 * z) / 293.0) ** 5.26
    phi = np.radians(lat_deg)
    doy = np.asarray(doy, dtype=np.float64)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365.0)
    dec = 0.409 * np.sin(2 * np.pi * doy / 365.0 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(dec), -1.0, 1.0))
    ra = (
        (24 * 60 / np.pi)
        * 0.0820
        * dr
        * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    )
    rso = np.maximum((0.75 + 2e-5 * z) * ra, 1e-6)
    rnl = (
        4.903e-9
        * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4)
        / 2.0
        * (0.34 - 0.14 * np.sqrt(np.maximum(ea, 0.0)))
        * (1.35 * rs / rso - 0.35)
    )
    rn = 0.77 * rs - rnl
    num = 0.408 * delta * rn + gamma * 900.0 / (tmean + 273.0) * u2 * (es - ea)
    return num / (delta + gamma * (1 + 0.34 * u2))


def daily(last_year: int, cells: set[str]) -> pd.DataFrame:
    def load(p: str) -> xr.DataArray:
        files = [SRC / p / f"{p}_{y}.nc" for y in range(FIRST_YEAR, last_year + 1)]
        da = xr.concat([xr.open_dataset(f)[p] for f in files], "time")
        return da.where(da > -998)

    cols = {name: load(p).to_series() for p, name in PARAMS.items() if p != SOLAR}
    d = pd.DataFrame(cols).reset_index()
    # Solar comes on POWER's 1° grid: each weather cell takes the 1° cell nearest its centre,
    # as the point API (which build.py's inputs came from) does.
    # A few 1° cells miss a single February day (1987, 1990, 1993): filled linearly in time.
    solar = load(SOLAR).interpolate_na("time")
    centres = d[["lat", "lon"]].drop_duplicates()
    picked = solar.sel(
        lat=xr.DataArray(centres.lat.to_numpy(), dims="c"),
        lon=xr.DataArray(centres.lon.to_numpy(), dims="c"),
        method="nearest",
    )
    s = picked.assign_coords(lat=("c", centres.lat.to_numpy()), lon=("c", centres.lon.to_numpy()))
    s = s.to_dataframe(name="solar").reset_index()[["time", "lat", "lon", "solar"]]
    d = d.merge(s, on=["time", "lat", "lon"], how="left")
    d["cell_id"] = d.lat.map("{:.3f}".format) + "_" + d.lon.map("{:.3f}".format)
    d = d[d.cell_id.isin(cells)]
    assert set(d.cell_id) == cells, f"cells missing: {sorted(cells - set(d.cell_id))[:5]}"
    gaps = d[list(PARAMS.values())].isna().sum()
    assert not gaps.any(), f"gaps in the POWER grid: {gaps[gaps > 0].to_dict()}"
    return d.sort_values(["cell_id", "time"], ignore_index=True)


def monthly(d: pd.DataFrame, elevation: pd.Series) -> pd.DataFrame:
    z = d.cell_id.map(elevation)
    assert z.notna().all(), "a POWER cell has no elevation"
    et0 = fao56_et0(
        d.tmax.to_numpy(), d.tmin.to_numpy(), d.rh.to_numpy(), d.solar.to_numpy(),
        d.ws.to_numpy(), d.time.dt.day_of_year.to_numpy(), d.lat.to_numpy(), z.to_numpy(),
    )  # fmt: skip
    assert np.isfinite(et0).all(), "ET0 is not finite"
    d = d.assign(
        et0=np.maximum(et0, 0.0),
        year=d.time.dt.year,
        month=d.time.dt.month,
        hot=d.tmax > HOT_C,
        frost=d.tmin < FROST_C,
        dry=d.rain < DRY_MM,
    )
    keys = ["cell_id", "year", "month"]
    grp = [d[k] for k in keys]
    d["run"] = d.dry.groupby([*grp, (~d.dry).groupby(grp).cumsum()]).cumsum()
    m = d.groupby(keys).agg(
        t2m_max=("tmax", "mean"),
        t2m_min=("tmin", "mean"),
        rh2m=("rh", "mean"),
        ws2m=("ws", "mean"),
        solar=("solar", "mean"),
        precip=("rain", "sum"),
        et0=("et0", "sum"),
        hot_days=("hot", "sum"),
        frost_days=("frost", "sum"),
        dry_run_max=("run", "max"),
    )
    annual = m.et0.groupby(["cell_id", "year"]).sum().groupby("cell_id").mean()
    print(f"ET0 annual mm per cell: min {annual.min():.0f}, median {annual.median():.0f}, "
          f"max {annual.max():.0f}")  # fmt: skip
    return m[CHANNELS].round(3)


if __name__ == "__main__":
    cells = set(pd.read_csv(PLANNER, usecols=["cell_id"]).cell_id)
    last = int(pd.read_csv(PLANNER, usecols=["year"]).year.max())
    elevation = pd.read_csv(ELEVATION).set_index("cell_id").elevation_m
    m = monthly(daily(last, cells), elevation)
    m.to_csv(OUT, compression={"method": "gzip", "mtime": 0})
    print(m.describe().T[["mean", "std", "min", "max"]].round(2))
    print(f"{OUT.name}: {len(cells)} cells, {FIRST_YEAR}-{last}, {len(m)} rows, "
          f"{OUT.stat().st_size} B")  # fmt: skip
