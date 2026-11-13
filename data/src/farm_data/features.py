"""Feature table (contracts/README.md, handoff 1): one row per zone x crop x season.

Inputs, all built by the other farm_data modules:
- zones + sample points (zones), POWER daily per point (power), AppEEARS MODIS and SMAP per
  point (appeears), MODIS from the local cube for points AppEEARS lacks (modis_cube),
  SoilGrids 0-30 cm (soil), EUCROPMAP areas (cropmap), INS yields (ins).

Zone values = daily inputs averaged over the zone's sample points first, then the season
indicators computed on that mean series (so counts stay whole days).

Caveats written into the docs: NDVI is cropland greenness at the sample points in the crop's
season window, not a per-crop signal (no yearly crop masks); POWER is one 0.5° cell per point.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from farm_data import CACHE, appeears, cropmap, ins, modis_cube, power, soil, zones
from farm_data.crops import Crop, KnowledgeBase, load_crops

CROPS = ["maize", "wheat", "barley", "soybean", "sunflower", "pea"]
SEASONS = range(1982, 2026)  # POWER starts 1981; winter crops are sown the year before
POWER_RANGE = (date(1981, 1, 1), date(2025, 12, 31))
FROST_C = -15.0  # contracts/README.md: frost_days_winter threshold
OUT = CACHE / "features"


def _slice(df: pd.DataFrame, w: tuple[date, date]) -> pd.DataFrame:
    return df.loc[pd.Timestamp(w[0]) : pd.Timestamp(w[1])]


def _zone_mean(
    points: pd.DataFrame, load: Callable[[Any], pd.DataFrame]
) -> dict[str, pd.DataFrame]:
    """Per zone: mean of each point's frame (aligned on the index)."""
    out = {}
    for zid, g in points.groupby("zone_id"):
        frames = [load(r) for r in g.itertuples()]
        out[str(zid)] = pd.concat(frames).groupby(level=0).mean()
    return out


def critical_window(c: Crop, season: int) -> tuple[date, date] | None:
    raw = c.raw.get("critical_water")
    if raw:
        m0, d0 = map(int, raw[0].split("-"))
        m1, d1 = map(int, raw[1].split("-"))
        return date(season, m0, d0), date(season, m1, d1)
    return c.window("flowering", season)


def weather_features(w: pd.DataFrame, c: Crop, season: int) -> dict[str, Any]:
    sow, flo, har = (c.window(n, season) for n in ("sowing", "flowering", "harvest"))
    assert sow and flo and har, c.id
    s = _slice(w, (sow[0], har[1]))
    f = _slice(w, flo)
    crit = critical_window(c, season)
    assert crit
    rain_season = float(s["PRECTOTCORR"].sum())
    et0 = float(s["ET0"].sum())
    winter = (
        _slice(w, (date(season - 1, 12, 1), date(season, 3, 1) - timedelta(days=1)))
        if c.season_type == "winter"
        else None
    )
    return {
        "hot_days_flowering": int((f["T2M_MAX"] >= c.raw["heat_watch_tmax_c"]).sum()),
        "max_tmax_flowering_c": round(float(f["T2M_MAX"].max()), 1),
        "rain_flowering_mm": round(float(f["PRECTOTCORR"].sum()), 1),
        "rain_season_mm": round(rain_season, 1),
        "rh_flowering_pct": round(float(f["RH2M"].mean()), 1),
        "wet_days_flowering": int((f["PRECTOTCORR"] >= 1.0).sum()),
        "rain_harvest_mm": round(float(_slice(w, har)["PRECTOTCORR"].sum()), 1),
        "frost_days_winter": None if winter is None else int((winter["T2M_MIN"] <= FROST_C).sum()),
        "et0_season_mm": round(et0, 1),
        "water_deficit_mm": round(et0 - rain_season, 1),
        "gwetroot_critical": round(float(_slice(w, crit)["GWETROOT"].mean()), 3),
    }


def smap_feature(sm: pd.DataFrame | None, c: Crop, season: int) -> float | None:
    if sm is None or season < 2015:
        return None
    crit = critical_window(c, season)
    assert crit
    v = _slice(sm, crit)["sm_rootzone"]
    return None if v.empty else round(float(v.mean()), 4)


