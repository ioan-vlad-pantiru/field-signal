"""Yield regressor per crop: Eurostat NUTS2 yields vs observed NDVI.

Reads data/processed (state/mask/crop/weight/point_ids, kept_points.parquet) and
data/yield/yield_table.parquet, writes features, models and a report. The LSTM
pipeline and its runs are untouched.

    venv/bin/python code/yield_models.py download
    venv/bin/python code/yield_models.py features
    venv/bin/python code/yield_models.py train
    venv/bin/python code/yield_models.py report
    venv/bin/python code/yield_models.py all
"""
import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import requests
from xgboost import XGBRegressor

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
YIELD = ROOT / "data" / "yield"
RAW = YIELD / "raw"
MODELS = ROOT / "models"
FIGURES = YIELD / "figures"

API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/apro_cpshr"
COUNTRIES = ("AT", "BG", "HR", "HU", "RO", "SK", "RS")
# apro_cpshr publishes YLD_HUMD_EU_T_HA only at country level; NUTS2 has production
# and area, and production/area reproduces the published country yield.
STRUCPRO = ("HPRD_HUMD_EU_THS_T", "AR_THS_HA")
# Eurostat apro_cpshr codes. C1100 (all wheat) has no NUTS2 production/area, so
# wheat uses C1110 (common wheat and spelt); dry_pulses = P0000.
CROP_CODES = {
    "wheat": "C1110",
    "barley": "C1300",
    "maize": "C1500",
    "rapeseed": "I1110",
    "sunflower": "I1120",
    "soybeans": "I1130",
    "dry_pulses": "P0000",
}
CODE_CROP = {v: k for k, v in CROP_CODES.items()}
SEASON_MONTHS = {
    "wheat": (3, 4, 5, 6),
    "barley": (3, 4, 5, 6),
    "rapeseed": (3, 4, 5, 6),
    "maize": (5, 6, 7, 8, 9),
    "sunflower": (5, 6, 7, 8, 9),
    "soybeans": (5, 6, 7, 8, 9),
    "dry_pulses": (4, 5, 6, 7),
}
MIN_POINTS = 30
MIN_REGION_YEARS = 3
FEATURES = ["ndvi_peak", "ndvi_sum"]
TARGET = "yield_t_ha"
XGB_PARAMS = dict(max_depth=2, n_estimators=200, learning_rate=0.05,
                  monotone_constraints=(1, 1), random_state=0)


def _months():
    meta = json.loads((PROCESSED / "meta.json").read_text())
    return meta["months"], meta["crop_years"], meta["classes"]


# ------------------------------------------------------------------ download

def _decode(payload):
    """Eurostat JSON -> (geo, year, crop, strucpro, value) rows, dimension order from j['id']."""
    sizes, dims = payload["size"], payload["id"]
    labels = [{pos: code for code, pos in payload["dimension"][d]["category"]["index"].items()}
              for d in dims]
    rows = []
    for key, value in payload["value"].items():
        if value is None:
            continue
        pos = np.unravel_index(int(key), sizes)
        rec = {d: labels[i][pos[i]] for i, d in enumerate(dims)}
        geo = rec["geo"]
        if len(geo) != 4 or geo[:2] not in COUNTRIES:  # NUTS2 only, not NUTS0/1
            continue
        rows.append((geo, int(rec["time"]), CODE_CROP[rec["crops"]], rec["strucpro"], float(value)))
    return rows


def download():
    params = [("format", "JSON"), ("lang", "EN")]
    params += [("strucpro", s) for s in STRUCPRO]
    params += [("crops", code) for code in CROP_CODES.values()]
    resp = requests.get(API, params=params, timeout=300)
    resp.raise_for_status()
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "apro_cpshr_yld.json").write_bytes(resp.content)

    long = pd.DataFrame(_decode(resp.json()),
                        columns=["nuts2", "harvest_year", "crop", "strucpro", "value"])
    wide = long.pivot_table(index=["nuts2", "harvest_year", "crop"], columns="strucpro",
                            values="value", aggfunc="first")
    wide = wide.dropna(subset=list(STRUCPRO))
    df = (wide["HPRD_HUMD_EU_THS_T"] / wide["AR_THS_HA"]).rename("yield_t_ha").reset_index()
    # zero/missing area gives inf/nan; those region-years are simply absent
    df = df[np.isfinite(df.yield_t_ha) & df.yield_t_ha.gt(0)].reset_index(drop=True)
    assert not df.duplicated(["nuts2", "harvest_year", "crop"]).any(), "duplicate yield keys"
    YIELD.mkdir(parents=True, exist_ok=True)
    df.sort_values(["nuts2", "harvest_year", "crop"]).to_parquet(YIELD / "yield_table.parquet", index=False)
    print(f"yield table: {len(df)} rows, {df.nuts2.nunique()} NUTS2 regions, "
          f"{df.harvest_year.min()}-{df.harvest_year.max()}")
    print(df.groupby("crop").size().to_string())


