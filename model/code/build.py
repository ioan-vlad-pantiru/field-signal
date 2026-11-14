"""Crop-rotation training tensors -> data/processed/ (raw values, no split, no scaling).

Reads data/interim/{points,crops}.parquet and data/raw/*, writes .npy arrays plus
points_derived/kept_points/dropped_points parquet and meta.json. Never writes into
data/raw or data/interim.

    venv/bin/python code/build.py --dev     # fully covered points only
    venv/bin/python code/build.py           # final run: halts if any point lacks data
    venv/bin/python code/build.py --self-check
"""
import argparse
import calendar
import json
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import polars as pl

from schema import SMAP_UNCOVERED_CELLS  # frozen contract: cells SMAP's land mask drops
from weather import power_cell, smap_cell  # the downloader's key contract, reused verbatim

ROOT = Path("/home/jovyan/work/crop_rotation")
DATA = ROOT / "data"
RAW = DATA / "raw"
POINTS = DATA / "interim" / "points.parquet"
CROPS = DATA / "interim" / "crops.parquet"
OUT = DATA / "processed"

# 96 months, 2016-10 .. 2024-09; crop year t = Oct(t-1)..Sep(t), label of harvest year t.
START_Y, START_M, N_MONTHS = 2016, 10, 96
MONTHS = [(START_Y + (START_M - 1 + i) // 12, (START_M - 1 + i) % 12 + 1) for i in range(N_MONTHS)]
MONTH_KEYS = [f"{y}-{m:02d}" for y, m in MONTHS]
MONTH_INDEX = {k: i for i, k in enumerate(MONTH_KEYS)}
CROP_YEAR_OF_MONTH = [y + (m >= 10) for y, m in MONTHS]
CROP_YEARS = list(dict.fromkeys(CROP_YEAR_OF_MONTH))
DAY0 = MONTH_KEYS[0] + "-01"
DAY1 = f"{MONTH_KEYS[-1]}-{calendar.monthrange(*MONTHS[-1])[1]:02d}"

MAX_NON_CROP_YEARS = 2
CLASSES = ["wheat", "barley", "maize", "sunflower", "soybeans", "dry_pulses",
           "rapeseed", "other", "non_crop", "missing"]
MISSING = CLASSES.index("missing")
STATE_CHANNELS = ["ndvi", "sm_rootzone"]
WEATHER_CHANNELS = ["t2m_max", "t2m_min", "rh2m", "ws2m", "solar", "precip", "et0",
                    "hot_days", "frost_days", "dry_run_max"]
WEATHER_AGG = ["T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR",
               "ET0", "hot_days", "frost_days", "dry_run_max"]
CROP_CHANNELS = ["crop", "prev_crop_1", "prev_crop_2"]
STATIC_CHANNELS = ["clay", "sand", "soc", "ph", "elevation", "slope"]
SOIL_VARS = ["clay", "sand", "soc", "phh2o"]
SRTM_VARS = ["elevation", "slope"]
POWER_VARS = ["T2M_MAX", "T2M_MIN", "RH2M", "WS2M", "ALLSKY_SFC_SW_DWN", "PRECTOTCORR"]
CELL_KEYED = {"power", "smap"}
NODATA_WARN_SHARE = 0.005
BG_NUTS3 = ["BG324", "BG325", "BG331", "BG332", "BG333", "BG334", "BG341", "BG342", "BG343"]


# ---------------------------------------------------------------- inputs

def _scan(dataset):
    files = sorted((RAW / dataset).glob("*.parquet"))
    if not files:
        raise SystemExit(f"no parquet files under {RAW / dataset}")
    return pl.scan_parquet(files)


def _window(lf):
    """Rows inside the 96-month window; month index is added separately."""
    return lf.filter(pl.col("date_or_year").is_between(pl.lit(DAY0), pl.lit(DAY1)))


def _presence(lf, key="point_id"):
    """Keys that appear anywhere in a dataset: download state, unlike the in-window mask."""
    return lf.select(key).unique().collect()[key].to_list()


def _presence_all(lf, variables):
    """Points carrying every variable of a multi-variable dataset (a partial row is not data)."""
    return (lf.filter(pl.col("variable").is_in(variables))
            .group_by("point_id").agg(pl.col("variable").n_unique().alias("n"))
            .filter(pl.col("n") == len(variables)).select("point_id").collect()["point_id"].to_list())


def _month_idx(col="date_or_year"):
    return pl.col(col).str.slice(0, 7).replace_strict(MONTH_INDEX, return_dtype=pl.Int16)


def print_schema():
    """Step 0: every input's schema and join key, before anything is built."""
    print(f"window: {MONTH_KEYS[0]} .. {MONTH_KEYS[-1]}  ({N_MONTHS} months, "
          f"crop years {CROP_YEARS[0]}-{CROP_YEARS[-1]})")
    rows = [("points.parquet", "point_id", pl.scan_parquet(POINTS).collect_schema()),
            ("crops.parquet", "point_id,year", pl.scan_parquet(CROPS).collect_schema())]
    for ds, key in [("hls_ndvi", "point_id"), ("power", "cell_id"), ("smap_sm", "cell_id"),
                    ("soilgrids", "point_id"), ("srtm", "point_id")]:
        rows.append((f"raw/{ds}/", key, _scan(ds).collect_schema()))
    for name, key, schema in rows:
        print(f"\n{name}  join key: {key}\n  {dict(schema)}")

    power_keys = _scan("power").select("cell_id").unique().collect()["cell_id"]
    smap_keys = _scan("smap_sm").select("cell_id").unique().collect()["cell_id"]
    print(f"\nPOWER cell ids e.g. {power_keys.head(3).to_list()}  ({power_keys.len()} cells)")
    print(f"SMAP  cell ids e.g. {smap_keys.head(3).to_list()}  ({smap_keys.len()} cells)")
    if set(power_keys.to_list()) & set(smap_keys.to_list()):
        raise SystemExit("POWER and SMAP cell keys share a namespace; join keys are ambiguous")
    print("-> different namespaces: POWER on power_cell_id (= points.cell_id), "
          "SMAP on smap_cell_id (recomputed with weather.smap_cell)")


def derive_cells(points):
    """power_cell_id / smap_cell_id per point, using the downloader's own functions."""
    power, smap = [], []
    for lon, lat in zip(points["lon"].to_list(), points["lat"].to_list()):
        power.append(power_cell(lon, lat))
        smap.append(smap_cell(lon, lat))
    out = pl.DataFrame({"point_id": points["point_id"], "power_cell_id": power, "smap_cell_id": smap})
    bad = (out["power_cell_id"] != points["cell_id"]).sum()
    assert bad == 0, f"{bad} points: power_cell(lon,lat) != points.cell_id; keys are ambiguous"
    out.write_parquet(OUT / "points_derived.parquet")
    print(f"\npoints_derived.parquet: {out.height} points, "
          f"{out['power_cell_id'].n_unique()} POWER cells, {out['smap_cell_id'].n_unique()} SMAP cells")
    return out


# ---------------------------------------------------------------- filter

def filter_points(points, crops):
    nc = (crops.group_by("point_id")
          .agg((pl.col("crop") == "non_crop").sum().alias("n_non_crop"), pl.len().alias("n_years")))
    print("\nnon_crop years per point:",
          nc.group_by("n_non_crop").agg(pl.len().alias("points")).sort("n_non_crop").rows())
    kept = (nc.filter(pl.col("n_non_crop") <= MAX_NON_CROP_YEARS)
            .join(points.select("point_id", "nuts3", "country"), on="point_id", how="inner")
            .select("point_id", "nuts3", "country").sort("point_id"))
    dropped = (nc.filter(pl.col("n_non_crop") > MAX_NON_CROP_YEARS)
               .join(points.select("point_id", "nuts3", "country"), on="point_id", how="inner")
               .with_columns(pl.lit("non_crop_years").alias("reason")))

    print(f"\nkept {kept.height} of {nc.height} points "
          f"(<= {MAX_NON_CROP_YEARS} non_crop years, {nc['n_years'].max()} years in crops.parquet)")
    print(kept.group_by("country").agg(pl.len().alias("points_kept")).sort("country"))

    soy = (kept.select("point_id", "nuts3").join(crops.select("point_id", "year", "crop"), on="point_id")
           .filter(pl.col("nuts3").is_in(BG_NUTS3))
           .group_by("nuts3", "year")
           .agg((pl.col("crop") == "soybeans").mean().alias("share"))
           .pivot(on="year", index="nuts3", values="share").sort("nuts3"))
    print("\nsoybeans share per nuts3 x year (kept points, share of all point-years):")
    print(soy)
    return kept, dropped


def check_coverage(kept, derived):
    """A point needs HLS, SMAP, POWER, SoilGrids and SRTM. Missing data is never a mask.

    Presence is measured over the whole raw dataset, not the window: a point absent
    everywhere was never downloaded, a point with rows but no in-window rows is a
    cloud/snow gap and stays (its mask is 0). Cell-keyed absence is always pending,
    because cells are fetched whole; point-keyed absence after another point-keyed
    dataset was fetched is nodata (the query ran and the source had nothing).
    """
    present_keys = {
        "hls": _presence(_scan("hls_ndvi")),
        "smap": _presence(_scan("smap_sm"), "cell_id"),
        "power": _presence(_scan("power"), "cell_id"),
        "soilgrids": _presence_all(_scan("soilgrids"), SOIL_VARS),
        "srtm": _presence_all(_scan("srtm"), SRTM_VARS),
    }
    ids = kept.join(derived.select("point_id", "power_cell_id", "smap_cell_id"), on="point_id", how="left")
    present = {
        "hls": ids["point_id"].is_in(present_keys["hls"]).to_numpy(),
        "smap": ids["smap_cell_id"].is_in(present_keys["smap"]).to_numpy(),
        "power": ids["power_cell_id"].is_in(present_keys["power"]).to_numpy(),
        "soilgrids": ids["point_id"].is_in(present_keys["soilgrids"]).to_numpy(),
        "srtm": ids["point_id"].is_in(present_keys["srtm"]).to_numpy(),
    }
    # SMAP's land mask drops these cells outright (schema.SMAP_UNCOVERED_CELLS): nodata, not pending.
    uncovered = ids["smap_cell_id"].is_in(sorted(SMAP_UNCOVERED_CELLS)).to_numpy()
    print("\ncoverage of kept points (whole dataset, not the window):")
    for name, ok in present.items():
        print(f"  {name:9s} {int(ok.sum()):7d} / {len(ok):7d}  {100 * ok.mean():5.1f}%")

    any_point_keyed = present["hls"] | present["soilgrids"] | present["srtm"]
    reason = np.full(len(ids), "", dtype=object)
    for name in present:
        miss = ~present[name] & (reason == "")
        blocked = uncovered if name == "smap" else np.zeros(len(ids), bool)
        cell_pending = miss & (name in CELL_KEYED) & ~blocked
        reason[miss] = np.where(cell_pending | (miss & ~any_point_keyed),
                                f"missing_{name}", f"nodata_{name}")[miss]

    drop = pl.DataFrame({"point_id": ids["point_id"], "nuts3": ids["nuts3"],
                         "country": ids["country"], "reason": reason}).filter(pl.col("reason") != "")
    counts = dict(drop.group_by("reason").len().rows())
    print(f"\nincomplete kept points by reason: {counts}")
    pending = {k: v for k, v in counts.items() if k.startswith("missing_")}
    for k, v in counts.items():
        if k.startswith("nodata_") and v > NODATA_WARN_SHARE * max(kept.height, 1):
            print(f"  warning: {k} is {100 * v / kept.height:.2f}% of kept points (> "
                  f"{100 * NODATA_WARN_SHARE:.1f}%); check whether that download is complete")
    if pending:
        print(f"  pending downloads: {pending} ({100 * sum(pending.values()) / kept.height:.1f}% of kept points)")
    return ids.filter(pl.Series("ok", np.logical_and.reduce(list(present.values())))).select(
        "point_id", "nuts3", "country"), drop, pending


# ---------------------------------------------------------------- weather

def _fao56_et0(tmax, tmin, rh, rs, u2, doy, lat_deg, z):
    """FAO-56 eq. 6 (G = 0). es by eq. 12, ea by eq. 19 with mean RH.

    es = (e°(Tmax) + e°(Tmin)) / 2, ea = RHmean/100 · es, Tmean = (Tmax+Tmin)/2 for Δ
    and the temperature term. MJ m-2 d-1.
    """
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
    ra = (24 * 60 / np.pi) * 0.0820 * dr * (
        ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    rso = np.maximum((0.75 + 2e-5 * z) * ra, 1e-6)
    rnl = (4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2.0
           * (0.34 - 0.14 * np.sqrt(np.maximum(ea, 0.0))) * (1.35 * rs / rso - 0.35))
    rn = 0.77 * rs - rnl
    num = 0.408 * delta * rn + gamma * 900.0 / (tmean + 273.0) * u2 * (es - ea)
    return num / (delta + gamma * (1 + 0.34 * u2)), es, ea


def build_weather(points, kept, cells):
    """POWER daily -> 96 monthly aggregates per cell; FAO-56 daily ET0 first."""
    wide = (_window(_scan("power")).collect()
            .filter(pl.col("cell_id").is_in(list(cells)))  # only cells the kept points sit in
            .pivot(on="variable", index=["cell_id", "date_or_year"], values="value",
                   aggregate_function="first"))
    missing = set(POWER_VARS) - set(wide.columns)
    assert not missing, f"POWER missing variables {sorted(missing)}"
    nulls = wide.select([pl.col(c).null_count() for c in POWER_VARS]).row(0)
    assert max(nulls) == 0, f"POWER has nulls in {DAY0}..{DAY1} (per channel: {nulls})"

    # cell geometry: mean latitude and mean SRTM elevation of the kept points in the cell
    srtm = (_scan("srtm").filter(pl.col("variable") == "elevation")
            .select("point_id", pl.col("value").alias("elevation")).collect())
    site = (points.select("point_id", "lat", "cell_id").join(kept.select("point_id"), on="point_id")
            .join(srtm, on="point_id", how="left")
            .group_by("cell_id")
            .agg(pl.col("lat").mean().alias("lat"), pl.col("elevation").mean().alias("z")))
    wide = wide.join(site, on="cell_id", how="left")
    assert wide["lat"].null_count() == 0 and wide["z"].null_count() == 0, \
        f"{wide.filter(pl.col('z').is_null())['cell_id'].unique().len()} POWER cells have no SRTM elevation"

    doy = wide["date_or_year"].str.to_date().dt.ordinal_day().to_numpy()
    et0, es, ea = _fao56_et0(
        wide["T2M_MAX"].to_numpy(), wide["T2M_MIN"].to_numpy(), wide["RH2M"].to_numpy(),
        wide["ALLSKY_SFC_SW_DWN"].to_numpy(), wide["WS2M"].to_numpy(), doy,
        wide["lat"].to_numpy(), wide["z"].to_numpy())
    assert np.isfinite(et0).all(), "ET0 is not finite"
    assert (es >= ea - 1e-9).all(), "vapour pressure: ea > es"
    negative = int((et0 < 0).sum())
    et0 = np.maximum(et0, 0.0)  # FAO-56: a negative daily ET0 is a computation artifact
    wide = wide.with_columns(pl.Series("ET0", et0, dtype=pl.Float32), _month_idx().alias("m"))

    # longest run of dry days (PRECTOTCORR < 1 mm) inside each month
    dry = (wide.sort(["cell_id", "date_or_year"])
           .with_columns((pl.col("PRECTOTCORR") < 1.0).alias("dry"))
           .with_columns((pl.col("dry") != pl.col("dry").shift(1).over("cell_id"))
                         .cum_sum().over("cell_id").alias("run")))
    runs = (dry.filter(pl.col("dry")).group_by("cell_id", "m", "run").agg(pl.len().alias("n"))
            .group_by("cell_id", "m").agg(pl.col("n").max().alias("dry_run_max")))
    monthly = (wide.group_by("cell_id", "m")
               .agg([pl.col(c).mean().alias(c) for c in ["T2M_MAX", "T2M_MIN", "RH2M", "WS2M",
                                                         "ALLSKY_SFC_SW_DWN"]]
                    + [pl.col("PRECTOTCORR").sum().alias("PRECTOTCORR"), pl.col("ET0").sum().alias("ET0"),
                       (pl.col("T2M_MAX") > 32.0).sum().alias("hot_days"),
                       (pl.col("T2M_MIN") < 0.0).sum().alias("frost_days")])
               .join(runs, on=["cell_id", "m"], how="left")
               .with_columns(pl.col("dry_run_max").fill_null(0))
               .sort("cell_id", "m"))

    cmap = {c: i for i, c in enumerate(cells)}
    monthly = monthly.with_columns(pl.col("cell_id").replace_strict(cmap, return_dtype=pl.Int32).alias("ci"))
    assert monthly.height == len(cells) * N_MONTHS, \
        f"weather grid has {monthly.height} rows, expected {len(cells)} cells x {N_MONTHS} months"
    grid = np.full((len(cells), N_MONTHS, len(WEATHER_CHANNELS)), np.nan, np.float32)
    grid[monthly["ci"].to_numpy(), monthly["m"].to_numpy()] = np.column_stack(
        [monthly[c].to_numpy() for c in WEATHER_AGG])

    annual = grid[:, :, 6].reshape(len(cells), len(CROP_YEARS), 12).sum(axis=2).mean(axis=1)
    print(f"\nET0: {negative} negative daily values clamped to 0; annual mm/cell "
          f"min={annual.min():.0f} median={np.median(annual):.0f} max={annual.max():.0f}")
    if not 600 <= np.median(annual) <= 1000:
        raise SystemExit(f"ET0 sanity failed: annual median {np.median(annual):.0f} mm outside 600-1000")
    return grid


# ---------------------------------------------------------------- state

def build_state(kept, derived, cells):
    n = kept.height
    rows = pl.DataFrame({"point_id": kept["point_id"]}).with_row_index("row")
    state = np.full((n, N_MONTHS, 2), np.nan, np.float32)
    mask = np.zeros((n, N_MONTHS, 2), np.uint8)

    hls = (_window(_scan("hls_ndvi")).join(rows.lazy(), on="point_id", how="inner")
           .select("row", _month_idx().alias("m"), "value").collect())
    assert hls.height == hls.select(pl.struct("row", "m").n_unique()).item(), \
        "HLS has more than one row per point x month"
    r, m = hls["row"].to_numpy(), hls["m"].to_numpy()
    state[r, m, 0] = hls["value"].to_numpy()
    mask[r, m, 0] = 1
    bad = np.abs(state[:, :, 0]) >= 0.999  # HLS fill/water extremes: not a measurement
    state[:, :, 0][bad] = np.nan
    mask[:, :, 0][bad] = 0

    smap_raw = _window(_scan("smap_sm"))
    smap = (smap_raw.select("cell_id", _month_idx().alias("m"), "value")
            .group_by("cell_id", "m").agg(pl.col("value").mean())  # monthly mean of the 10-day values
            .collect())
    smaps = sorted(smap["cell_id"].unique().to_list())
    invalid = sorted(smap_raw.group_by("cell_id").agg(pl.col("value").median())
                     .filter(pl.col("value") > 0.6).collect()["cell_id"].to_list())
    smap_grid = np.full((len(smaps), N_MONTHS), np.nan, np.float32)
    smap_grid[smap["cell_id"].replace_strict({c: i for i, c in enumerate(smaps)},
                                             return_dtype=pl.Int32).to_numpy(),
              smap["m"].to_numpy()] = smap["value"].to_numpy()
    bad_rows = [i for i, c in enumerate(smaps) if c in set(invalid)]  # L4 over water: > porosity
    smap_grid[bad_rows, :] = np.nan
    point_cell = (rows.join(derived.select("point_id", "smap_cell_id"), on="point_id", how="left")
                  ["smap_cell_id"].replace_strict({c: i for i, c in enumerate(smaps)},
                                                  default=-1, return_dtype=pl.Int32).to_numpy())
    has = point_cell >= 0
    state[has, :, 1] = smap_grid[point_cell[has]]
    mask[:, :, 1] = np.isfinite(state[:, :, 1])

    cell_idx = (rows.join(derived.select("point_id", "power_cell_id"), on="point_id", how="left")
                ["power_cell_id"].replace_strict({c: i for i, c in enumerate(cells)},
                                                 return_dtype=pl.Int32).to_numpy())
    print(f"state: HLS months/point mean {mask[:, :, 0].sum(1).mean():.1f}, "
          f"SMAP months/point mean {mask[:, :, 1].sum(1).mean():.1f}, "
          f"|ndvi|>=0.999 masked: {int(bad.sum())}, "
          f"invalid SMAP cells (median>0.6): {len(invalid)}")
    return state, mask, cell_idx, invalid


# ---------------------------------------------------------------- labels + static

def build_labels(kept, crops, points):
    n, n_years = kept.height, len(CROP_YEARS)
    rows = pl.DataFrame({"point_id": kept["point_id"]}).with_row_index("row")
    label = (rows.join(crops.select("point_id", "year", "crop", "confidence"), on="point_id", how="inner")
             .with_columns(pl.col("crop").replace_strict(
                 {c: i for i, c in enumerate(CLASSES[:-1])}, return_dtype=pl.Int8).alias("cls"),
                 (pl.col("year") - CROP_YEARS[0]).alias("y")))
    assert sorted(label["year"].unique().to_list()) == CROP_YEARS, \
        f"crops years {sorted(label['year'].unique().to_list())} != window crop years {CROP_YEARS}"

    r, y = label["row"].to_numpy(), label["y"].to_numpy()
    crop = np.full((n, n_years, 3), MISSING, np.int8)
    crop[r, y, 0] = label["cls"].to_numpy()
    conf = np.full((n, n_years), np.nan, np.float32)
    conf[r, y] = label["confidence"].cast(pl.Float32).to_numpy()
    crop[:, 1:, 1] = crop[:, :-1, 0]  # prev_crop_1
    crop[:, 2:, 2] = crop[:, :-2, 0]  # prev_crop_2; before 2017 stays "missing"
    assert (crop[:, 0, 1] == MISSING).all() and (crop[:, 1, 2] == MISSING).all()

    weight = (rows.join(points.select("point_id", "inclusion_probability"), on="point_id")
              .sort("row")["inclusion_probability"].to_numpy())  # join does not keep row order
    assert (weight > 0).all() and np.isfinite(weight).all(), "inclusion_probability must be > 0"
    print(f"labels: {n_years} crop years, {len(np.unique(crop[:, :, 0]))} classes present, "
          f"weight {weight.min():.2f}-{weight.max():.2f}")
    return crop, conf, (1.0 / weight).astype(np.float32)


def build_static(kept):
    rows = pl.DataFrame({"point_id": kept["point_id"]}).with_row_index("row")
    soil = (_scan("soilgrids").filter(pl.col("variable").is_in(SOIL_VARS))
            .group_by("point_id", "variable").agg(pl.col("value").first()).collect())
    assert set(soil["variable"].unique().to_list()) == set(SOIL_VARS), "unexpected SoilGrids variables"
    srtm = (_scan("srtm").filter(pl.col("variable").is_in(SRTM_VARS))
            .group_by("point_id", "variable").agg(pl.col("value").first()).collect())
    assert set(srtm["variable"].unique().to_list()) == set(SRTM_VARS), "unexpected SRTM variables"

    wide = (rows.join(pl.concat([soil, srtm]).pivot(on="variable", index="point_id",
                                                    values="value", aggregate_function="first"),
                      on="point_id", how="left").rename({"phh2o": "ph"}))
    static = np.column_stack([wide[c].to_numpy() for c in STATIC_CHANNELS]).astype(np.float32)
    assert np.isfinite(static).all(), "static channels have gaps after the completeness filter"
    return static


# ---------------------------------------------------------------- save + report

def save(point_ids, state, state_mask, weather, cell_idx, crop, conf, static, weight, coverage,
         invalid_smap):
    OUT.mkdir(parents=True, exist_ok=True)
    arrays = {"state": state, "state_mask": state_mask, "weather": weather, "cell_idx": cell_idx,
              "crop": crop, "confidence": conf, "static": static, "weight": weight,
              "point_ids": np.asarray(point_ids)}
    for name, arr in arrays.items():
        np.save(OUT / f"{name}.npy", arr)
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "n_points": len(point_ids), "n_cells": coverage["power_cells"],
        "months": MONTH_KEYS, "crop_years": CROP_YEARS,
        "state_channels": STATE_CHANNELS,
        "state_mask": "1 = observed (HLS row present / SMAP row present), 0 = cloud-snow gap",
        "weather_channels": WEATHER_CHANNELS,
        "weather_units": ["degC", "degC", "%", "m/s", "MJ/m2/day", "mm", "mm",
                          "days", "days", "days"],
        "crop_channels": CROP_CHANNELS, "classes": CLASSES,
        "static_channels": STATIC_CHANNELS,
        "static_units": ["%", "%", "g/kg", "pH", "m", "deg"],
        "weight": "1 / inclusion_probability",
        "invalid_smap_cells": invalid_smap,
        "arrays": {k: list(v.shape) for k, v in arrays.items()},
        "coverage": coverage,
        "notes": ["raw values, no normalisation; no split (join splits.parquet on point_id)",
                  "NDVI |ndvi| >= 0.999 is masked as unobserved (HLS fill/water)",
                  "SMAP cells with median sm_rootzone > 0.6 over the window are masked",
                  "SMAP is cell-keyed: sm is the monthly mean of the cell's 10-day values",
                  "dry_run_max is the longest run of PRECTOTCORR < 1 mm within a calendar month",
                  "crop[y,1]/crop[y,2] are the previous 1/2 crop years; 'missing' before 2017"],
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"\nwrote {len(arrays)} arrays + meta.json to {OUT}")


def report(state, state_mask, weather, crop, conf, static, point_ids):
    shapes = [("state", state), ("state_mask", state_mask), ("weather", weather), ("cell_idx", None),
              ("crop", crop), ("confidence", conf), ("static", static)]
    print("\nshapes:", {n: a.shape for n, a in shapes if a is not None})
    shares = {"ndvi (null share)": np.isnan(state[:, :, 0]).mean(),
              "sm (null share)": np.isnan(state[:, :, 1]).mean(),
              "ndvi mask=0": 1 - state_mask[:, :, 0].mean(),
              "sm mask=0": 1 - state_mask[:, :, 1].mean(),
              **{f"weather {c}": np.isnan(weather[:, :, i]).mean()
                 for i, c in enumerate(WEATHER_CHANNELS)},
              **{f"static {c}": np.isnan(static[:, i]).mean() for i, c in enumerate(STATIC_CHANNELS)},
              "confidence": np.isnan(conf).mean(),
              "crop = missing": (crop[:, :, 0] == MISSING).mean()}
    print("null share per channel:")
    for k, v in shares.items():
        print(f"  {k:24s} {100 * v:6.2f}%")

    rng = np.random.default_rng(0)
    picks = rng.choice(len(point_ids), size=4, replace=False)
    fig, axes = plt.subplots(4, 2, figsize=(14, 12), sharex=True)
    x = np.arange(N_MONTHS)
    for row_axes, i in zip(axes, picks):
        for ax, ch, obs, label in [(row_axes[0], state[i, :, 0], state_mask[i, :, 0] > 0, "NDVI"),
                                   (row_axes[1], state[i, :, 1], state_mask[i, :, 1] > 0, "root-zone soil moisture")]:
            ax.plot(x, ch, lw=1.2, color="#2c6e49")
            ax.scatter(x[obs], ch[obs], s=5, color="#2c6e49", zorder=3)
            ax.set_ylabel(label, fontsize=8)
            ax.grid(alpha=.25)
            for t, year in enumerate(CROP_YEARS):
                if t % 2 == 0:
                    ax.axvspan(t * 12 - .5, t * 12 + 11.5, color="#2c6e49", alpha=.05)
                ax.annotate(f"{year}\n{CLASSES[crop[i, t, 0]]}", (t * 12 + 5.5, 0),
                            xycoords=("data", "axes fraction"), ha="center", va="bottom", fontsize=6)
        row_axes[0].set_title(f"point {point_ids[i]}", fontsize=9)
    axes[-1, 0].set_xticks(x[::6])
    axes[-1, 0].set_xticklabels([MONTH_KEYS[i] for i in x[::6]], rotation=45, ha="right", fontsize=7)
    fig.tight_layout()
    fig.savefig(OUT / "state_curves.png", dpi=130)
    print(f"wrote {OUT / 'state_curves.png'}")


# ---------------------------------------------------------------- entry point

def main(argv=None):
    ap = argparse.ArgumentParser(prog="build.py", description="crop-rotation training tensors")
    ap.add_argument("--dev", action="store_true", help="build only fully covered points")
    ap.add_argument("--self-check", action="store_true", help="assert the key and ET0 contracts, then exit")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()

    OUT.mkdir(parents=True, exist_ok=True)
    print_schema()
    points = pl.read_parquet(POINTS)
    crops = pl.read_parquet(CROPS)
    derived = derive_cells(points)

    kept_all, dropped = filter_points(points, crops)
    kept, coverage_drop, pending = check_coverage(kept_all, derived)
    dropped = pl.concat([dropped, coverage_drop], how="diagonal_relaxed")
    dropped.write_parquet(OUT / "dropped_points.parquet")
    if pending and not args.dev:
        raise SystemExit(f"{sum(pending.values())} kept points are still downloading {sorted(pending)}; "
                         f"rerun with --dev, or wait for the download. "
                         f"See {OUT / 'dropped_points.parquet'}")
    kept_all.write_parquet(OUT / "kept_points.parquet")  # all survivors: split.py splits these

    cells = sorted(derived.join(kept.select("point_id"), on="point_id")["power_cell_id"].unique().to_list())
    weather = build_weather(points, kept, cells)
    state, state_mask, cell_idx, invalid_smap = build_state(kept, derived, cells)
    crop, conf, weight = build_labels(kept, crops, points)
    static = build_static(kept)

    coverage = {"input_points": points.height, "kept_points": kept_all.height,
                "covered_points": kept.height, "dropped": dropped.height,
                "power_cells": len(cells), "by_reason": dropped.group_by("reason").len().rows()}
    save(kept["point_id"].to_list(), state, state_mask, weather, cell_idx, crop, conf, static,
         weight, coverage, invalid_smap)
    report(state, state_mask, weather, crop, conf, static, kept["point_id"].to_list())


def self_check():
    """The two contracts the build silently depends on: SMAP cell keys and the ET0 arithmetic."""
    pts = pl.read_parquet(POINTS, columns=["point_id", "lon", "lat", "cell_id"])
    power = pl.Series([power_cell(lon, lat) for lon, lat in zip(pts["lon"], pts["lat"])])
    assert (power == pts["cell_id"]).all(), "power_cell(lon, lat) != points.cell_id"

    # Every downloaded cell must be reachable from a point; a computed cell that is not
    # downloaded must belong only to points with no HLS yet, i.e. still pending.
    raw_cells = set(_presence(_scan("smap_sm"), "cell_id"))
    cells = pl.Series([smap_cell(lon, lat) for lon, lat in zip(pts["lon"], pts["lat"])])
    unpacked = set(cells.unique().to_list())
    assert not raw_cells - unpacked, \
        f"{len(raw_cells - unpacked)} downloaded SMAP cells have no point: {sorted(raw_cells - unpacked)[:5]}"
    has_hls = pts["point_id"].is_in(_presence(_scan("hls_ndvi")))
    landed = set(cells.filter(has_hls).unique().to_list()) - raw_cells - SMAP_UNCOVERED_CELLS
    assert not landed, f"{len(landed)} SMAP cells of downloaded points are not downloaded: {sorted(landed)[:5]}"
    print(f"smap cells: {len(unpacked)} computed, {len(raw_cells)} downloaded, "
          f"{len(unpacked - raw_cells)} pending (points without HLS yet), "
          f"{len(raw_cells & unpacked)}/{len(raw_cells)} downloaded cells hit by a point")

    # Hand-computed against FAO-56 Table 2.3: e°(21.5) = 2.564 kPa, e°(12.3) = 1.431 kPa;
    # es = (2.564 + 1.431)/2 = 1.998, ea = RHmean/100 · es = 0.735 · 1.998 = 1.468.
    _, es, ea = _fao56_et0(np.float64(21.5), np.float64(12.3), np.float64(73.5),
                           np.float64(22.0), np.float64(2.78), np.int32(188),
                           np.float64(50.8), np.float64(100.0))
    assert abs(es - 1.998) < 2e-3 and abs(ea - 1.468) < 2e-3, \
        f"es/ea {float(es):.3f}/{float(ea):.3f} != hand 1.998/1.468"

    base = dict(tmax=np.float64(30), tmin=np.float64(15), rh=np.float64(60), rs=np.float64(25),
                u2=np.float64(2), doy=np.int32(200), lat_deg=np.float64(45), z=np.float64(100))
    et0 = _fao56_et0(**base)[0]
    assert 3.0 < et0 < 9.0, f"July ET0 {float(et0):.2f} mm/day outside 3-9"
    assert _fao56_et0(**{**base, "rh": np.float64(90)})[0] < et0, "ET0 must fall as RH rises"
    assert _fao56_et0(**{**base, "u2": np.float64(5)})[0] > et0, "ET0 must rise with wind"
    print("self-check ok")


if __name__ == "__main__":
    main()
