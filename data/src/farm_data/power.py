"""NASA POWER daily agroclimate at a point, cached as parquet, plus FAO-56 reference ET.

    from farm_data.power import fetch
    df = fetch(46.30, 23.75, date(2001, 1, 1), date(2025, 12, 31))

Columns (index `date`): T2M, T2M_MAX, T2M_MIN (°C), PRECTOTCORR (mm/day), RH2M (%),
ALLSKY_SFC_SW_DWN (MJ/m²/day), WS2M (m/s), GWETROOT, GWETTOP (0-1), ET0 (mm/day, computed).

Source: NASA POWER daily point API, community AG (https://power.larc.nasa.gov). Meteorology is
MERRA-2 (0.5° x 0.625°), solar is CERES/GEWEX (1°): one value per grid cell, not per field.
No account needed. Cache: data/cache/power/<lat>_<lon>_<start>_<end>.parquet.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import requests

from farm_data import CACHE

URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
PARAMS = [
    "T2M",
    "T2M_MAX",
    "T2M_MIN",
    "PRECTOTCORR",
    "RH2M",
    "ALLSKY_SFC_SW_DWN",
    "WS2M",
    "GWETROOT",
    "GWETTOP",
]
FILL = -999.0
DIR = CACHE / "power"


def fetch(lat: float, lon: float, start: date, end: date) -> pd.DataFrame:
    path = DIR / f"{lat:.4f}_{lon:.4f}_{start:%Y%m%d}_{end:%Y%m%d}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    r = requests.get(
        URL,
        params={
            "parameters": ",".join(PARAMS),
            "community": "AG",
            "latitude": lat,
            "longitude": lon,
            "start": f"{start:%Y%m%d}",
            "end": f"{end:%Y%m%d}",
            "format": "JSON",
            "time-standard": "UTC",
        },
        timeout=300,
    )
    r.raise_for_status()
    body = r.json()
    units = body["parameters"]["ALLSKY_SFC_SW_DWN"]["units"]
    if units != "MJ/m^2/day":
        raise ValueError(f"POWER solar units changed: {units}")
    df = pd.DataFrame(body["properties"]["parameter"]).replace(FILL, np.nan).astype(float)
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df.index.name = "date"
    elev = float(body["geometry"]["coordinates"][2])
    df["ET0"] = et0(df, lat, elev)
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    df.to_parquet(tmp)
    tmp.rename(path)
    return df


def _es(t: np.ndarray | pd.Series) -> np.ndarray | pd.Series:
    return 0.6108 * np.exp(17.27 * t / (t + 237.3))  # kPa, FAO-56 eq. 11


def et0(df: pd.DataFrame, lat: float, elev_m: float) -> pd.Series:
    """FAO-56 Penman-Monteith reference ET (mm/day) from daily POWER fields (FAO-56 eqs 7-39;
    actual vapour pressure from mean RH, eq. 19)."""
    tmax, tmin, rh = df["T2M_MAX"], df["T2M_MIN"], df["RH2M"]
    u2, rs = df["WS2M"], df["ALLSKY_SFC_SW_DWN"]
    t = (tmax + tmin) / 2
    es = (_es(tmax) + _es(tmin)) / 2
    ea = rh / 100 * es
    delta = 4098 * _es(t) / (t + 237.3) ** 2
    gamma = 0.000665 * 101.3 * ((293 - 0.0065 * elev_m) / 293) ** 5.26
    j = df.index.day_of_year.to_numpy()
    phi = np.radians(lat)
    dr = 1 + 0.033 * np.cos(2 * np.pi * j / 365)
    dec = 0.409 * np.sin(2 * np.pi * j / 365 - 1.39)
    ws = np.arccos(-np.tan(phi) * np.tan(dec))
    ra = (
        24 * 60 / np.pi * 0.0820 * dr
        * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    )  # fmt: skip
    rso = (0.75 + 2e-5 * elev_m) * ra
    rnl = (
        4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2
        * (0.34 - 0.14 * np.sqrt(ea))
        * (1.35 * np.minimum(rs / rso, 1.0) - 0.35)
    )  # fmt: skip
    rn = 0.77 * rs - rnl
    out = (0.408 * delta * rn + gamma * 900 / (t + 273) * u2 * (es - ea)) / (
        delta + gamma * (1 + 0.34 * u2)
    )
    return out.clip(lower=0).round(2)


def _check_fao56() -> None:
    """FAO-56 Example 18 (Uccle, 6 July, 50.8°N, 100 m): ET0 = 3.9 mm/day. The example uses
    RHmax/RHmin; with their mean (73.5%) the result is ~3.8."""
    ex = pd.DataFrame(
        {
            "T2M_MAX": [21.5],
            "T2M_MIN": [12.3],
            "RH2M": [73.5],
            "WS2M": [2.078],
            "ALLSKY_SFC_SW_DWN": [22.07],
        },
        index=pd.to_datetime(["2026-07-06"]),
    )
    v = float(et0(ex, 50.8, 100).iloc[0])
    assert abs(v - 3.9) < 0.2, v


if __name__ == "__main__":
    _check_fao56()
    df = fetch(46.30, 23.75, date(2024, 1, 1), date(2024, 12, 31))
    print(df.describe().T[["mean", "min", "max"]].round(2))
    print(
        "ET0 2024 (mm):", round(df["ET0"].sum()), " rain 2024 (mm):", round(df["PRECTOTCORR"].sum())
    )