# ------------------------------------------------------------------ features

def features():
    months, years, classes = _months()
    midx = {m: i for i, m in enumerate(months)}
    state = np.load(PROCESSED / "state.npy")
    mask = np.load(PROCESSED / "state_mask.npy")
    crop = np.load(PROCESSED / "crop.npy")
    weight = np.load(PROCESSED / "weight.npy")
    ids = np.load(PROCESSED / "point_ids.npy", allow_pickle=True)
    kept = pd.read_parquet(PROCESSED / "kept_points.parquet", columns=["point_id", "nuts3"])
    lut = dict(zip(kept.point_id, kept.nuts3))
    nuts2 = np.array([lut[i][:4] for i in ids])
    assert (np.array([len(lut[i]) for i in ids]) >= 4).all(), "nuts3 shorter than 4 chars"
    assert state.shape[0] == len(ids) == crop.shape[0] == len(weight)

    rows = []
    for name, months_needed in SEASON_MONTHS.items():
        cls = classes.index(name)
        for yi, year in enumerate(years):
            sel = np.flatnonzero(crop[:, yi, 0] == cls)
            if sel.size == 0:
                continue
            cols = np.array([midx[f"{year}-{m:02d}"] for m in months_needed])
            # advanced indexing avoids materialising the full (n, 96, 2) slice
            obs = mask[sel[:, None], cols[None, :], 0].astype(bool)
            val = state[sel[:, None], cols[None, :], 0]
            n_obs = obs.sum(1)
            sel, obs, val = sel[n_obs >= 2], obs[n_obs >= 2], val[n_obs >= 2]
            if sel.size == 0:
                continue
            v = np.where(obs, val, np.nan)
            peak = np.nanmax(v, 1)
            ndvi_sum = np.nanmean(v, 1) * len(cols)
            w = weight[sel].astype(np.float64)
            region, inv = np.unique(nuts2[sel], return_inverse=True)
            n = np.bincount(inv)
            sw = np.bincount(inv, w)
            for j in np.flatnonzero(n >= MIN_POINTS):
                rows.append((region[j], region[j][:2], year, name,
                             np.bincount(inv, w * peak)[j] / sw[j],
                             np.bincount(inv, w * ndvi_sum)[j] / sw[j],
                             int(n[j])))

    feat = pd.DataFrame(rows, columns=["nuts2", "country", "harvest_year", "crop",
                                       "ndvi_peak", "ndvi_sum", "n_points"])
    assert feat[["ndvi_peak", "ndvi_sum"]].notna().all().all()
    assert feat.ndvi_peak.between(-1, 1).all() and feat.n_points.ge(MIN_POINTS).all()

    yld = pd.read_parquet(YIELD / "yield_table.parquet")
    yld = yld[yld.harvest_year.isin(years) & yld.nuts2.str[:2].isin(COUNTRIES)]
    train = feat.merge(yld, on=["nuts2", "harvest_year", "crop"], how="inner")
    train.sort_values(["crop", "harvest_year", "nuts2"]).to_parquet(
        YIELD / "training_table.parquet", index=False)

    fkey = set(map(tuple, feat[["nuts2", "harvest_year", "crop"]].to_numpy()))
    ykey = set(map(tuple, yld[["nuts2", "harvest_year", "crop"]].to_numpy()))
    unmatched = {
        "ndvi_regions_without_yield": sorted({k[0] for k in fkey - ykey}),
        "yield_regions_without_ndvi": sorted({k[0] for k in ykey - fkey}),
        "ndvi_rows_without_yield": len(fkey - ykey),
        "yield_rows_without_ndvi": len(ykey - fkey),
        "crops_without_training_rows": sorted(set(CROP_CODES) - set(train.crop.unique())),
        "countries_without_training_rows": sorted(set(COUNTRIES) - set(train.country.unique())),
    }
    (YIELD / "unmatched.json").write_text(json.dumps(unmatched, indent=2))
    print(f"training table: {len(train)} rows; unmatched NDVI rows {len(fkey - ykey)}, "
          f"yield rows {len(ykey - fkey)}")
    print(train.groupby(["country", "crop"]).size().unstack(fill_value=0).to_string())


