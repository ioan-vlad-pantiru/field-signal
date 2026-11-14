"""NASA POWER daily weather per 0.5 x 0.625 degree cell -> long Parquet.

Step 4 of the pipeline. Reads data/interim/points.parquet (produced by step 2),
writes cell_id back into it, then fetches one CSV per unique POWER cell into
data/raw/power/part-power-<cell>.parquet. Resumable: existing parts are skipped.
Any cell that still fails after bounded retries halts the whole step.
"""
import io
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from pyproj import Transformer

ROOT = Path("/home/jovyan/work/crop_rotation")
POINTS = ROOT / "data" / "interim" / "points.parquet"
OUTDIR = ROOT / "data" / "raw" / "power"
API = "https://power.larc.nasa.gov/api/temporal/daily/point"
DICT = "https://power.larc.nasa.gov/api/website/metadata/parameters"
VARIABLES = ["T2M_MAX", "T2M_MIN", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "RH2M", "WS2M"]
FILL, MAX_WORKERS, ATTEMPTS = -999.0, 5, 5

_TRANSFORMER = Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True)


def power_cell(lon, lat):
    """POWER grid cell id: lat centres are 0.5 deg, lon centres 0.625 deg."""
    lat_c = round(lat / 0.5) * 0.5
    lon_c = -180 + 0.625 * round((lon + 180) / 0.625)
    return f"{lat_c:g}_{lon_c:g}"


def smap_cell(lon, lat):
    # shortcut: EASE-Grid 2.0 9 km cells indexed from EPSG:6933 metres directly,
    # not SMAP L4's own grid sub-index; upgrade when joining against L4 cell
    # metadata/QA rasters, whose corner offsets are not encoded here.
    x, y = _TRANSFORMER.transform(lon, lat)
    return f"E{math.floor(x / 9000)}N{math.floor(y / 9000)}"


def cell_ids(points_df):
    """POWER and SMAP cell ids for every point, on the frame's own index."""
    return pd.DataFrame(
        {
            "power_cell": [power_cell(lon, lat) for lon, lat in zip(points_df["lon"], points_df["lat"])],
            "smap_cell": [smap_cell(lon, lat) for lon, lat in zip(points_df["lon"], points_df["lat"])],
        },
        index=points_df.index,
    )


def _atomic_parquet(df, path):
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}")
    df.to_parquet(tmp, index=False)
    os.replace(tmp, path)


def write_cell_ids(points_path):
    df = pd.read_parquet(points_path)
    cell = cell_ids(df)["power_cell"]
    if "cell_id" in df.columns and (df["cell_id"] == cell).all():
        return df
    df["cell_id"] = cell
    _atomic_parquet(df, Path(points_path))
    return df


def resolve_imerg():
    """Resolve IMERG precipitation from the POWER parameter dictionary, or halt."""
    try:
        meta = requests.get(DICT, timeout=60).json()
    except (requests.RequestException, ValueError) as exc:
        raise SystemExit(f"cannot fetch POWER parameter dictionary: {exc}")
    hits = [
        p["id"]
        for p in meta
        if "imerg" in [s.lower() for s in p.get("sources", [])]
        and "daily" in p.get("availability", [])
        and p.get("name", "").strip().lower() == "total precipitation"
    ]
    if len(hits) != 1:
        raise SystemExit(f"cannot resolve IMERG precipitation parameter; matches={hits}")
    return hits[0]


def _get(cell, lat, lon, imerg):
    params = {
        "parameters": ",".join(VARIABLES + [imerg]),
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": "19810101",
        # IMERG is only served in UTC; one UTC request keeps a cell to one file.
        "end": (date.today() - timedelta(days=1)).strftime("%Y%m%d"),
        "format": "CSV",
        "time-standard": "UTC",
    }
    for attempt in range(ATTEMPTS):
        try:
            r = requests.get(API, params=params, timeout=300)
        except requests.RequestException as exc:
            r = None
            err = exc
        if r is not None and r.status_code == 200:
            return r.text
        if r is not None and r.status_code != 429 and r.status_code < 500:
            raise SystemExit(f"POWER {cell}: HTTP {r.status_code}: {r.text[:300]}")
        time.sleep(2 ** attempt)
    raise SystemExit(f"POWER {cell}: failed after {ATTEMPTS} attempts ({err if r is None else r.status_code})")


def _parse_csv(cell, text, variables):
    lines = text.splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if line.startswith("YEAR,"))
    except StopIteration:
        raise SystemExit(f"POWER {cell}: CSV has no YEAR header")
    df = pd.read_csv(io.StringIO("\n".join(lines[start:])))
    missing = set(variables) - set(df.columns)
    if missing:
        raise SystemExit(f"POWER {cell}: missing columns {sorted(missing)}")
    dates = pd.to_datetime(
        df["YEAR"].astype(str) + df["DOY"].astype(str).str.zfill(3), format="%Y%j"
    ).dt.strftime("%Y-%m-%d")
    long = df[variables].melt(var_name="variable", value_name="value")
    # melt stacks per-variable blocks in column order, so tile the dates positionally:
    # inserting the indexed Series would align on index and fill all but the first block
    # with NaN (verified failure before this fix).
    long.insert(0, "date_or_year", np.tile(dates.to_numpy(), len(variables)))
    long.insert(0, "cell_id", cell)
    long["value"] = long["value"].replace(FILL, np.nan).astype("float32")
    return long[["cell_id", "date_or_year", "variable", "value"]]


