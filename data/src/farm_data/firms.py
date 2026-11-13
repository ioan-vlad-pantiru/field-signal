"""NASA FIRMS active-fire detections on cropland, per commune and season (guide bonus:
agricultural burning, impact dimension).

Source: NASA FIRMS yearly country archives, public CSVs without a key,
https://firms.modaps.eosdis.nasa.gov/country/ (`{sensor}/{year}/{sensor}_{year}_Romania.csv`):
MODIS Collection 6.1 standard (MCD14ML, Terra + Aqua, ~1 km pixel at nadir) 2001-2025 and
VIIRS S-NPP 375 m standard (VNP14IMGTML) 2012-2025. Set FIRMS_DIR to the folder holding them.

Assumptions (also stored on every output row):
- type == 0, presumed vegetation fire (drops volcano, static land source, offshore);
- confidence: VIIRS nominal or high, MODIS >= 30 (drops low-confidence detections);
- on cropland = the detection centre lies in an LAU commune of the 8 pilot counties and on an
  EUCROPMAP 2022 arable pixel (codes 211-290). One 2022 mask serves every year. The fire pixel
  (375 m / 1 km) is far larger than the 10 m map pixel, so a burn on a field edge can count on
  either side of it;
- seasons MAM, JJA, SON, DJF; DJF belongs to the year of its January (as in features.py).
  A season is kept only when its whole span is covered by the files read;
- sensor uptime is not checked, so 0 means "no detection in the file", not a checked clear
  season. The VIIRS 2022 file has no detections from 2022-07-27 to 2022-08-10 (16-day gap,
  the S-NPP outage), so VIIRS JJA 2022 is an undercount. MODIS is Terra only until Aqua's first
  row on 2002-07-04, so MODIS 2001 to mid-2002 sees fewer overpasses;
- MODIS and VIIRS rows count the same fires seen by two sensors: never sum across sensors;
  counts are not comparable across sensors or across years with different uptime.

    FIRMS_DIR=/path/to/firms uv run --package farm-data python -m farm_data.firms
    # -> data/cache/firms/cropland_fires.parquet: zone_id (SIRUTA), year, season, sensor,
    #    detections, period_start, period_end, source, filters, cropland_mask
"""

from __future__ import annotations

import os
from pathlib import Path

import geopandas as gpd
import pandas as pd
import rasterio

from farm_data import CACHE, RAW, cropmap, zones