# --------------------------------------------------------------------- train

def _scores(y, pred):
    y, pred = np.asarray(y, float), np.asarray(pred, float)
    rmse = float(np.sqrt(np.mean((pred - y) ** 2)))
    r2 = float(1 - np.sum((pred - y) ** 2) / np.sum((y - y.mean()) ** 2))
    return {"rmse": rmse, "r2": r2}


def _region_means(df):
    """Per-region means over df's years; regions with <3 years get the crop's mean region mean."""
    per_region = df.groupby("nuts2")[[TARGET, *FEATURES]].mean()
    counts = df.groupby("nuts2").size()
    fallback = per_region.mean()
    means = per_region.copy()
    means.loc[counts < MIN_REGION_YEARS, :] = fallback.to_numpy()
    return means, fallback, counts


def _anomaly_xy(df, means, fallback):
    """Region-centered features/target; unknown regions use the crop fallback."""
    rows = pd.DataFrame({c: df.nuts2.map(means[c]).fillna(fallback[c])
                         for c in (TARGET, *FEATURES)})
    X = df[FEATURES].to_numpy(float) - rows[FEATURES].to_numpy(float)
    y = df[TARGET].to_numpy(float) - rows[TARGET].to_numpy(float)
    return X, y, rows


def _save_region_means(crop_name, means, fallback, counts):
    payload = {
        "crop": crop_name,
        "features": FEATURES,
        "target": TARGET,
        "min_region_years": MIN_REGION_YEARS,
        "prediction": "region mean yield + model.predict(features - region means)",
        "fallback": {c: float(fallback[c]) for c in (TARGET, *FEATURES)},
        "regions": {
            str(nuts2): {**{c: float(row[c]) for c in (TARGET, *FEATURES)},
                         "n_years": int(counts[nuts2]),
                         "fallback": bool(counts[nuts2] < MIN_REGION_YEARS)}
            for nuts2, row in means.iterrows()
        },
    }
    (MODELS / f"yield_{crop_name}_region_means.json").write_text(json.dumps(payload, indent=2))


def train():
    df = pd.read_parquet(YIELD / "training_table.parquet")
    MODELS.mkdir(parents=True, exist_ok=True)
    metrics, oof_all = {}, []
    for crop_name, g in df.groupby("crop"):
        g = g.sort_values(["harvest_year", "nuts2"]).reset_index(drop=True)
        years = sorted(int(y) for y in g.harvest_year.unique())
        if len(g) < 4 or len(years) < 2:
            metrics[crop_name] = {"skipped": f"{len(g)} rows, {len(years)} years"}
            print(f"{crop_name}: skipped ({metrics[crop_name]['skipped']})")
            continue
        y = g[TARGET].to_numpy(float)
        pred = np.full(len(g), np.nan)
        base = np.full(len(g), np.nan)
        for year in years:
            test = g.harvest_year == year
            tr = ~test
            tr_df, te_df = g[tr], g[test]
            means, fallback, _ = _region_means(tr_df)
            Xtr, ytr, _ = _anomaly_xy(tr_df, means, fallback)
            model = XGBRegressor(**XGB_PARAMS, n_jobs=4).fit(Xtr, ytr)
            Xte, _, test_rows = _anomaly_xy(te_df, means, fallback)
            pred[test] = test_rows[TARGET].to_numpy() + model.predict(Xte)
            # baseline unchanged: mean yield of the region in the other years
            region_mean = pd.Series(y[tr]).groupby(g.nuts2[tr].to_numpy()).mean()
            base[test] = g.nuts2[test].map(region_mean).fillna(y[tr].mean()).to_numpy()
        assert np.isfinite(pred).all() and np.isfinite(base).all()
        metrics[crop_name] = {"rows": len(g), "regions": int(g.nuts2.nunique()),
                              "years": years, "model": _scores(y, pred),
                              "baseline": _scores(y, base)}
        oof_all.append(g.assign(pred=pred, baseline=base))
        means, fallback, counts = _region_means(g)
        X, y_anom, _ = _anomaly_xy(g, means, fallback)
        XGBRegressor(**XGB_PARAMS, n_jobs=4).fit(X, y_anom).save_model(MODELS / f"yield_{crop_name}.json")
        _save_region_means(crop_name, means, fallback, counts)
        print(f"{crop_name}: RMSE {metrics[crop_name]['model']['rmse']:.3f} vs baseline "
              f"{metrics[crop_name]['baseline']['rmse']:.3f}; R2 {metrics[crop_name]['model']['r2']:.3f} "
              f"vs {metrics[crop_name]['baseline']['r2']:.3f}")
    pd.concat(oof_all).to_parquet(YIELD / "oof_predictions.parquet", index=False)
    (MODELS / "yield_metrics.json").write_text(json.dumps(metrics, indent=2))