def ndvi_features(vi: pd.DataFrame | None, c: Crop, season: int) -> dict[str, Any]:
    sow, har = c.window("sowing", season), c.window("harvest", season)
    assert sow and har
    if vi is None:
        return {"ndvi_peak": None, "ndvi_usable_share": None}  # no data: not measured
    v = vi.loc[pd.Timestamp(sow[0]) : pd.Timestamp(har[1])]
    if v.empty:
        return {"ndvi_peak": None, "ndvi_usable_share": None}  # no data: not measured
    rel = v["reliability"].astype("float64")  # NaN = local cube row, no QA layer to screen with
    ok = v[rel.between(0, 1) | rel.isna()]
    zone = ok.groupby(level=0)["ndvi"].mean().dropna()
    # NDVI peaks around flowering: null the peak unless usable 16-day composites cover >= 75 % of
    # the flowering window's days (e.g. the 2025 cube has no composite starting 2025-07-04..11-09)
    flo = c.window("flowering", season)
    assert flo
    cover = {d.date() + timedelta(days=k) for d in zone.index for k in range(16)}
    n = (flo[1] - flo[0]).days + 1
    covered = sum(flo[0] + timedelta(days=k) in cover for k in range(n)) / n
    peak = zone.max() if covered >= 0.75 else np.nan
    return {
        "ndvi_peak": None if pd.isna(peak) else round(float(peak), 4),
        "ndvi_usable_share": None if rel.isna().any() else round(len(ok) / len(v), 3),
    }


def _z(s: pd.Series) -> pd.Series:
    sd = s.std()
    return ((s - s.mean()) / sd).round(2) if sd and sd > 0 else s * np.nan


def _detrended_anomaly_pct(g: pd.DataFrame) -> pd.Series:
    """Yield anomaly vs a linear trend over the county x crop record, % of trend."""
    ok = g["yield_t_ha"].notna()
    if ok.sum() < 8:
        return pd.Series(np.nan, index=g.index)
    b, a = np.polyfit(g.loc[ok, "season"], g.loc[ok, "yield_t_ha"], 1)
    trend = a + b * g["season"]
    return ((g["yield_t_ha"] / trend - 1) * 100).round(1)


def _crop_area(zone_geoms: dict[str, Any]) -> pd.DataFrame:
    """EUCROPMAP crop area per zone for the 2018 and 2022 maps (ha)."""
    rows = []
    for zid, geom in zone_geoms.items():
        for year in cropmap.URLS:
            areas = cropmap.crop_area_ha(geom, year)
            for crop, codes in cropmap.CROP_CODES.items():
                ha = sum(areas.get(cropmap.LEGEND[k], 0.0) for k in codes)
                rows.append((zid, crop, year, round(ha, 0)))
    return pd.DataFrame(rows, columns=["zone_id", "crop", "map_year", "crop_area_ha"])


