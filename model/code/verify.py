"""Post-run contract checks. Exits non-zero on the first violated invariant.

Checks the produced files against schema.py and against each other; it asserts nothing
about values it cannot read, and it never repairs anything.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from pyproj import Transformer

import schema
from weather import cell_ids

ROOT = Path(__file__).resolve().parents[1]
INTERIM, RAW = ROOT / "data" / "interim", ROOT / "data" / "raw"
GRID = 250.0
MODIS = "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs"


def need(cond, msg):
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    print(f"ok   {msg}")


def main():
    points = pd.read_parquet(INTERIM / "points.parquet")
    crops = pd.read_parquet(INTERIM / "crops.parquet")
    print(f"points {len(points):,} | crops {len(crops):,}")

    allowed = set(schema.TARGET_CROPS) | {"other", "non_crop"}
    need(set(crops["crop"].unique()) <= allowed, "crop values within targets | other | non_crop")
    need(crops["crop"].notna().all(), "no null crop values")

    holdout_nuts = set(schema.HOLDOUT_NUTS3)
    need(set(points.loc[points["holdout"], "nuts3"]) <= holdout_nuts,
         "holdout points only in HOLDOUT_NUTS3")
    need(set(points.loc[~points["holdout"], "nuts3"]).isdisjoint(holdout_nuts),
         "no non-holdout point in a HOLDOUT_NUTS3")

    # Every ROI NUTS3 must be represented: the first wave filled country quotas from the
    # lowest-numbered tiles and silently skipped eastern regions, which no check caught.
    import geopandas as gpd
    gdf = gpd.read_file(INTERIM / "nutsrg_3.json", driver="GeoJSON")
    roi = {str(c) for c in gdf["id"].astype(str) if len(str(c)) == 5
           and (str(c)[:2] in {"RO", "HU", "BG", "HR", "SK"} or str(c).startswith(("AT1", "RS12")))}
    need(roi <= set(points["nuts3"]), f"every ROI NUTS3 has points (missing {sorted(roi - set(points['nuts3']))[:5]})")
    thin = sorted(c for c in holdout_nuts if (points["nuts3"] == c).sum() < 100)
    need(not thin, f"each holdout NUTS3 has >=100 points (thin: {thin})")

    years = sorted(crops["year"].unique())
    need(list(years) == list(schema.HRL_YEARS), f"crops cover exactly HRL_YEARS ({years})")
    need(len(crops) == len(points) * len(schema.HRL_YEARS),
         "one crop row per point-year")

    p = crops["purity_m250"]
    need(bool(p.dropna().between(0, 1).all()), "purity_m250 within [0,1] where present")
    need(bool((p.isna() == crops["crop"].isin(["non_crop", "other"])).all()),
         "purity null exactly for non-target crops")

    lon = points["lon"].to_numpy(); lat = points["lat"].to_numpy()
    sx, sy = Transformer.from_crs("EPSG:4326", MODIS, always_xy=True).transform(lon, lat)
    cells = set(zip(np.floor(np.asarray(sx) / GRID).astype(np.int64),
                    np.floor(np.asarray(sy) / GRID).astype(np.int64)))
    need(len(cells) == len(points), "at most one point per 250 m MODIS cell")

    need(points["point_id"].is_unique, "point_id unique")
    prob = points["inclusion_probability"]
    need(bool(prob.between(0, 1).all()) and bool((prob > 0).all()),
         "inclusion_probability in (0,1]")

    power = pd.concat(pd.read_parquet(f, columns=["cell_id"]) for f in (RAW / "power").glob("*.parquet"))
    smap = pd.concat(pd.read_parquet(f, columns=["cell_id"]) for f in (RAW / "smap_sm").glob("*.parquet"))
    need(set(points["cell_id"]) <= set(power["cell_id"]), "every point cell_id present in power")
    # points.cell_id is the POWER cell; smap_sm is keyed by the 9 km SMAP cell.
    # schema.SMAP_UNCOVERED_CELLS holds the cells SMAP leaves unmasked by land.
    smap_want = set(cell_ids(points)["smap_cell"]) - schema.SMAP_UNCOVERED_CELLS
    need(smap_want <= set(smap["cell_id"]),
         f"every point's SMAP cell present in smap_sm ({len(schema.SMAP_UNCOVERED_CELLS)} "
         "documented sea-only cell(s) exempt)")

    for ds in schema.DATASETS:
        files = sorted((RAW / ds).glob("part-*.parquet"))
        need(bool(files), f"{ds}: at least one part on disk")
    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    sys.exit(main())