# -------------------------------------------------------------------- report

def report():
    df = pd.read_parquet(YIELD / "training_table.parquet")
    oof = pd.read_parquet(YIELD / "oof_predictions.parquet")
    metrics = json.loads((MODELS / "yield_metrics.json").read_text())
    unmatched = json.loads((YIELD / "unmatched.json").read_text())
    FIGURES.mkdir(parents=True, exist_ok=True)

    lines = ["# Yield models: Eurostat yields vs observed NDVI", "",
             "XGBoost per crop on region-centered `ndvi_peak` and `ndvi_sum` anomalies (monotone +). "
             "The target is yield minus the region's mean yield over the training years; predictions "
             "add the region mean back. Leave-one-harvest-year-out, against the region's mean yield "
             "from the other years.",
             "", "## Training rows per country and crop", ""]
    pivot = df.groupby(["country", "crop"]).size().unstack(fill_value=0)
    lines.append("| country | " + " | ".join(pivot.columns) + " | total |")
    lines.append("|---|" + "---|" * (len(pivot.columns) + 1))
    for country, row in pivot.iterrows():
        lines.append(f"| {country} | " + " | ".join(str(v) for v in row) + f" | {row.sum()} |")
    lines.append("")

    lines += ["## Model vs baseline (leave-one-year-out)", "",
              "| crop | rows | regions | years | model RMSE | model R2 | baseline RMSE | baseline R2 |",
              "|---|---|---|---|---|---|---|---|"]
    for crop_name, m in metrics.items():
        if "skipped" in m:
            lines.append(f"| {crop_name} | skipped: {m['skipped']} | | | | | | |")
            continue
        lines.append(f"| {crop_name} | {m['rows']} | {m['regions']} | {len(m['years'])} | "
                     f"{m['model']['rmse']:.3f} | {m['model']['r2']:.3f} | "
                     f"{m['baseline']['rmse']:.3f} | {m['baseline']['r2']:.3f} |")
    lines.append("")

    lines += ["## Scatter: observed vs leave-one-year-out prediction", ""]
    for crop_name, g in oof.groupby("crop"):
        fig, ax = plt.subplots(figsize=(4, 4))
        ax.scatter(g.yield_t_ha, g.pred, s=12, alpha=0.7)
        lo = min(g.yield_t_ha.min(), g.pred.min())
        hi = max(g.yield_t_ha.max(), g.pred.max())
        ax.plot([lo, hi], [lo, hi], "k--", lw=0.8)
        ax.set(xlabel="observed yield (t/ha)", ylabel="predicted (t/ha)", title=crop_name)
        fig.tight_layout()
        fig.savefig(FIGURES / f"yield_{crop_name}.png", dpi=130)
        plt.close(fig)
        lines.append(f"![{crop_name}](figures/yield_{crop_name}.png)")
    lines.append("")

    lines += ["## Unmatched NUTS codes and crops", "",
              f"NDVI feature rows without a Eurostat yield: {unmatched['ndvi_rows_without_yield']} "
              f"(regions: {', '.join(unmatched['ndvi_regions_without_yield']) or 'none'})",
              "",
              f"Eurostat yield rows without NDVI features: {unmatched['yield_rows_without_ndvi']} "
              f"(regions: {', '.join(unmatched['yield_regions_without_ndvi']) or 'none'})",
              "",
              f"Crops with no training rows: {', '.join(unmatched['crops_without_training_rows']) or 'none'}",
              "",
              f"Countries with no training rows: "
              f"{', '.join(unmatched['countries_without_training_rows']) or 'none'}",
              "",
              "Notes: wheat = C1110 (common wheat and spelt; C1100 has no NUTS2 production/area); dry_pulses = P0000 "
              "(dry pulses and protein crops for grain). apro_cpshr publishes yield only at "
              "country level; NUTS2 yield here is harvested production / area from the same table, "
              "which reproduces the published country yield. RS regions are present where Eurostat "
              "reports them.",
              "",
              "Prediction-time region means (yield, ndvi_peak, ndvi_sum) from the final fit are saved "
              "next to each model in `models/yield_<crop>_region_means.json`; regions with fewer than "
              f"{MIN_REGION_YEARS} training years use the unweighted mean of the crop's region means "
              "(also saved as `fallback`). Prediction = region mean yield + "
              "model.predict(features - region means)."]
    (YIELD / "report.md").write_text("\n".join(lines) + "\n")
    print(f"report: {YIELD / 'report.md'}")