FIRMS_DIR = Path(os.environ.get("FIRMS_DIR", RAW / "firms"))
YEARS = {"modis": range(2001, 2026), "viirs-snpp": range(2012, 2026)}
ARCHIVE = "firms.modaps.eosdis.nasa.gov/country"
SOURCE = {
    "modis": f"NASA FIRMS MODIS C6.1 (MCD14ML), {ARCHIVE}",
    "viirs-snpp": f"NASA FIRMS VIIRS S-NPP 375 m (VNP14IMGTML), {ARCHIVE}",
}
FILTERS = {
    "modis": "type == 0; confidence >= 30",
    "viirs-snpp": "type == 0; confidence in {n, h}",
}
MASK = "detection centre on EUCROPMAP 2022 arable pixel (codes 211-290, 10 m), LAU 2024 commune"
SEASONS = {12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM"}
SEASONS |= {6: "JJA", 7: "JJA", 8: "JJA", 9: "SON", 10: "SON", 11: "SON"}
START = {"DJF": (-1, 12), "MAM": (0, 3), "JJA": (0, 6), "SON": (0, 9)}  # (year offset, month)
OUT = CACHE / "firms" / "cropland_fires.parquet"


def csv_path(sensor: str, year: int) -> Path:
    return FIRMS_DIR / f"{sensor}_{year}_Romania.csv"


def read(sensor: str, year: int) -> pd.DataFrame:
    """One yearly country CSV, unfiltered."""
    cols = ["latitude", "longitude", "acq_date", "confidence", "type"]
    return pd.read_csv(csv_path(sensor, year), usecols=cols, parse_dates=["acq_date"])


def keep(df: pd.DataFrame, sensor: str) -> pd.DataFrame:
    """Vegetation fires at nominal confidence or better."""
    conf = df["confidence"]
    ok = conf.isin(["n", "h"]) if sensor == "viirs-snpp" else pd.to_numeric(conf) >= 30
    return df[(df["type"] == 0) & ok]


def season_of(d: pd.Series) -> tuple[pd.Series, pd.Series]:
    """(year, season) per date; December goes to the next year's DJF."""
    return d.dt.year + (d.dt.month == 12), d.dt.month.map(SEASONS)


def period(year: int, season: str) -> tuple[pd.Timestamp, pd.Timestamp]:
    dy, m = START[season]
    start = pd.Timestamp(year + dy, m, 1)
    return start, start + pd.DateOffset(months=3) - pd.Timedelta(days=1)


def aoi_communes() -> gpd.GeoDataFrame:
    """All LAU communes of the 8 pilot counties (zone_id = SIRUTA), EPSG:3035."""
    lau = gpd.read_file(RAW / "boundaries" / "LAU_2024.gpkg")
    lau = lau[lau["CNTR_CODE"] == "RO"].to_crs(3035)
    aoi = zones.counties().to_crs(3035).union_all()
    lau = lau[lau.representative_point().within(aoi)]
    return gpd.GeoDataFrame(
        {"zone_id": lau["GISCO_ID"].str.removeprefix("RO_")}, geometry=lau.geometry.values, crs=3035
    )


def on_cropland(df: pd.DataFrame, communes: gpd.GeoDataFrame) -> pd.DataFrame:
    """Detections inside a commune and on an arable EUCROPMAP 2022 pixel, with zone_id."""
    pts = gpd.GeoDataFrame(
        df, geometry=gpd.points_from_xy(df["longitude"], df["latitude"]), crs=4326
    ).to_crs(communes.crs)
    pts = gpd.sjoin(pts, communes, predicate="within").drop(columns="index_right")
    if pts.empty:
        return pts
    with rasterio.open(cropmap.path(2022)) as src:
        assert src.crs.to_epsg() == 3035
        codes = [v[0] for v in src.sample(zip(pts.geometry.x, pts.geometry.y, strict=True))]
    return pts[pd.Series(codes, index=pts.index).isin(cropmap.ARABLE)]


def build() -> pd.DataFrame:
    communes = aoi_communes()
    parts = []
    for sensor, years in YEARS.items():
        hits = pd.concat([on_cropland(keep(read(sensor, y), sensor), communes) for y in years])
        y, s = season_of(hits["acq_date"])
        counts = hits.assign(year=y, season=s).groupby(["zone_id", "year", "season"]).size()
        seasons = [
            (yr, se) for yr in years for se in START if se != "DJF" or yr - 1 in years
        ]  # missing row = season not in the files read; 0 = no detection in the files, not a
        # checked clear season (uptime unchecked: VIIRS gap 2022-07-27..08-10, MODIS Terra-only
        # before 2002-07-04). Never sum across sensors; counts are not comparable across sensors
        # or across years with different uptime.
        grid = pd.MultiIndex.from_tuples(
            [(z, yr, se) for z in communes["zone_id"] for yr, se in seasons],
            names=["zone_id", "year", "season"],
        )
        d = counts.reindex(grid, fill_value=0).rename("detections").reset_index()
        spans = [period(*k) for k in zip(d["year"], d["season"], strict=True)]
        parts.append(
            d.assign(
                sensor=sensor,
                period_start=[a.date() for a, _ in spans],
                period_end=[b.date() for _, b in spans],
                source=SOURCE[sensor],
                filters=FILTERS[sensor],
                cropland_mask=MASK,
            )
        )
    cols = ["zone_id", "year", "season", "sensor", "detections", "period_start", "period_end"]
    return pd.concat(parts, ignore_index=True)[[*cols, "source", "filters", "cropland_mask"]]


if __name__ == "__main__":
    # Self-check: reader is lossless, each filter only drops rows, Dec -> next year's DJF.
    raw = read("viirs-snpp", 2024)
    with csv_path("viirs-snpp", 2024).open() as f:
        assert len(raw) == sum(1 for _ in f) - 1
    kept = keep(raw, "viirs-snpp")
    crop = on_cropland(kept, aoi_communes())
    assert len(crop) <= len(kept) <= len(raw), (len(crop), len(kept), len(raw))
    yr, se = season_of(pd.Series(pd.to_datetime(["2023-12-31", "2024-02-29", "2024-03-01"])))
    assert list(zip(yr, se, strict=True)) == [(2024, "DJF"), (2024, "DJF"), (2024, "MAM")]
    assert period(2024, "DJF") == (pd.Timestamp(2023, 12, 1), pd.Timestamp(2024, 2, 29))
    print(f"VIIRS 2024: {len(raw)} rows, {len(kept)} kept, {len(crop)} on AOI cropland")

    t = build()
    assert t[["zone_id", "year", "season", "sensor"]].duplicated().sum() == 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    t.to_parquet(OUT, index=False)
    print(f"{OUT}: {len(t)} rows, {t['zone_id'].nunique()} communes")
    print(t.groupby(["sensor", "season"])["detections"].sum().unstack().to_string())
