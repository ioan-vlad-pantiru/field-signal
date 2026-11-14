"""Monthly 10-channel POWER weather for any Oct-Sep window, from raw daily POWER.

Same channels and aggregation as code/build.py::build_weather, but not tied to the
2016-10..2024-09 window, and optionally with +dT on May-August days (temperature
perturbation with ET0, hot days and frost days recomputed from the perturbed values).

    venv/bin/python code/weather_history.py check
    venv/bin/python code/weather_history.py blocks --out data/processed/weather_blocks_1984.npy
"""
import argparse
import calendar
import json
from datetime import datetime
from pathlib import Path

import numpy as np
import polars as pl

from build import WEATHER_CHANNELS, _fao56_et0

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "raw"
OUT = DATA / "processed"
CELLS_FILE = OUT / "point_ids.npy"


def cells():
    """POWER cells in the same order as weather.npy: sorted ids of the covered points."""
    ids = np.load(CELLS_FILE)
    pts = pl.read_parquet(DATA / "interim" / "points.parquet").select("point_id", "cell_id")
    df = pl.DataFrame({"point_id": ids}).join(pts, on="point_id", how="left")
    assert df["cell_id"].null_count() == 0, "point_id without a POWER cell"
    return sorted(df["cell_id"].unique().to_list())


def _sites():
    """Mean latitude and SRTM elevation per POWER cell, over the covered points."""
    ids = np.load(CELLS_FILE)
    pts = pl.read_parquet(DATA / "interim" / "points.parquet").select("point_id", "lat", "cell_id")
    srtm = (pl.scan_parquet(sorted((RAW / "srtm").glob("*.parquet")))
            .filter(pl.col("variable") == "elevation")
            .select("point_id", pl.col("value").alias("z")).collect())
    return (pl.DataFrame({"point_id": ids}).join(pts, on="point_id", how="left")
            .join(srtm, on="point_id", how="left")
            .group_by("cell_id")
            .agg(pl.col("lat").mean().alias("lat"), pl.col("z").mean().alias("z")))


def _end_day(month_key):
    y, m = (int(x) for x in month_key.split("-"))
    return f"{month_key}-{calendar.monthrange(y, m)[1]:02d}"


def monthly_grid(cell_ids, start, end, dtemp=None):
    """[n_cells, n_months, 10] physical monthly weather from POWER daily data.

    start/end are month keys ("1984-10" .. "2025-09"), inclusive. dtemp adds that many
    degrees to T2M_MAX and T2M_MIN on every day of May-August before aggregation.
    """
    wide = (pl.scan_parquet(sorted((RAW / "power").glob("*.parquet")))
            .filter(pl.col("cell_id").is_in(list(cell_ids)))
            .filter((pl.col("date_or_year") >= f"{start}-01")
                    & (pl.col("date_or_year") <= _end_day(end)))
            .collect()
            .pivot(on="variable", index=["cell_id", "date_or_year"], values="value",
                   aggregate_function="first"))
    assert wide.height, "no POWER rows in the requested window"
    nulls = wide.select([pl.col(c).null_count() for c in
                         ["T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN",
                          "PRECTOTCORR"]]).row(0)
    assert max(nulls) == 0, f"POWER nulls in {start}..{end} (per channel: {nulls})"

    wide = wide.with_columns(pl.col("date_or_year").str.slice(0, 7).alias("m"))
    if dtemp:
        warm = wide["date_or_year"].str.to_date().dt.month().is_in([5, 6, 7, 8])
        wide = wide.with_columns([
            pl.when(warm).then(pl.col(c) + dtemp).otherwise(pl.col(c)).alias(c)
            for c in ("T2M_MAX", "T2M_MIN")])

    wide = wide.join(_sites(), on="cell_id", how="left")
    assert wide["lat"].null_count() == 0 and wide["z"].null_count() == 0, \
        "a POWER cell has no site latitude/elevation"

    doy = wide["date_or_year"].str.to_date().dt.ordinal_day().to_numpy()
    et0, es, ea = _fao56_et0(
        wide["T2M_MAX"].to_numpy(), wide["T2M_MIN"].to_numpy(), wide["RH2M"].to_numpy(),
        wide["ALLSKY_SFC_SW_DWN"].to_numpy(), wide["WS2M"].to_numpy(), doy,
        wide["lat"].to_numpy(), wide["z"].to_numpy())
    assert np.isfinite(et0).all() and (es >= ea - 1e-9).all(), "ET0 is not finite"
    wide = wide.with_columns(pl.Series("ET0", np.maximum(et0, 0.0).astype(np.float32)))

    # longest run of days with precip < 1 mm inside each month
    dry = (wide.sort(["cell_id", "date_or_year"])
           .with_columns((pl.col("PRECTOTCORR") < 1.0).alias("dry"))
           .with_columns((pl.col("dry") != pl.col("dry").shift(1).over("cell_id"))
                         .cum_sum().over("cell_id").alias("run")))
    runs = (dry.filter(pl.col("dry")).group_by("cell_id", "m", "run").agg(pl.len().alias("n"))
            .group_by("cell_id", "m").agg(pl.col("n").max().alias("dry_run_max")))

    monthly = (wide.group_by("cell_id", "m")
               .agg([pl.col(c).mean().alias(c) for c in
                     ("T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN")]
                    + [pl.col("PRECTOTCORR").sum().alias("PRECTOTCORR"),
                       pl.col("ET0").sum().alias("ET0"),
                       (pl.col("T2M_MAX") > 32.0).sum().alias("hot_days"),
                       (pl.col("T2M_MIN") < 0.0).sum().alias("frost_days")])
               .join(runs, on=["cell_id", "m"], how="left")
               .with_columns(pl.col("dry_run_max").fill_null(0)))

    keys = []
    k = 0
    while True:
        y = int(start[:4]) + (int(start[5:]) - 1 + k) // 12
        mo = (int(start[5:]) - 1 + k) % 12 + 1
        key = f"{y}-{mo:02d}"
        if key > end:
            break
        keys.append(key)
        k += 1
    idx = {k: i for i, k in enumerate(keys)}
    monthly = monthly.filter(pl.col("m").is_in(keys))
    cmap = {c: i for i, c in enumerate(cell_ids)}
    grid = np.full((len(cell_ids), len(keys), len(WEATHER_CHANNELS)), np.nan, np.float32)
    grid[monthly["cell_id"].replace_strict(cmap, return_dtype=pl.Int32).to_numpy(),
         monthly["m"].replace_strict(idx, return_dtype=pl.Int32).to_numpy()] = np.column_stack(
        [monthly[c].to_numpy() for c in
         ("T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR",
          "ET0", "hot_days", "frost_days", "dry_run_max")])
    assert np.isfinite(grid).all(), "weather grid has holes"
    return grid, keys