# ---------------------------------------------------------------- self-check

def self_check():
    _, _, classes = _months()
    assert set(SEASON_MONTHS) == set(CROP_CODES) <= set(classes)
    payload = {"size": [1, 2, 2, 2, 1], "id": ["freq", "crops", "strucpro", "geo", "time"],
               "dimension": {
                   "freq": {"category": {"index": {"A": 0}}},
                   "crops": {"category": {"index": {"C1110": 0, "P0000": 1}}},
                   "strucpro": {"category": {"index": {"HPRD_HUMD_EU_THS_T": 0, "AR_THS_HA": 1}}},
                   "geo": {"category": {"index": {"RO11": 0, "RO": 1}}},
                   "time": {"category": {"index": {"2023": 0}}}},
               "value": {"0": 10.0, "2": 5.0}}  # RO11 wheat production, then area
    assert _decode(payload) == [("RO11", 2023, "wheat", "HPRD_HUMD_EU_THS_T", 10.0),
                                ("RO11", 2023, "wheat", "AR_THS_HA", 5.0)]

    frame = pd.DataFrame({
        "nuts2": ["A", "A", "A", "B", "B", "C"],
        TARGET: [10.0, 11.0, 12.0, 20.0, 22.0, 30.0],
        "ndvi_peak": [0.5, 0.6, 0.7, 0.8, 0.9, 0.4],
        "ndvi_sum": [2.0, 2.2, 2.4, 3.0, 3.2, 1.5],
    })
    means, fallback, counts = _region_means(frame)
    assert counts.to_dict() == {"A": 3, "B": 2, "C": 1}
    assert np.isclose(means.loc["A", TARGET], 11.0)          # 3 years: own mean
    assert np.isclose(means.loc["B", TARGET], fallback[TARGET])  # 2 years: crop fallback
    assert np.isclose(means.loc["C", TARGET], fallback[TARGET])  # 1 year: crop fallback
    assert np.isclose(fallback[TARGET], np.mean([11.0, 21.0, 30.0]))
    X, y_anom, rows = _anomaly_xy(frame, means, fallback)
    assert np.allclose(y_anom, frame[TARGET].to_numpy() - rows[TARGET].to_numpy())
    assert np.allclose(X[:, 0], frame["ndvi_peak"].to_numpy() - rows["ndvi_peak"].to_numpy())
    missing = frame.iloc[[0]].assign(nuts2="Z")
    _, _, missing_rows = _anomaly_xy(missing, means, fallback)
    assert np.isclose(missing_rows[TARGET].iloc[0], fallback[TARGET])
    print("self-check ok")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Yield regressors from Eurostat + NDVI")
    parser.add_argument("step", choices=("download", "features", "train", "report", "all"))
    args = parser.parse_args(argv)
    steps = {"download": download, "features": features, "train": train, "report": report}
    for name in (steps if args.step == "all" else (args.step,)):
        steps[name]()


if __name__ == "__main__":
    main()
