"""Pilot zones and their cropland sample points.

Zones (contract ids, see contracts/README.md):
- 8 counties: Alba and its neighbours, `county:AB` ...
- 40 Alba communes nearest the Aiud-Sântimbru midpoint, keyed by SIRUTA, counting only communes
  with at least one EUCROPMAP 2022 arable pixel (no arable land, nothing to source); this skips
  Ponor (6397) and Mogoş (5826)
- the demo field near Aiud, `field:46.30,23.75`

Point-based sources (POWER, SMAP, MODIS) are sampled at K points per zone on EUCROPMAP arable
pixels (K = 5 county, 2 commune, 1 field); zone features are the mean over its points.

    uv run --package farm-data python -m farm_data.zones   # writes data/cache/zones/*.parquet
"""

from __future__ import annotations

from itertools import islice
from typing import Any

import geopandas as gpd
import pandas as pd

from farm_data import CACHE, RAW, cropmap

COUNTIES = {  # contract code -> NUTS3 id (GISCO NUTS 2024)
    "AB": "RO121",
    "AR": "RO421",
    "BH": "RO111",
    "CJ": "RO113",
    "HD": "RO423",
    "MS": "RO125",
    "SB": "RO126",
    "VL": "RO415",
}
DEMO_FIELD = (46.30, 23.75)  # arable land east of Aiud
COMMUNE_CENTRE = (46.22, 23.69)  # midpoint of Aiud (46.31, 23.72) and Sântimbru (46.13, 23.65)
N_COMMUNES = 40
K = {"county": 5, "commune": 2, "field": 1}
OUT = CACHE / "zones"


def field_id(lat: float, lon: float) -> str:
    return f"field:{lat:.2f},{lon:.2f}"


def counties() -> gpd.GeoDataFrame:
    g = gpd.read_file(RAW / "boundaries" / "NUTS_2024.gpkg")
    g = g[g["NUTS_ID"].isin(COUNTIES.values())]
    code = {v: k for k, v in COUNTIES.items()}
    return gpd.GeoDataFrame(
        {
            "zone_id": "county:" + g["NUTS_ID"].map(code),
            "zone_type": "county",
            "name": g["NAME_LATN"],
            "county": g["NUTS_ID"].map(code),
        },
        geometry=g.geometry.values,
        crs=g.crs,
    )


def communes(cty: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    lau = gpd.read_file(RAW / "boundaries" / "LAU_2024.gpkg")
    lau = lau[lau["CNTR_CODE"] == "RO"].to_crs(3035)
    alba = cty[cty["county"] == "AB"].to_crs(3035).geometry.iloc[0]
    lau = lau[lau.representative_point().within(alba)]
    c = gpd.GeoSeries.from_xy([COMMUNE_CENTRE[1]], [COMMUNE_CENTRE[0]], crs=4326).to_crs(3035)
    lau = lau.assign(d=lau.centroid.distance(c.iloc[0])).sort_values("d").to_crs(4326)
    arable = (i for i, g in lau.geometry.items() if cropmap.sample_points(g.__geo_interface__, 1))
    lau = lau.loc[list(islice(arable, N_COMMUNES))]
    return gpd.GeoDataFrame(
        {
            "zone_id": lau["GISCO_ID"].str.removeprefix("RO_"),
            "zone_type": "commune",
            "name": lau["LAU_NAME"],
            "county": "AB",
        },
        geometry=lau.geometry.values,
        crs=lau.crs,
    )


def _zones() -> gpd.GeoDataFrame:
    cty = counties()
    return pd.concat([cty, communes(cty)], ignore_index=True)


def geometries() -> dict[str, dict[str, Any]]:
    """zone_id -> WGS84 GeoJSON geometry (counties and communes)."""
    z = _zones()
    return {str(k): g.__geo_interface__ for k, g in zip(z["zone_id"], z.geometry, strict=True)}


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Zones table (zone_id, zone_type, name, county, lat, lon, area_km2) and sample points
    (zone_id, zone_type, point, lat, lon)."""
    z = _zones()
    rep = z.to_crs(3035).representative_point().to_crs(4326)
    zones = pd.DataFrame(
        {
            "zone_id": z["zone_id"],
            "zone_type": z["zone_type"],
            "name": z["name"],
            "county": z["county"],
            "lat": rep.y.round(5),
            "lon": rep.x.round(5),
            "area_km2": (z.to_crs(3035).area / 1e6).round(1),
        }
    )
    pts = [
        (zid, zt, i, la, lo)
        for zid, zt, geom in zip(z["zone_id"], z["zone_type"], z.geometry, strict=True)
        for i, (la, lo) in enumerate(cropmap.sample_points(geom.__geo_interface__, K[zt]))
    ]
    lat, lon = DEMO_FIELD
    fid = field_id(lat, lon)
    zones.loc[len(zones)] = [fid, "field", "Demo field near Aiud", "AB", lat, lon, None]
    pts.append((fid, "field", 0, lat, lon))
    points = pd.DataFrame(pts, columns=["zone_id", "zone_type", "point", "lat", "lon"])
    return zones, points


def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    return pd.read_parquet(OUT / "zones.parquet"), pd.read_parquet(OUT / "points.parquet")


def pilot_bbox() -> tuple[float, float, float, float]:
    """(W, S, E, N) of the 8 pilot counties, EPSG:4326."""
    w, s, e, n = counties().total_bounds
    return float(w), float(s), float(e), float(n)


if __name__ == "__main__":
    zones, points = build()
    OUT.mkdir(parents=True, exist_ok=True)
    zones.to_parquet(OUT / "zones.parquet", index=False)
    points.to_parquet(OUT / "points.parquet", index=False)
    assert zones["zone_id"].is_unique and set(points["zone_id"]) <= set(zones["zone_id"])
    print(zones.groupby("zone_type").size().to_dict(), f"{len(points)} points")
    print(zones[zones.zone_type == "commune"][["zone_id", "name"]].to_string(index=False))