def build(kb: KnowledgeBase | None = None) -> pd.DataFrame:
    kb = kb or load_crops()
    zt, pts = zones.load()
    wx = _zone_mean(pts, lambda r: power.fetch(r.lat, r.lon, *POWER_RANGE))

    def by_point(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
        return {
            str(z): g.set_index("date").drop(columns=["zone_id", "point"]).sort_index()
            for z, g in df.groupby("zone_id")
        }

    # AppEEARS outputs are optional so the table can be built before the tasks finish
    m, sm_path = appeears.OUT / "modis.parquet", appeears.OUT / "smap.parquet"
    vi = pd.read_parquet(m) if m.exists() else None
    cube_path = modis_cube.OUT / "modis.parquet"
    if cube_path.exists():  # AppEEARS rows where a point has them, cube rows for the other points
        cube = pd.read_parquet(cube_path)
        if vi is not None:
            pt = ["zone_id", "point"]
            cube = cube[~pd.MultiIndex.from_frame(cube[pt]).isin(pd.MultiIndex.from_frame(vi[pt]))]
        vi = pd.concat([vi, cube], ignore_index=True)
    modis = by_point(vi.drop(columns="satellite")) if vi is not None else {}
    smap = by_point(pd.read_parquet(sm_path)) if sm_path.exists() else {}
    smap = {z: d.groupby(level=0).mean() for z, d in smap.items()}
    soils = pd.concat([pts[["zone_id"]], soil.sample(pts["lat"], pts["lon"])], axis=1)
    soils = soils.groupby("zone_id").mean().round(2)

    rows = []
    for z in zt.itertuples():
        for cid in CROPS:
            c = kb.crops[cid]
            for season in SEASONS:
                rows.append(
                    {
                        "zone_id": z.zone_id,
                        "zone_type": z.zone_type,
                        "crop": cid,
                        "season": season,
                        "lat": z.lat,
                        "lon": z.lon,
                        **weather_features(wx[z.zone_id], c, season),
                        "smap_rootzone_critical": smap_feature(smap.get(z.zone_id), c, season),
                        **ndvi_features(modis.get(z.zone_id), c, season),
                    }
                )
    df = pd.DataFrame(rows)
    key = ["zone_id", "crop"]
    sm = df[df["season"] >= 2015].groupby(key)["smap_rootzone_critical"].transform(_z)
    df["smap_rootzone_anomaly"] = sm
    df["ndvi_peak_anomaly"] = df.groupby(key)["ndvi_peak"].transform(_z)
    df = df.join(soils, on="zone_id")

    # crop area: INS (official, per year) for counties; EUCROPMAP for communes, using the latest
    # map at or before the season (2018 map for 2018-2021, 2022 map from 2022), null before 2018
    y = ins.build()
    y = y.assign(zone_id="county:" + y["county"], season=y["year"])[
        ["zone_id", "crop", "season", "area_ha", "yield_t_ha"]
    ]
    df = df.merge(y, on=["zone_id", "crop", "season"], how="left")
    geoms = zones.geometries()
    communes = {k: v for k, v in geoms.items() if not k.startswith(("county:", "field:"))}
    ca = _crop_area(communes)
    df["map_year"] = np.where(df["season"] >= 2022, 2022, np.where(df["season"] >= 2018, 2018, 0))
    df = df.merge(ca, on=["zone_id", "crop", "map_year"], how="left")
    df["crop_area_ha"] = df["crop_area_ha"].fillna(df.pop("area_ha"))
    df = df.drop(columns="map_year")
    df["yield_anomaly_pct"] = df.groupby(key, group_keys=False)[["season", "yield_t_ha"]].apply(
        _detrended_anomaly_pct
    )
    df["crops_yaml_version"] = kb.version
    cols = [
        "zone_id", "zone_type", "crop", "season", "lat", "lon", "crop_area_ha",
        "hot_days_flowering", "max_tmax_flowering_c", "rain_flowering_mm", "rain_season_mm",
        "rh_flowering_pct", "wet_days_flowering", "rain_harvest_mm", "frost_days_winter",
        "et0_season_mm", "water_deficit_mm", "gwetroot_critical", "smap_rootzone_critical",
        "smap_rootzone_anomaly", "ndvi_peak", "ndvi_peak_anomaly", "ndvi_usable_share",
        "soc_g_per_kg", "ph_h2o", "clay_pct", "sand_pct", "yield_t_ha", "yield_anomaly_pct",
        "crops_yaml_version",
    ]  # fmt: skip
    return df[cols].sort_values(["zone_type", "zone_id", "crop", "season"], ignore_index=True)


def write(df: pd.DataFrame) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for zt, g in df.groupby("zone_type"):
        g.astype({"frost_days_winter": "Int64"}).to_parquet(OUT / f"{zt}.parquet", index=False)


if __name__ == "__main__":  # self-check: a gap over flowering must null the peak
    maize = load_crops().crops["maize"]
    t = pd.date_range("2025-01-01", "2025-12-31", freq="8D")
    full = pd.DataFrame({"ndvi": 0.8, "reliability": pd.array([pd.NA] * len(t), "Int8")}, index=t)
    assert ndvi_features(full, maize, 2025)["ndvi_peak"] == 0.8
    gap = full[(full.index < "2025-06-27") | (full.index > "2025-11-16")]
    assert ndvi_features(gap, maize, 2025)["ndvi_peak"] is None
    assert ndvi_features(None, maize, 2025)["ndvi_usable_share"] is None
    print("ndvi_features self-check ok")
