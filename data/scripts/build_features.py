#!/usr/bin/env python3
"""Build the feature table (contracts/README.md, handoff 1) for the pilot area.

    uv run --package farm-data python data/scripts/build_features.py            # everything
    uv run --package farm-data python data/scripts/build_features.py --no-wait  # skip AppEEARS
    uv run --package farm-data python data/scripts/build_features.py --submit   # + new batch

Steps (each is cached and skipped when its output exists):
1. zones + cropland sample points        -> data/cache/zones/
2. NASA POWER 1981-2025 for every point  -> data/cache/power/
3. AppEEARS MODIS NDVI + SMAP L4 points  -> data/cache/appeears/   (waits for queued tasks;
   submits only when tasks.json is missing or with --submit, which queues a batch for points
   no task covers yet; --no-wait never logs in, submits or fetches)
4. INS TEMPO county yields               -> data/cache/ins/
5. feature table                         -> data/cache/features/{field,commune,county}.parquet
   and one real row per zone type        -> contracts/examples/feature_row.example.json

Raw inputs (data/raw/, gitignored): run `python -m farm_data.cropmap`, `farm_data.soil` and
`farm_data.ins` once to download EUCROPMAP, SoilGrids and INS TEMPO for the pilot area. The
GISCO NUTS/LAU 2024 boundaries go in data/raw/boundaries/ (see data/README.md).
"""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from farm_data import appeears, features, ins, power, zones

EXAMPLE = (
    Path(__file__).resolve().parents[2] / "contracts" / "examples" / "feature_row.example.json"
)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--no-wait", action="store_true", help="build without waiting for AppEEARS")
    ap.add_argument("--submit", action="store_true", help="queue AppEEARS tasks for new points")
    a = ap.parse_args()

    if not (zones.OUT / "points.parquet").exists():
        z, p = zones.build()
        zones.OUT.mkdir(parents=True, exist_ok=True)
        z.to_parquet(zones.OUT / "zones.parquet", index=False)
        p.to_parquet(zones.OUT / "points.parquet", index=False)
    _, pts = zones.load()
    print(f"zones: {pts.zone_id.nunique()} zones, {len(pts)} points")

    with ThreadPoolExecutor(4) as ex:  # POWER asks for modest concurrency
        list(ex.map(lambda r: power.fetch(r.lat, r.lon, *features.POWER_RANGE), pts.itertuples()))
    print("POWER: ok")

    if not a.no_wait:  # offline (--no-wait) builds read whatever AppEEARS output exists
        if a.submit or not appeears.TASKS.exists():
            print("AppEEARS: submitted", appeears.submit())  # only points no task covers yet
        appeears.fetch()

    for t in ins.TABLES:
        ins.download(t)

    df = features.build()
    features.write(df)
    print(f"features: {len(df)} rows -> {features.OUT}")

    demo = zones.field_id(*zones.DEMO_FIELD)
    rows = [
        df[(df.zone_id == zid) & (df.crop == "maize") & (df.season == 2024)].iloc[0]
        for zid in (demo, "1213", "county:AB")  # demo field, Aiud commune, Alba county
    ]
    EXAMPLE.write_text(
        json.dumps([json.loads(r.to_json()) for r in rows], indent=2, ensure_ascii=False) + "\n"
    )
    print(f"example rows -> {EXAMPLE}")


if __name__ == "__main__":
    main()
