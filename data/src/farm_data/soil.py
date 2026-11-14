"""SoilGrids 2.0 topsoil (0-30 cm) at a point: SOC, pH, clay, sand.

ISRIC SoilGrids 2.0, 250 m (0.0025° WCS output), CC BY 4.0. The REST point API is paused, so
rasters come from the ISRIC WCS, clipped to the pilot area:

    uv run --package farm-data python -m farm_data.soil   # downloads data/raw/soilgrids/*.tif

    from farm_data.soil import at
    at(46.30, 23.75)  # {'soc_g_per_kg': 14.9, 'ph_h2o': 6.6, 'clay_pct': 33.1, 'sand_pct': 21.6}

0-30 cm = thickness-weighted mean of the 0-5, 5-15 and 15-30 cm layers (5:10:15). SoilGrids
values are model predictions (uncertainty maps exist; not used here), not field measurements.
"""

from __future__ import annotations

import urllib.request
from collections.abc import Sequence

import numpy as np
import pandas as pd
import rasterio

from farm_data import RAW

DIR = RAW / "soilgrids"
# SoilGrids property -> (contract column, divisor from SoilGrids integer units)
PROPS = {
    "soc": ("soc_g_per_kg", 10),  # dg/kg
    "phh2o": ("ph_h2o", 10),  # pH x 10
    "clay": ("clay_pct", 10),  # g/kg
    "sand": ("sand_pct", 10),  # g/kg
}
DEPTHS = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}
WCS = (
    "https://maps.isric.org/mapserv?map=/map/{p}.map&SERVICE=WCS&VERSION=2.0.1"
    "&REQUEST=GetCoverage&COVERAGEID={p}_{d}_mean&FORMAT=image/tiff"
    "&SUBSET=long({w},{e})&SUBSET=lat({s},{n})"
    "&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
    "&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
    "&RESOLUTION=long(0.0025)&RESOLUTION=lat(0.0025)"
)


def download(bbox: tuple[float, float, float, float]) -> None:
    w, s, e, n = bbox
    DIR.mkdir(parents=True, exist_ok=True)
    for p in PROPS:
        for d in DEPTHS:
            out = DIR / f"{p}_{d}_mean.tif"
            if not out.exists():
                part = out.with_suffix(".part")
                urllib.request.urlretrieve(WCS.format(p=p, d=d, w=w, e=e, s=s, n=n), part)
                part.rename(out)


def sample(lats: Sequence[float], lons: Sequence[float]) -> pd.DataFrame:
    """0-30 cm topsoil values for many points; NaN where SoilGrids has no data (0 in the WCS)."""
    xy = list(zip(lons, lats, strict=True))
    out = {}
    for p, (col, div) in PROPS.items():
        acc = np.zeros(len(xy))
        for d, w in DEPTHS.items():
            with rasterio.open(DIR / f"{p}_{d}_mean.tif") as src:
                v = np.array([x[0] for x in src.sample(xy)], dtype=float)
            acc += np.where(v > 0, v, np.nan) * w
        out[col] = np.round(acc / sum(DEPTHS.values()) / div, 2)
    return pd.DataFrame(out)


def at(lat: float, lon: float) -> dict[str, float | None]:
    row = sample([lat], [lon]).iloc[0]
    return {k: None if pd.isna(v) else float(v) for k, v in row.items()}


if __name__ == "__main__":
    from farm_data.zones import pilot_bbox

    download(pilot_bbox())
    v = at(46.30, 23.75)
    assert all(v.values()) and 4 < v["ph_h2o"] < 9 and 0 < v["clay_pct"] < 100, v
    print("demo field 0-30 cm:", v)
