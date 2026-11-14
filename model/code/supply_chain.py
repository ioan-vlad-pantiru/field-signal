"""Chain the monthly LSTM ensemble into the yield models.

Part 1 rolls the five monthly seeds out from 2021-09 for 36 months on all points and
compares ensemble-NDVI yields with observed-NDVI yields and Eurostat.
Part 2 projects crop year 2025 under every past Oct-Sep weather year 1985-2025.

    venv/bin/python code/supply_chain.py all
    venv/bin/python code/supply_chain.py part1
    venv/bin/python code/supply_chain.py part2

No model is trained here.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import polars as pl
import torch
from xgboost import XGBRegressor

import eval_rollouts_full as ev
import optimizer_candidates as oc
import optimizer_crops as ocrops
import weather_history as wh
from yield_models import _decode

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
YIELD = ROOT / "data" / "yield"
MODELS = ROOT / "models"
SUPPLY = ROOT / "data" / "supply"

ENSEMBLE = ("runs/monthly_lstm", "runs/monthly_s1", "runs/monthly_s2",
            "runs/monthly_s3", "runs/monthly_s4")
CROPS = ("wheat", "barley", "maize", "rapeseed", "sunflower", "soybeans", "dry_pulses")
REGIONAL_NORMAL = {"barley", "dry_pulses"}
# supply view: these crops report the regional normal yield, not a weather-driven model
SUPPLY_NORMAL = {"wheat", "barley", "rapeseed", "dry_pulses"}
SEASON_MONTHS = {
    "wheat": (3, 4, 5, 6),
    "barley": (3, 4, 5, 6),
    "rapeseed": (3, 4, 5, 6),
    "maize": (5, 6, 7, 8, 9),
    "sunflower": (5, 6, 7, 8, 9),
    "soybeans": (5, 6, 7, 8, 9),
    "dry_pulses": (4, 5, 6, 7),
}
# calendar month -> offset in a crop year that starts in October
SEASON_IDX = {c: tuple((m - 10) % 12 for m in ms) for c, ms in SEASON_MONTHS.items()}
# origin/bogdan/optimizer planner crop table (is_valid enforces max(2, min_return)), plus
# the task's crops that table omits: soybeans 3, rapeseed 4, dry_pulses 4 (= pea).
MIN_RETURN = {c: v.min_return_years for c, v in ocrops.CROPS.items()}
MIN_RETURN.update({"soybeans": 3, "rapeseed": 4, "dry_pulses": 4})
PAST_YEARS = list(range(1985, 2026))
CUTOFF = 59                 # 2021-09
HORIZON = 36                # 2022-2024
FUTURE_YEAR = 2025
MAX_POINTS = 300
MIN_POINTS = 30
SEED = 2025


def _scores(y, pred):
    y, pred = np.asarray(y, float), np.asarray(pred, float)
    rmse = float(np.sqrt(np.mean((pred - y) ** 2)))
    r2 = float(1 - np.sum((pred - y) ** 2) / np.sum((y - y.mean()) ** 2))
    return rmse, r2


def load_yield_models():
    models, means = {}, {}
    for crop in CROPS:
        model = XGBRegressor()
        model.load_model(MODELS / f"yield_{crop}.json")
        models[crop] = model
        means[crop] = json.loads((MODELS / f"yield_{crop}_region_means.json").read_text())
    return models, means


def fit_yield_models_2017_2021():
    """Same anomaly fit as yield_models.train, but on 2017-2021 only, in memory.

    The saved models stay as they are: the supply table uses them.
    """
    from yield_models import (FEATURES, MIN_REGION_YEARS, TARGET, XGB_PARAMS,
                              _anomaly_xy, _region_means)
    df = pd.read_parquet(YIELD / "training_table.parquet")
    df = df[df.harvest_year.between(2017, 2021)]
    models, means = {}, {}
    for crop in CROPS:
        g = df[df.crop == crop]
        regional, fallback, counts = _region_means(g)
        X, y, _ = _anomaly_xy(g, regional, fallback)
        models[crop] = XGBRegressor(**XGB_PARAMS, n_jobs=4).fit(X, y)
        means[crop] = {
            "fallback": {c: float(fallback[c]) for c in (TARGET, *FEATURES)},
            "regions": {str(n): {**{c: float(row[c]) for c in (TARGET, *FEATURES)},
                                 "n_years": int(counts[n]),
                                 "fallback": bool(counts[n] < MIN_REGION_YEARS)}
                        for n, row in regional.iterrows()},
        }
    return models, means


def load_points():
    ids = np.load(PROCESSED / "point_ids.npy", allow_pickle=True)
    kept = pl.read_parquet(PROCESSED / "kept_points.parquet")
    joined = (pl.DataFrame({"point_id": ids, "idx": np.arange(len(ids))})
              .join(kept, on="point_id", how="left"))
    assert joined["nuts3"].null_count() == 0, "point_id without nuts3"
    nuts3 = joined["nuts3"].to_numpy()
    nuts2 = np.array([x[:4] for x in nuts3])
    weight = np.load(PROCESSED / "weight.npy").astype(np.float64)
    assert len(weight) == len(ids) and np.isfinite(weight).all() and (weight > 0).all()
    return ids, nuts3, nuts2, weight


def _region_means_frame(df, spec):
    fallback, regions = spec["fallback"], spec["regions"]
    return pd.DataFrame({
        col: df.nuts2.map({r: v[col] for r, v in regions.items()}).fillna(fallback[col])
        for col in ("yield_t_ha", "ndvi_peak", "ndvi_sum")}, index=df.index)


def predict_yield(df, crop, models, means):
    rm = _region_means_frame(df, means[crop])
    pred = rm["yield_t_ha"].to_numpy(float)
    regional = crop in REGIONAL_NORMAL
    if not regional:
        X = np.column_stack([df["ndvi_peak"].to_numpy(float) - rm["ndvi_peak"].to_numpy(float),
                             df["ndvi_sum"].to_numpy(float) - rm["ndvi_sum"].to_numpy(float)])
        pred = pred + models[crop].predict(X)
    return pred, np.full(len(df), regional)


def _features_from_ndvi(ndvi, mask, labels, classes, mask_required):
    """[B,36] predicted NDVI -> peak/sum per crop year 2022-2024, labelled by point crop."""
    n = ndvi.shape[0]
    feats = np.zeros((n, 3, 2), np.float32)
    valid = np.zeros((n, 3), bool)
    for j in range(3):
        block, mblock = ndvi[:, j * 12:(j + 1) * 12], mask[:, j * 12:(j + 1) * 12]
        for crop in CROPS:
            sel = labels[:, j] == classes.index(crop)
            if not sel.any():
                continue
            season = np.array(SEASON_IDX[crop])
            v, m = block[sel][:, season], mblock[sel][:, season]
            if mask_required:
                ok = m.sum(1) >= 2
                v = np.where(m, v, np.nan)
                peak, total = np.nanmax(v, 1), np.nanmean(v, 1) * len(season)
            else:
                ok = np.isfinite(v).all(1)
                peak, total = v.max(1), v.mean(1) * len(season)
            rows = np.flatnonzero(sel)[ok]
            feats[rows, j, 0], feats[rows, j, 1] = peak[ok], total[ok]
            valid[rows, j] = True
    return feats, valid


def _aggregate(feats, valid, labels, region, weight, years, region_col, classes):
    rows = []
    for j, year in enumerate(years):
        for crop in CROPS:
            if labels.ndim == 2:
                sel = valid[:, j] & (labels[:, j] == classes.index(crop))
            else:
                sel = valid[:, j] & (labels == classes.index(crop))
            if not sel.any():
                continue
            df = pd.DataFrame({"region": region[sel], "peak": feats[sel, j, 0],
                               "sum": feats[sel, j, 1], "w": weight[sel]})
            df["wp"], df["ws"] = df.peak * df.w, df["sum"] * df.w
            g = df.groupby("region").agg(n_points=("w", "size"), sw=("w", "sum"),
                                         wp=("wp", "sum"), ws=("ws", "sum"))
            g = g[g.n_points >= MIN_POINTS]
            if g.empty:
                continue
            rows.append(pd.DataFrame({
                region_col: g.index, "crop": crop, "harvest_year": year,
                "ndvi_peak": g.wp / g.sw, "ndvi_sum": g.ws / g.sw,
                "n_points": g.n_points.astype(int)}))
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def part1(lstm_models, d, classes, nuts2, weight, ymodels, ymeans, device, bs=2048):
    n = d["z"].shape[0]
    rows = torch.arange(n, device=device)
    feats = np.zeros((n, 3, 2), np.float32)
    valid = np.zeros((n, 3), bool)
    for s in range(0, n, bs):
        r = rows[s:s + bs]
        with torch.no_grad():
            preds = [ev.rollout(m, {"d": d, "rows": r}, CUTOFF, horizon=HORIZON)
                     for m in lstm_models]
            ndvi = torch.stack(preds).mean(0)[:, :, 0].cpu().numpy()
        mask = d["mask"][r, 60:96, 0].cpu().numpy().astype(bool)
        labels = d["crop"][r, 5:8, 0].cpu().numpy()
        f, v = _features_from_ndvi(ndvi, mask, labels, classes, mask_required=True)
        feats[s:s + len(r)], valid[s:s + len(r)] = f, v
        print(f"part1 rollout {min(s + bs, n)}/{n}", end="\r")
    print()

    ens = _aggregate(feats, valid, np.stack([d["crop"][:, i, 0].cpu().numpy()
                                             for i in (5, 6, 7)], 1),
                     nuts2, weight, (2022, 2023, 2024), "nuts2", classes)
    yld = pd.read_parquet(YIELD / "yield_table.parquet")
    yld = yld[yld.harvest_year.isin((2022, 2023, 2024)) & yld.crop.isin(CROPS)]
    ens = ens.merge(yld, on=["nuts2", "harvest_year", "crop"], how="inner")

    obs = pd.read_parquet(YIELD / "training_table.parquet")
    obs = obs[obs.harvest_year.isin((2022, 2023, 2024)) & obs.crop.isin(CROPS)][
        ["nuts2", "harvest_year", "crop", "ndvi_peak", "ndvi_sum", "n_points", "yield_t_ha"]]

    for frame in (ens, obs):
        frame["pred"] = np.nan
        frame["regional_normal"] = False
        for crop in CROPS:
            sel = frame.crop == crop
            if sel.any():
                pred, flag = predict_yield(frame.loc[sel], crop, ymodels, ymeans)
                frame.loc[sel, "pred"], frame.loc[sel, "regional_normal"] = pred, flag

    both = ens.merge(obs, on=["nuts2", "harvest_year", "crop"], suffixes=("_ens", "_obs"))
    table = []
    for crop in CROPS:
        g = both[both.crop == crop]
        if g.empty:
            continue
        y = g["yield_t_ha_ens"].to_numpy(float)
        rmse_e, r2_e = _scores(y, g["pred_ens"])
        rmse_o, r2_o = _scores(y, g["pred_obs"])
        table.append({"crop": crop, "n": len(g), "rmse_ensemble": rmse_e,
                      "r2_ensemble": r2_e, "rmse_observed": rmse_o, "r2_observed": r2_o})
        print(f"part1 {crop:11s} n={len(g):3d} ensemble {rmse_e:.3f}/{r2_e:+.3f} "
              f"observed {rmse_o:.3f}/{r2_o:+.3f}")
    SUPPLY.mkdir(parents=True, exist_ok=True)
    both.to_parquet(SUPPLY / "part1_chain_check.parquet", index=False)
    return pd.DataFrame(table), ens, obs


def _crop9(d, rows, target):
    base = d["crop"][rows]
    future = torch.stack([target, base[:, 7, 0], base[:, 6, 0]], 1)
    return torch.cat([base, future[:, None, :]], 1)


def _suffix_check(model, d, rows, crop9, w_fut, device):
    """One batch: prefix+suffix must equal a full 107-month forward pass."""
    with torch.no_grad():
        state = torch.zeros((len(rows), 107, 2), device=device)
        flag = torch.zeros((len(rows), 107, 2), device=device)
        state[:, :96] = torch.where(d["mask"][rows].bool(), d["z"][rows],
                                    torch.zeros((), device=device))
        flag[:, :96] = d["mask"][rows].float()
        w_real = d["weather"][d["cell"][rows]][:, 1:96]
        w_full = torch.cat([w_real, w_fut], 1)
        x_full = ev._embed(model, d, rows, state, flag, w_full, crop9, np.arange(1, 108))
        hs, _ = model.lstm(x_full)
        full = ev.destandardise(d, model.head(model.drop(hs))[:, 95:],
                                np.arange(96, 108), crop9)
        flag_pref = d["mask"][rows][:, :95].float()
        state_pref = torch.where(flag_pref.bool(), d["z"][rows][:, :95],
                                 torch.zeros((), device=device))
        x_pref = ev._embed(model, d, rows, state_pref, flag_pref, w_real, crop9,
                           np.arange(1, 96))
        _, hidden = model.lstm(x_pref)
        state_suf = torch.zeros((len(rows), 12, 2), device=device)
        flag_suf = torch.zeros((len(rows), 12, 2), device=device)
        state_suf[:, 0] = torch.where(d["mask"][rows][:, 95].bool(), d["z"][rows][:, 95],
                                      torch.zeros((), device=device))
        flag_suf[:, 0] = d["mask"][rows][:, 95].float()
        x_suf = ev._embed(model, d, rows, state_suf, flag_suf, w_fut, crop9,
                          np.arange(96, 108))
        hs2, _ = model.lstm(x_suf, hidden)
        suffix = ev.destandardise(d, model.head(model.drop(hs2)),
                                  np.arange(96, 108), crop9)
    diff = float((full - suffix).abs().max())
    assert diff < 1e-5, f"prefix/suffix rollout differs from full pass: {diff}"
    # future months must decode with the target crop's norms, not the 2024 crop's
    cal = torch.as_tensor(ev.cal_of(np.arange(96, 108)) - 1, device=device)
    cal = cal[None, :].expand(len(rows), 12)
    cls = crop9[:, 8, 0][:, None].expand(len(rows), 12)
    dec = ev.destandardise(d, torch.zeros((len(rows), 12, 2), device=device),
                           np.arange(96, 108), crop9)
    assert torch.allclose(dec[:, :, 0], d["nd_mean"][cls, cal]), \
        "future NDVI does not use the target crop's norms"
    return diff


def select_points(d, classes, nuts3):
    hist = d["crop"][:, :, 0].cpu().numpy()
    names = np.asarray(classes)
    rng = np.random.default_rng(SEED)
    idx, target = [], []
    for crop in CROPS:
        k = classes.index(crop)
        # the optimizer branch's own rule: crop may return after max(2, min_return) years
        ok = {h: bool(oc.candidates([crop], 1, MIN_RETURN, list(h)))
              for h in {tuple(r) for r in names[hist]}}
        allowed = np.array([ok[tuple(r)] for r in names[hist]])
        for zone in sorted(np.unique(nuts3)):
            take = np.flatnonzero((nuts3 == zone) & allowed)
            if take.size == 0:
                continue
            take = rng.choice(take, size=min(MAX_POINTS, take.size), replace=False)
            idx.append(take)
            target.append(np.full(take.size, k))
    return np.concatenate(idx), np.concatenate(target)


def weather_years(cell_ids):
    cache = SUPPLY / "weather_1985_2025.npy"
    if cache.exists():
        grid = np.load(cache)
    else:
        grid, _ = wh.monthly_grid(cell_ids, "1984-10", "2025-09", fill_solar=True)
        np.save(cache, grid.astype(np.float32))
    assert grid.shape == (len(cell_ids), len(PAST_YEARS) * 12, len(wh.WEATHER_CHANNELS))
    return wh.standardise(grid).reshape(len(PAST_YEARS), len(cell_ids), 12,
                                        len(wh.WEATHER_CHANNELS))


def scenario_features(lstm_models, d, classes, sel_idx, sel_crop, weather, device, bs=2048):
    n_sel = len(sel_idx)
    idx = torch.as_tensor(sel_idx, device=device, dtype=torch.long)
    target = torch.as_tensor(sel_crop, device=device, dtype=torch.long)
    weather_t = torch.as_tensor(weather, device=device)
    hidden_size = lstm_models[0].lstm.hidden_size
    prefixes = []
    for model in lstm_models:
        h_all = torch.empty((1, n_sel, hidden_size), device=device)
        c_all = torch.empty((1, n_sel, hidden_size), device=device)
        for s in range(0, n_sel, bs):
            r = idx[s:s + bs]
            c9 = _crop9(d, r, target[s:s + bs])
            flag = d["mask"][r][:, :95].float()
            state = torch.where(flag.bool(), d["z"][r][:, :95],
                                torch.zeros((), device=device))
            w = d["weather"][d["cell"][r]][:, 1:96]
            with torch.no_grad():
                x = ev._embed(model, d, r, state, flag, w, c9, np.arange(1, 96))
                _, (h, c) = model.lstm(x)
            h_all[:, s:s + len(r)], c_all[:, s:s + len(r)] = h, c
        prefixes.append((h_all, c_all))
        print(f"part2 prefix {lstm_models.index(model) + 1}/{len(lstm_models)}", end="\r")
    print()

    tgt = np.arange(96, 108)
    feats = np.zeros((n_sel, len(PAST_YEARS), 2), np.float32)
    checked = False
    for yi in range(len(PAST_YEARS)):
        for s in range(0, n_sel, bs):
            r = idx[s:s + bs]
            c9 = _crop9(d, r, target[s:s + bs])
            w_fut = weather_t[yi][d["cell"][r]]
            state = torch.zeros((len(r), 12, 2), device=device)
            flag = torch.zeros((len(r), 12, 2), device=device)
            state[:, 0] = torch.where(d["mask"][r][:, 95].bool(), d["z"][r][:, 95],
                                      torch.zeros((), device=device))
            flag[:, 0] = d["mask"][r][:, 95].float()
            pred = None
            for model, (h_all, c_all) in zip(lstm_models, prefixes):
                if not checked:
                    _suffix_check(model, d, r[:8], c9[:8], w_fut[:8], device)
                    checked = True
                with torch.no_grad():
                    x = ev._embed(model, d, r, state, flag, w_fut, c9, tgt)
                    hs, _ = model.lstm(x, (h_all[:, s:s + len(r)], c_all[:, s:s + len(r)]))
                    phys = ev.destandardise(d, model.head(model.drop(hs)), tgt, c9)
                pred = phys if pred is None else pred + phys
            ndvi = (pred / len(lstm_models))[:, :, 0].cpu().numpy()
            labels = sel_crop[s:s + len(r)]
            for crop in CROPS:
                pick = labels == classes.index(crop)
                if not pick.any():
                    continue
                season = np.array(SEASON_IDX[crop])
                v = ndvi[pick][:, season]
                rows = np.flatnonzero(pick) + s
                feats[rows, yi, 0], feats[rows, yi, 1] = v.max(1), v.mean(1) * len(season)
        print(f"part2 weather {PAST_YEARS[yi]} ({yi + 1}/{len(PAST_YEARS)})", end="\r")
    print()
    assert np.isfinite(feats).all()
    return feats


def part2(lstm_models, d, classes, nuts3, nuts2, weight, ymodels, ymeans, device, bs=2048):
    SUPPLY.mkdir(parents=True, exist_ok=True)
    sel_idx, sel_crop = select_points(d, classes, nuts3)
    print(f"part2 selected {len(sel_idx)} point-crop pairs")
    weather = weather_years(d["cell_ids"])
    feats = scenario_features(lstm_models, d, classes, sel_idx, sel_crop, weather, device, bs)
    labels = np.array([classes[k] for k in sel_crop])
    rows = []
    for yi, year in enumerate(PAST_YEARS):
        df = pd.DataFrame({"nuts3": nuts3[sel_idx], "nuts2": nuts2[sel_idx],
                           "crop": labels, "ndvi_peak": feats[:, yi, 0],
                           "ndvi_sum": feats[:, yi, 1], "w": weight[sel_idx]})
        df["wp"], df["ws"] = df.ndvi_peak * df.w, df.ndvi_sum * df.w
        g = df.groupby(["nuts3", "nuts2", "crop"]).agg(
            n_points=("w", "size"), sw=("w", "sum"), wp=("wp", "sum"), ws=("ws", "sum"))
        g = g.reset_index()
        g["ndvi_peak"], g["ndvi_sum"] = g.wp / g.sw, g.ws / g.sw
        g["weather_year"] = year
        rows.append(g[["nuts3", "nuts2", "crop", "weather_year", "ndvi_peak",
                       "ndvi_sum", "n_points"]])
    out = pd.concat(rows, ignore_index=True)
    out["yield_t_ha"] = np.nan
    out["regional_normal"] = False
    for crop in CROPS:
        sel = out.crop == crop
        if sel.any():
            pred, flag = predict_yield(out.loc[sel], crop, ymodels, ymeans)
            out.loc[sel, "yield_t_ha"], out.loc[sel, "regional_normal"] = pred, flag
    assert out.yield_t_ha.notna().all() and np.isfinite(out.yield_t_ha).all()
    out["n_points"] = out.n_points.astype(int)
    out = out.sort_values(["crop", "weather_year", "nuts3"]).reset_index(drop=True)
    out[["nuts3", "nuts2", "crop", "weather_year", "yield_t_ha", "n_points",
         "regional_normal", "ndvi_peak", "ndvi_sum"]].to_parquet(
        SUPPLY / "scenario_yields.parquet", index=False)
    print(f"part2 wrote {len(out)} rows: {out.nuts3.nunique()} NUTS3, "
          f"{out.crop.nunique()} crops, {out.weather_year.nunique()} weather years")
    print(out.groupby("crop").size().to_string())
    return out


def report(part1_table, part2_table):
    lines = ["# LSTM ensemble -> NDVI -> yield chain", "",
             "## Part 1: chain check, rollout from 2021-09 for 36 months, all points", "",
             "| crop | n | ensemble RMSE | ensemble R2 | observed RMSE | observed R2 | "
             "region-mean RMSE | region-mean R2 |",
             "|---|---|---|---|---|---|---|---|"]
    for r in part1_table.itertuples():
        lines.append(f"| {r.crop} | {r.n} | {r.rmse_ensemble:.3f} | {r.r2_ensemble:+.3f} | "
                     f"{r.rmse_observed:.3f} | {r.r2_observed:+.3f} | "
                     f"{r.rmse_region:.3f} | {r.r2_region:+.3f} |")
    lines += ["", "Part 1 `n` is the intersection of ensemble and observed region-crop-year rows "
              "with a Eurostat yield; both sides use the observed `state_mask` and the same "
              "`<2 observed season months` rule as `yield_models.py`. The ensemble and observed "
              "columns use yield models refit on 2017-2021 only (same settings, in memory; the "
              "saved models are untouched), so 2022-2024 is out of sample. The region-mean "
              "baseline is each NUTS2 region and crop's Eurostat mean yield over 2017-2021 "
              "(crop mean for a missing region).", ""]

    lines += ["## Part 2: future weather scenarios", "",
              f"- rows: {len(part2_table)}",
              f"- NUTS3 zones: {part2_table.nuts3.nunique()}",
              f"- crops: {part2_table.crop.nunique()}",
              f"- weather years: {part2_table.weather_year.nunique()} "
              f"({part2_table.weather_year.min()}-{part2_table.weather_year.max()})",
              f"- point-crop pairs rolled out: {int(part2_table.n_points.sum() / part2_table.weather_year.nunique())}",
              "", "| crop | rows | zones | mean n_points |", "|---|---|---|---|"]
    for crop, g in part2_table.groupby("crop"):
        lines.append(f"| {crop} | {len(g)} | {g.nuts3.nunique()} | "
                     f"{g.groupby('nuts3').n_points.first().mean():.1f} |")
    lines += ["", "## Ambiguities and choices", "",
              "- Ensemble: five monthly seeds (`monthly_lstm` seed 0 plus `monthly_s1..s4`); "
              "the delta ensemble was not used.",
              "- Part 1 uses the observed `state_mask` for 2022-2024 and skips points with fewer "
              "than two observed season months, matching `yield_models.py`; Part 2 has no future "
              "mask and uses all season months.",
              "- Part 1/2 average the five members' monthly NDVI before computing peak and sum.",
              "- Weather years 1985-2025 were built with `weather_history.monthly_grid` "
              "(same channels as `build.py`). Raw POWER has 48 missing `ALLSKY_SFC_SW_DWN` "
              "cell-days in 1987-02, 1990-02 and 1993-02; those were filled with the cell-month "
              "mean before ET0 so all 41 years are retained.",
              "- Crop eligibility uses the `origin/bogdan/optimizer` planner's own "
              "`candidates.candidates`/`is_valid` (last four harvests, a crop returns only after "
              "`max(2, min_return)` years), with intervals from `planner/crops.py`: wheat 2, "
              "barley 2, maize 1 (so 2 via the solver's floor), sunflower 5; soybeans 3, "
              "rapeseed 4 and dry_pulses 4 (= pea) are the task's additions to that table. "
              "A crop is allowed in 2025 when `candidates([crop], 1, ...)` is non-empty.",
              "- Points: up to 300 random points per NUTS3 zone and crop, sampled without "
              "replacement with seed 2025 from the 365,958 processed points.",
              "- Zones use the NUTS2 region means from `models/yield_<crop>_region_means.json`; "
              "a NUTS2 region missing from that file uses the saved crop fallback.",
              "- Barley and dry_pulses use the regional normal yield; `regional_normal=True`. "
              "Their Part 1 ensemble and observed columns are therefore identical.",
              "- Part 2 keeps every zone-crop with at least one allowed point; the number of "
              "zone-crop pairs below 30 points and the minimum are reported from the output.",
              "- The 2025 rollout keeps real state through 2024-09, then predicts 12 months with "
              "the target crop (and 2024/2023 as previous crops) and the past year's weather. "
              "The same 12-month weather block is applied to every zone for a given year.",
              "- NUTS2 yield is Eurostat harvested production / area; wheat is C1110 because "
              "C1100 has no NUTS2 rows.",
              "- No model was retrained."]
    low = part2_table[part2_table.n_points < 30]
    lines.insert(-1, f"- {low.groupby(['nuts3', 'crop']).ngroups} zone-crop pairs have fewer "
                     f"than 30 points (minimum {int(part2_table.n_points.min())}), visible in "
                     "`n_points`.")
    (SUPPLY / "report.md").write_text("\n".join(lines) + "\n")
    print(f"report: {SUPPLY / 'report.md'}")


def _area_table():
    """Mean Eurostat harvested area 2022-2024 per NUTS2 and crop, in ha."""
    raw = json.loads((YIELD / "raw" / "apro_cpshr_yld.json").read_text())
    long = pd.DataFrame(_decode(raw),
                        columns=["nuts2", "harvest_year", "crop", "strucpro", "value"])
    area = long[long.strucpro == "AR_THS_HA"]
    assert area.harvest_year.between(2022, 2024).any(), "no area rows for 2022-2024"
    return (area[area.harvest_year.between(2022, 2024)]
            .groupby(["nuts2", "crop"]).value.mean().mul(1000).rename("region_area_ha"))


def _zone_shares():
    """Each NUTS3 zone's share of its NUTS2 region's weighted points growing the crop in
    2022-2024; a point counts once if the crop appears in any of the three years."""
    crop = np.load(PROCESSED / "crop.npy")
    weight = np.load(PROCESSED / "weight.npy").astype(float)
    ids = np.load(PROCESSED / "point_ids.npy", allow_pickle=True)
    kept = pd.read_parquet(PROCESSED / "kept_points.parquet", columns=["point_id", "nuts3"])
    lut = dict(zip(kept.point_id, kept.nuts3))
    nuts3 = np.array([lut[i] for i in ids])
    meta = json.loads((PROCESSED / "meta.json").read_text())
    years = [meta["crop_years"].index(y) for y in (2022, 2023, 2024)]
    rows = []
    for name in CROPS:
        has = (crop[:, years, 0] == meta["classes"].index(name)).any(1)
        g = (pd.DataFrame({"nuts2": [z[:4] for z in nuts3[has]], "nuts3": nuts3[has],
                           "w": weight[has]})
             .groupby(["nuts2", "nuts3"]).w.sum().reset_index())
        g["share"] = g.w / g.groupby("nuts2").w.transform("sum")
        g["crop"] = name
        rows.append(g[["nuts2", "nuts3", "crop", "share"]])
    return pd.concat(rows, ignore_index=True)


def supply_table():
    """Yield percentiles x area -> production per NUTS3 and crop."""
    sc = pd.read_parquet(SUPPLY / "scenario_yields.parquet")
    _, ymeans = load_yield_models()
    for crop in SUPPLY_NORMAL:  # wheat and rapeseed join the regional-normal set here only
        spec = ymeans[crop]
        sel = sc.crop == crop
        sc.loc[sel, "yield_t_ha"] = (
            sc.loc[sel, "nuts2"]
            .map({r: v["yield_t_ha"] for r, v in spec["regions"].items()})
            .fillna(spec["fallback"]["yield_t_ha"]))
        sc.loc[sel, "regional_normal"] = True
    keys = ["nuts3", "nuts2", "crop"]
    worst = (sc.loc[sc.groupby(keys).yield_t_ha.idxmin(), keys + ["weather_year"]]
             .rename(columns={"weather_year": "worst_weather_year"}))
    out = (sc.groupby(keys)
           .agg(yield_p10=("yield_t_ha", lambda s: s.quantile(0.10)),
                yield_p50=("yield_t_ha", "median"),
                yield_p90=("yield_t_ha", lambda s: s.quantile(0.90)),
                n_points=("n_points", "first"),
                regional_normal_flag=("regional_normal", "first"))
           .reset_index()
           .merge(worst, on=keys, validate="one_to_one")
           .merge(_zone_shares(), on=keys, how="left", validate="one_to_one")
           .merge(_area_table().reset_index(), on=["nuts2", "crop"], how="left",
                  validate="many_to_one"))
    out["share"] = out.share.fillna(0.0)
    out["area_ha"] = (out.region_area_ha * out.share).fillna(0.0)

    # regional-normal crops: p10/p90 and the worst year come from the region's 2000-2024
    # reported Eurostat yields; p50 stays the regional normal from the yield model.
    hist = pd.read_parquet(YIELD / "yield_table.parquet")
    hist = hist[hist.harvest_year.between(2000, 2024)]
    low = (hist.loc[hist.groupby(["nuts2", "crop"]).yield_t_ha.idxmin(),
                    ["nuts2", "crop", "harvest_year"]]
           .rename(columns={"harvest_year": "hist_year"}))
    stats = (hist.groupby(["nuts2", "crop"]).yield_t_ha
             .agg(hist_p10=lambda s: s.quantile(0.10), hist_p90=lambda s: s.quantile(0.90))
             .reset_index().merge(low, on=["nuts2", "crop"], validate="one_to_one"))
    fb_p10 = hist.groupby("crop").yield_t_ha.quantile(0.10)
    fb_p90 = hist.groupby("crop").yield_t_ha.quantile(0.90)
    fb_year = hist.loc[hist.groupby("crop").yield_t_ha.idxmin()].set_index("crop").harvest_year
    out = out.merge(stats, on=["nuts2", "crop"], how="left", validate="many_to_one")
    normal = out.crop.isin(SUPPLY_NORMAL)
    for col, fb in (("hist_p10", fb_p10), ("hist_p90", fb_p90), ("hist_year", fb_year)):
        out.loc[normal, col] = out.loc[normal, col].fillna(out.loc[normal, "crop"].map(fb))
    out.loc[normal, "yield_p10"] = out.loc[normal, "hist_p10"]
    out.loc[normal, "yield_p90"] = out.loc[normal, "hist_p90"]
    out.loc[normal, "worst_weather_year"] = out.loc[normal, "hist_year"]

    for p in ("p10", "p50", "p90"):
        out[f"production_{p}"] = out[f"yield_{p}"] * out.area_ha
    out["low_support"] = out.n_points < MIN_POINTS
    out["confidence"] = np.where(normal, "regional normal, historical range", "model")
    out["worst_weather_year"] = out.worst_weather_year.astype("Int64")
    cols = ["nuts3", "nuts2", "crop", "yield_p10", "yield_p50", "yield_p90", "area_ha",
            "production_p10", "production_p50", "production_p90", "worst_weather_year",
            "confidence", "regional_normal_flag", "n_points", "low_support"]
    out = out[cols].sort_values(["crop", "nuts3"]).reset_index(drop=True)
    out.to_parquet(SUPPLY / "supply_table.parquet", index=False)
    out.to_csv(SUPPLY / "supply_table.csv", index=False)
    return out


def supply_report(table):
    lines = ["# Supply table per NUTS3 zone and crop", "",
             f"- rows: {len(table)}",
             f"- zones: {table.nuts3.nunique()}",
             f"- crops: {table.crop.nunique()}",
             f"- rows with no area: {int((table.area_ha <= 0).sum())}",
             f"- rows with low support (n_points < {MIN_POINTS}): {int(table.low_support.sum())}",
             "", "## 10 largest zones by maize production_p50", "",
             "| nuts3 | area_ha | production_p50 (t) | n_points |", "|---|---|---|---|"]
    maize = table[table.crop == "maize"].nlargest(10, "production_p50")
    for r in maize.itertuples():
        lines.append(f"| {r.nuts3} | {r.area_ha:.0f} | {r.production_p50:.0f} | {r.n_points} |")
    no_area = table[table.area_ha <= 0]
    lines += ["", "## Zones and crops with no area", ""]
    if no_area.empty:
        lines.append("None.")
    else:
        lines += [f"- {r.nuts3} {r.crop} (n_points {r.n_points})"
                  for r in no_area.itertuples()]
    lines += ["", "Area is the 2022-2024 mean Eurostat `AR_THS_HA` for the NUTS2 region times "
              "the zone's share of the region's weighted points growing the crop in 2022-2024. "
              "Production is yield percentile x area; `regional_normal_flag` is true for wheat, "
              "barley, rapeseed and dry_pulses. Their `yield_p50` is the regional normal; "
              "`yield_p10`/`yield_p90` are the 10th/90th percentiles of the region's reported "
              "Eurostat yields over 2000-2024 and `worst_weather_year` is the year of its lowest "
              "reported yield. Maize, sunflower and soybeans keep the weather-driven model."]
    (SUPPLY / "supply_report.md").write_text("\n".join(lines) + "\n")


def report_from_files():
    p1 = pd.read_parquet(SUPPLY / "part1_chain_check.parquet")
    yt = pd.read_parquet(YIELD / "yield_table.parquet")
    hist = yt[yt.harvest_year.between(2017, 2021)]
    means = hist.groupby(["nuts2", "crop"]).yield_t_ha.mean()
    fallback = means.groupby("crop").mean()
    p1["pred_region"] = [means.get((r.nuts2, r.crop), fallback[r.crop])
                         for r in p1.itertuples()]
    p1.to_parquet(SUPPLY / "part1_chain_check.parquet", index=False)
    table = []
    for crop, g in p1.groupby("crop"):
        y = g["yield_t_ha_ens"].to_numpy(float)
        rmse_e, r2_e = _scores(y, g["pred_ens"])
        rmse_o, r2_o = _scores(y, g["pred_obs"])
        rmse_r, r2_r = _scores(y, g["pred_region"])
        table.append({"crop": crop, "n": len(g), "rmse_ensemble": rmse_e,
                      "r2_ensemble": r2_e, "rmse_observed": rmse_o, "r2_observed": r2_o,
                      "rmse_region": rmse_r, "r2_region": r2_r})
    p2 = pd.read_parquet(SUPPLY / "scenario_yields.parquet")
    report(pd.DataFrame(table), p2)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("step", nargs="?", choices=("part1", "part2", "report", "supply", "all"),
                    default="all")
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--bs", type=int, default=2048)
    args = ap.parse_args(argv)
    if args.step == "report":
        report_from_files()
        return
    if args.step == "supply":
        table = supply_table()
        supply_report(table)
        print(f"supply table: {len(table)} rows, {table.nuts3.nunique()} zones, "
              f"{table.crop.nunique()} crops")
        return
    device = torch.device(args.device)
    assert device.type != "cuda" or torch.cuda.is_available(), "CUDA unavailable"

    ymodels, ymeans = load_yield_models()
    lstm_models = []
    cfg = None
    for run_dir in ENSEMBLE:
        model, cfg, _, _ = ev.load_model(run_dir, device)
        assert not cfg.get("delta"), f"{run_dir} is a delta model"
        model.eval()
        lstm_models.append(model)
    d = ev.load_data(cfg, device)
    classes = d["classes"]
    assert all(c in classes for c in CROPS)
    ids, nuts3, nuts2, weight = load_points()
    assert len(ids) == d["z"].shape[0]
    assert np.array_equal(ids, np.load(PROCESSED / "point_ids.npy", allow_pickle=True))
    assert list(d["cell_ids"]) == wh.cells()

    p1 = p2 = None
    if args.step in ("part1", "all"):
        p1_models, p1_means = fit_yield_models_2017_2021()
        p1, _, _ = part1(lstm_models, d, classes, nuts2, weight, p1_models, p1_means,
                         device, args.bs)
    if args.step in ("part2", "all"):
        p2 = part2(lstm_models, d, classes, nuts3, nuts2, weight, ymodels, ymeans,
                   device, args.bs)
    if p1 is not None and p2 is not None:
        SUPPLY.mkdir(parents=True, exist_ok=True)
        report(p1, p2)
        supply_report(supply_table())


if __name__ == "__main__":
    main()