def standardise(grid):
    norm = json.loads((OUT / "norm_stats.json").read_text())["weather"]
    return ((grid - np.asarray(norm["mean"], np.float32))
            / np.asarray(norm["std"], np.float32)).astype(np.float32)


def incomplete_months(start, end):
    """Month keys with at least one missing solar cell-day (no fabrication allowed)."""
    d = (pl.scan_parquet(sorted((RAW / "power").glob("*.parquet")))
         .filter(pl.col("variable") == "ALLSKY_SFC_SW_DWN")
         .filter((pl.col("date_or_year") >= f"{start}-01")
                 & (pl.col("date_or_year") <= _end_day(end)))
         .filter(pl.col("value").is_null())
         .select("date_or_year").collect())
    return set(d["date_or_year"].str.slice(0, 7).unique().to_list())


def blocks(start_year=1984, years=4, out=None):
    """Sliding Oct-Sep blocks, standardized, stacked as [n_blocks, cells, 48, 10].

    Blocks whose window contains a month with any missing solar day are excluded rather
    than filled; the excluded starts are reported alongside the array.
    """
    cell_ids = cells()
    last = 2021
    bad = incomplete_months(f"{start_year}-10", f"{last + years}-09")
    starts = [y for y in range(start_year, last + 1)
              if not any(f"{y + (10 - 1 + k) // 12}-{(10 - 1 + k) % 12 + 1:02d}" in bad
                         for k in range(years * 12))]
    assert starts, "no complete block"
    assert starts == list(range(starts[0], starts[-1] + 1)), "complete blocks are not contiguous"
    grid, keys = monthly_grid(cell_ids, f"{starts[0]}-10", f"{starts[-1] + years}-09")
    assert len(keys) == (starts[-1] - starts[0]) * 12 + years * 12
    std = standardise(grid)
    m = years * 12
    out_blocks = np.stack([std[:, i * 12:i * 12 + m] for i in range(len(starts))])
    if out:
        np.save(out, out_blocks.astype(np.float32))
        Path(out).with_suffix(".json").write_text(json.dumps(
            {"starts": starts, "years": years, "excluded_start_years":
             [y for y in range(start_year, last + 1) if y not in starts],
             "excluded_reason": "missing ALLSKY_SFC_SW_DWN cell-days in "
                                + ", ".join(sorted(bad))}, indent=2))
    return out_blocks, starts


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["check", "blocks"])
    ap.add_argument("--out", default=str(OUT / "weather_blocks_1984.npy"))
    args = ap.parse_args(argv)

    if args.mode == "check":
        cell_ids = cells()
        grid, _ = monthly_grid(cell_ids, "2016-10", "2024-09")
        ref = np.load(OUT / "weather.npy")
        for i, name in enumerate(WEATHER_CHANNELS):
            d = np.abs(grid[:, :, i] - ref[:, :, i])
            print(f"{name:20s} max abs diff {np.nanmax(d):.6g}")
            assert np.nanmax(d) < 1e-3, f"{name} does not reproduce weather.npy"
        print(f"reproduces weather.npy on {len(cell_ids)} cells x 96 months")
        return

    b, starts = blocks(out=args.out)
    print(f"wrote {args.out}: {b.shape} (block starts {starts[0]}..{starts[-1]})")


if __name__ == "__main__":
    main()