def _fetch_cell(cell, imerg):
    lat, lon = (float(v) for v in cell.split("_"))
    df = _parse_csv(cell, _get(cell, lat, lon, imerg), VARIABLES + [imerg])
    _atomic_parquet(df, OUTDIR / f"part-power-{cell}.parquet")
    print(f"power {cell}: {len(df)} rows", flush=True)


def _fetch_all(cells, imerg):
    todo = [c for c in cells if not (OUTDIR / f"part-power-{c}.parquet").exists()]
    print(f"{len(cells)} cells, {len(cells) - len(todo)} already present, fetching {len(todo)}", flush=True)
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(_fetch_cell, c, imerg) for c in todo]
        try:
            for future in as_completed(futures):
                future.result()
        except BaseException:
            for future in futures:
                future.cancel()
            raise


def _report(cells):
    agg = {}
    for cell in cells:
        df = pd.read_parquet(
            OUTDIR / f"part-power-{cell}.parquet", columns=["date_or_year", "variable", "value"]
        )
        for var, group in df.groupby("variable"):
            ok = group["value"].notna()
            entry = agg.setdefault(var, {"rows": 0, "valid": 0, "lo": None, "hi": None})
            entry["rows"] += len(group)
            entry["valid"] += int(ok.sum())
            if ok.any():
                lo, hi = group.loc[ok, "date_or_year"].min(), group.loc[ok, "date_or_year"].max()
                entry["lo"] = lo if entry["lo"] is None else min(entry["lo"], lo)
                entry["hi"] = hi if entry["hi"] is None else max(entry["hi"], hi)
    print("per variable: rows, date range actually received, % missing")
    for var in sorted(agg):
        e = agg[var]
        pct = 100.0 * (e["rows"] - e["valid"]) / e["rows"] if e["rows"] else 100.0
        print(f"  {var}: rows={e['rows']} {e['lo']}..{e['hi']} missing={pct:.1f}%")


def main(region, pilot):
    # region/pilot only scope points.parquet upstream (step 2); not re-applied here.
    if not POINTS.exists():
        raise SystemExit(f"missing {POINTS}; run step2 (points.py) first")
    points = write_cell_ids(POINTS)
    cells = sorted(set(cell_ids(points)["power_cell"]))
    if not cells:
        raise SystemExit("points.parquet has no points")
    imerg = resolve_imerg()
    print(f"IMERG precipitation parameter resolved from POWER dictionary: {imerg}")
    OUTDIR.mkdir(parents=True, exist_ok=True)
    _fetch_all(cells, imerg)
    _report(cells)
    print("ALLSKY_SFC_SW_DWN starts in 1984; 1981-1983 values are missing (-999 -> null), not imputed.")
    print(f"done: {len(cells)} cells in {OUTDIR}")


def _self_check():
    assert power_cell(25.0, 45.0) == "45_25"
    assert power_cell(25.3124, 45.24) == "45_25"        # rounds down to 25.0 / 45.0
    assert power_cell(25.3126, 45.26) == "45.5_25.625"  # rounds up to 25.625 / 45.5
    df = _parse_csv("45_25", "junk header\nYEAR,DOY,T2M_MAX\n2024,1,-999\n2024,2,3.5\n", ["T2M_MAX"])
    assert df["date_or_year"].tolist() == ["2024-01-01", "2024-01-02"]
    assert np.isnan(df.loc[0, "value"]) and df.loc[1, "value"] == np.float32(3.5)
    # Two variables: the alignment bug fixed here left every block but the first with
    # NaN dates, which a single-variable fixture cannot detect.
    df2 = _parse_csv("45_25", "hdr\nYEAR,DOY,T2M_MAX,T2M_MIN\n2024,1,1.0,2.0\n2024,2,3.0,4.0\n",
                     ["T2M_MAX", "T2M_MIN"])
    assert df2["date_or_year"].tolist() == ["2024-01-01", "2024-01-02"] * 2, "dates per variable block"
    assert df2["date_or_year"].notna().all()
    assert smap_cell(25.0, 45.0) == smap_cell(25.0, 45.0)
    # 1 km can share a 9 km cell, so find a base whose 1 km shift crosses a boundary.
    for lat in [40 + 0.05 * i for i in range(200)]:
        same = smap_cell(25.0, lat) == smap_cell(25.001, lat)       # ~78 m apart
        different = smap_cell(25.0, lat) != smap_cell(25.0, lat + 0.009)  # ~1 km apart
        if same and different:
            break
    else:
        raise AssertionError("smap_cell: no 100 m same / 1 km distinct pair found")
    print("self-check ok")


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        _self_check()
    else:
        main("full", False)
