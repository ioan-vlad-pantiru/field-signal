"""Rollout evaluation of the monthly world model on the validation split.

    venv/bin/python code/eval_rollouts.py runs/monthly_lstm [--tests 1,2,3,4,5]
    venv/bin/python code/eval_rollouts.py runs/seed0 runs/seed1 ...   # ensemble
    venv/bin/python code/eval_rollouts.py runs/monthly_lstm --weather-blocks blocks.npy

Forecast protocol (simulation mode): observed state and observed flag up to and including
the cutoff month, state 0 and flag 0 after it, then one forward pass for the whole horizon.
Writes rollout_report.json and one PNG per executed test into the first run directory.
"""
import argparse
import json
import warnings
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import polars as pl
import torch
from scipy.stats import ks_2samp

import weather_history
from infer import (
    _embed, _forward, _pad, _rollout_delta, cal_of, destandardise, load_data,
    load_model, observed_monthly, rollout,
)

ROOT = Path(__file__).resolve().parents[1]
SUMMARIES = ["ndvi_peak", "ndvi_integral", "winter_ndvi", "sm_sept"]
CUTOFFS = [35, 47, 59]  # 2019-09, 2020-09, 2021-09
FEED_CROPS = ["maize", "wheat", "barley", "soybeans", "sunflower", "dry_pulses"]


def summaries(monthly):
    """[N, H, 2] monthly (October first, whole crop years) -> [N, Y, 4]."""
    if isinstance(monthly, torch.Tensor):
        monthly = monthly.detach().cpu().numpy()
    n, h, _ = monthly.shape
    assert h % 12 == 0, f"horizon {h} is not a whole number of crop years"
    b = monthly.reshape(n, h // 12, 12, 2)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        peak = np.nanmax(b[:, :, 5:12, 0], axis=2)
        integral = np.nansum(b[:, :, 5:12, 0], axis=2)
        winter = np.nanmean(b[:, :, 0:5, 0], axis=2)
        any_sum = np.isfinite(b[:, :, 5:12, 0]).any(axis=2)
        any_win = np.isfinite(b[:, :, 0:5, 0]).any(axis=2)
    integral[~any_sum] = np.nan
    winter[~any_win] = np.nan
    return np.stack([peak, integral, winter, b[:, :, 11, 1]], axis=2)


# ------------------------------------------------------------------ baselines

def climatology(d, n_cells=245):
    """Observed mean standardised value by channel x cell x crop class x calendar month.

    Accumulated on CPU with bincount: GPU index_add_ atomics reorder sums and make the
    report differ in the last digits between runs.
    """
    tr = d["train"]
    cell = d["cell"][tr].cpu().numpy()
    n_cls = len(d["classes"])
    size = 2 * n_cells * n_cls * 12
    s = np.zeros(size)
    c = np.zeros(size)
    for m in range(96):
        cls = d["crop"][tr, m // 12, 0].cpu().numpy()
        cal = cal_of(m) - 1
        for ch in range(2):
            ok = d["mask"][tr, m, ch].cpu().numpy() > 0
            idx = (ch * n_cells + cell[ok]) * n_cls * 12 + cls[ok] * 12 + cal
            s += np.bincount(idx, weights=d["z"][tr[ok], m, ch].cpu().numpy().astype(np.float64),
                             minlength=size)
            c += np.bincount(idx, minlength=size)

    s4, c4 = s.reshape(2, n_cells, n_cls, 12), c.reshape(2, n_cells, n_cls, 12)
    mean = s4 / np.maximum(c4, 1)
    cm = s4.sum(1) / np.maximum(c4.sum(1), 1)
    mo = s4.sum((1, 2)) / np.maximum(c4.sum((1, 2)), 1)
    g = s.sum() / max(c.sum(), 1)
    empty = c4 == 0
    mean = np.where(empty, cm[:, None], mean)
    mean = np.where(empty, mo[:, None, None], mean)
    mean = np.where(empty, g, mean)
    return torch.from_numpy(mean.astype(np.float32)).to(d["z"].device)


def clim_series(d, rows, cutoff, H, clim):
    tgt = np.arange(cutoff + 1, cutoff + H + 1)
    crop = d["crop"][rows]
    cls = crop[:, torch.as_tensor(tgt // 12, device=rows.device).clamp(max=7), 0]
    cal = torch.as_tensor(cal_of(tgt) - 1, device=rows.device)[None, :].expand_as(cls)
    cell = d["cell"][rows][:, None].expand_as(cls)
    z = torch.stack([clim[0][cell, cls, cal], clim[1][cell, cls, cal]], -1)
    return destandardise(d, z, tgt, crop)


def persistence(d, rows, cutoff):
    """Last observed physical state at or before the cutoff."""
    z = d["z"][rows, : cutoff + 1]
    mask = d["mask"][rows, : cutoff + 1] > 0
    n = len(rows)
    last = torch.full((n,), -1, device=rows.device)
    for t in range(cutoff, -1, -1):
        fill = mask[:, t].all(1) & (last < 0)
        last[fill] = t
    safe = last.clamp_min(0)
    zz = z[torch.arange(n, device=rows.device), safe][:, None]
    vals = destandardise(d, zz, safe.cpu().numpy(), d["crop"][rows])[:, 0]
    return torch.where((last >= 0)[:, None], vals, torch.full_like(vals, float("nan")))


def constant_series(last, H):
    return last[:, None, :].expand(-1, H, -1)


# ------------------------------------------------------------------ skills

def _skill(model_s, base_s, obs_s):
    """Skill vs the baseline plus absolute regression metrics for the model alone."""
    ok = np.isfinite(model_s) & np.isfinite(base_s) & np.isfinite(obs_s)
    if not ok.any():
        return {"n": 0, "skill": None, "mse_model": None, "mse_base": None,
                "rmse": None, "mae": None, "bias": None, "r2": None, "r": None}
    m, o = np.asarray(model_s[ok], np.float64), np.asarray(obs_s[ok], np.float64)
    mm = float(np.mean((m - o) ** 2))
    mb = float(np.mean((np.asarray(base_s[ok], np.float64) - o) ** 2))
    e = m - o
    sst = float(np.sum((o - o.mean()) ** 2))
    sm, so = float(np.std(m)), float(np.std(o))
    return {"n": int(ok.sum()), "skill": None if mb == 0 else 1 - mm / mb,
            "mse_model": mm, "mse_base": mb,
            "rmse": float(np.sqrt(mm)), "mae": float(np.mean(np.abs(e))),
            "bias": float(e.mean()), "r2": None if sst == 0 else 1 - mm * len(o) / sst,
            "r": None if sm == 0 or so == 0 else float(np.mean((m - m.mean()) * (o - o.mean()))
                                                       / (sm * so))}


def _grouped(model_s, base_s, obs_s, labels):
    k = model_s.shape[-1]
    m, b, o = (x.reshape(-1, k) for x in (model_s, base_s, obs_s))
    lab = np.asarray(labels).reshape(-1)
    out = {}
    for g in np.unique(lab):
        if str(g) == "-1":
            continue
        sel = lab == g
        out[str(g)] = {SUMMARIES[i]: _skill(m[sel, i], b[sel, i], o[sel, i]) for i in range(k)}
    return out


def _seq_counts(d, val_rows, year_idx):
    """Count of the 3-year crop sequence ending at year_idx among train points, per val row."""
    def encode(c):
        return (c[:, year_idx - 2, 0].long() * 100
                + c[:, year_idx - 1, 0].long() * 10 + c[:, year_idx, 0].long())
    uniq, cnt = torch.unique(encode(d["crop"][d["train"]]), return_counts=True)
    order = torch.argsort(uniq)
    uniq, cnt = uniq[order], cnt[order]
    va = encode(d["crop"][val_rows])
    pos = torch.searchsorted(uniq, va).clamp(max=len(uniq) - 1)
    return torch.where(uniq[pos] == va, cnt[pos], torch.zeros_like(pos)).cpu().numpy()


# ------------------------------------------------------------------ tests

def test1(d, model):
    rows = d["val"]
    n = len(rows)
    clim = climatology(d)
    splits = pl.read_parquet(d["data_path"] / "splits.parquet")
    ids = np.load(d["data_path"] / "point_ids.npy").tolist()
    cmap = dict(zip(splits["point_id"].to_list(), splits["country"].to_list()))
    country = np.array([cmap[ids[i]] for i in rows.cpu().numpy()])

    per_cutoff, stacked = {}, []
    for cutoff in CUTOFFS:
        H = 95 - cutoff
        mod = summaries(rollout(model, {"d": d, "rows": rows}, cutoff))
        obs = summaries(observed_monthly(d, rows, cutoff, H))
        cl = summaries(clim_series(d, rows, cutoff, H, clim))
        pe = summaries(constant_series(persistence(d, rows, cutoff), H))
        y0 = cutoff // 12 + 1
        years = np.arange(y0, y0 + H // 12)
        cal_years = 2017 + years
        crop_y = d["crop"][rows][:, years, 0].cpu().numpy()
        crop_names = np.array([[d["classes"][c] for c in row] for row in crop_y])
        diffs = mod - obs
        bias = {}
        for name in dict.fromkeys(crop_names.ravel().tolist()):
            sel = crop_names == name
            bias[name] = {"n": int(sel.sum()),
                          **{SUMMARIES[i]: float(np.nanmean(diffs[:, :, i][sel]))
                             for i in range(4)}}
        res = {
            "cutoff_month": d["meta"]["months"][cutoff],
            "forecast_years": cal_years.tolist(),
            "pooled": {SUMMARIES[i]: _skill(mod[:, :, i], cl[:, :, i], obs[:, :, i])
                       for i in range(4)},
            "pooled_persistence": {SUMMARIES[i]: _skill(mod[:, :, i], pe[:, :, i], obs[:, :, i])
                                   for i in range(4)},
            "by_year": _grouped(mod, cl, obs, np.tile(cal_years, (n, 1))),
            "by_crop": _grouped(mod, cl, obs, crop_names),
            "bias_by_crop": bias,
            "by_country": _grouped(mod, cl, obs,
                                   np.repeat(country[:, None], len(years), 1)),
            "by_support_tercile": {},
        }
        for j, y in enumerate(years):
            cnt = _seq_counts(d, rows, int(y))
            if np.unique(cnt).size < 3:
                continue
            edges = np.quantile(cnt, [1 / 3, 2 / 3])
            lab = np.full((n, len(years)), "-1", dtype=object)
            lab[:, j] = np.digitize(cnt, edges).astype(str)
            res["by_support_tercile"][str(int(cal_years[j]))] = {
                "edges": edges.tolist(), "skill": _grouped(mod, cl, obs, lab)}
        per_cutoff[str(cutoff)] = res
        stacked.append((years, mod, cl, obs, n))

    labs = np.concatenate([np.tile(2017 + s[0], (s[4], 1)).ravel() for s in stacked])
    all_mod = np.concatenate([s[1].reshape(-1, 4) for s in stacked])
    all_cl = np.concatenate([s[2].reshape(-1, 4) for s in stacked])
    all_obs = np.concatenate([s[3].reshape(-1, 4) for s in stacked])
    y2022 = np.where(labs == 2022, "2022", "other")
    return {"by_cutoff": per_cutoff,
            "by_forecast_year_pooled": _grouped(all_mod, all_cl, all_obs, labs),
            "year_2022_vs_other": _grouped(all_mod, all_cl, all_obs, y2022),
            "summaries": SUMMARIES}


def test2(d, model, base_monthly):
    rows = d["val"]
    base = summaries(base_monthly)
    obs = summaries(observed_monthly(d, rows, 59, 36))
    classes = d["classes"]
    for c in FEED_CROPS:
        assert c in classes, f"crop class {c!r} not in {classes}"
    true2022 = d["crop"][rows][:, 5, 0].cpu().numpy()

    out = {}
    for name in FEED_CROPS:
        k = classes.index(name)
        crop = d["crop"][rows].clone()
        crop[:, 5, 0] = k          # 2022 crop
        crop[:, 6, 1] = k          # 2023 previous crop
        crop[:, 7, 2] = k          # 2024 two-years-ago crop
        mod = summaries(rollout(model, {"d": d, "rows": rows}, 59, crops=crop))
        res = {}
        for i, s in enumerate(SUMMARIES):
            pred, ref = mod[:, 0, i], obs[true2022 == k, 0, i]
            ok_p, ok_r = np.isfinite(pred), np.isfinite(ref)
            if ok_p.any() and ok_r.sum() > 1:
                ks = ks_2samp(pred[ok_p], ref[ok_r])
                res[s] = {"pred_mean": float(np.nanmean(pred)),
                          "obs_mean": float(np.nanmean(ref)),
                          "mean_diff": float(np.nanmean(pred) - np.nanmean(ref)),
                          "ks": float(ks.statistic), "ks_p": float(ks.pvalue),
                          "n_pred": int(ok_p.sum()), "n_obs": int(ok_r.sum())}
            else:
                res[s] = {"pred_mean": None, "obs_mean": None, "mean_diff": None,
                          "ks": None, "ks_p": None,
                          "n_pred": int(ok_p.sum()), "n_obs": int(ok_r.sum())}
        out[name] = {
            "summary_vs_observed": res,
            "sm_sept_mean": float(np.nanmean(mod[:, 0, 3])),
            "change_2022": dict(zip(SUMMARIES, np.nanmean(np.abs(mod[:, 0] - base[:, 0]), 0).tolist())),
            "change_2023": dict(zip(SUMMARIES, np.nanmean(np.abs(mod[:, 1] - base[:, 1]), 0).tolist())),
        }
    return {"status": "ok", "cutoff": d["meta"]["months"][59],
            "n_val_with_crop_2022": {c: int((true2022 == classes.index(c)).sum())
                                     for c in FEED_CROPS},
            "crops": out}


def test3(d, model, base_monthly):
    rows = d["val"]
    ch = d["meta"]["weather_channels"]
    for name in ("precip", "t2m_max", "t2m_min"):
        assert name in ch, f"weather channel {name!r} not in {ch}"
    ip, it = ch.index("precip"), [ch.index("t2m_max"), ch.index("t2m_min")]
    base = summaries(base_monthly)
    obs = summaries(observed_monthly(d, rows, 59, 36))
    clim = summaries(clim_series(d, rows, 59, 36, climatology(d)))
    w_obs = _pad(d["weather"][d["cell"][rows]][:, 1:], 95)
    mean = torch.tensor(d["norm"]["weather"]["mean"], device=rows.device)
    std = torch.tensor(d["norm"]["weather"]["std"], device=rows.device)
    future = np.arange(95) >= 59          # target months 60..95
    may_aug = np.isin(cal_of(np.arange(1, 96)), [5, 6, 7, 8]) & future
    crops2022 = d["crop"][rows][:, 5, 0].cpu().numpy()

    def monthly_means(m):
        """[N,36,2] -> mean Mar-Sep NDVI and mean Jun-Sep SM per forecast year, [N,3,2]."""
        a = (m.detach().cpu().numpy() if hasattr(m, "detach") else np.asarray(m))\
            .reshape(len(rows), 3, 12, 2)
        return np.stack([np.nanmean(a[:, :, 5:12, 0], 2), np.nanmean(a[:, :, 8:12, 1], 2)], -1)

    base_mm = monthly_means(base_monthly)

    def delta(w):
        m = rollout(model, {"d": d, "rows": rows}, 59, weather=w)
        return summaries(m) - base, monthly_means(m) - base_mm

    variants = {}
    for label, factor in (("precip_x0.7", 0.7), ("precip_x1.3", 1.3)):
        w = w_obs.clone()
        p = w[:, :, ip] * std[ip] + mean[ip]
        p[:, future] *= factor
        w[:, :, ip] = (p - mean[ip]) / std[ip]
        variants[label] = delta(w)
    # +2 C on May-Aug days, with ET0, hot days and frost days recomputed from daily POWER
    cells = d["cell"][rows].cpu().numpy()
    ch_of = {n: ch.index(n) for n in ("t2m_max", "t2m_min", "et0", "hot_days", "frost_days")}
    phys_ch = {"t2m_max": 0, "t2m_min": 1, "et0": 6, "hot_days": 7, "frost_days": 8}
    phys0, _ = weather_history.monthly_grid(d["cell_ids"], "2021-10", "2024-09")
    phys2, _ = weather_history.monthly_grid(d["cell_ids"], "2021-10", "2024-09", dtemp=2.0)
    for name, mi in ch_of.items():
        lib = torch.as_tensor(phys0[cells][:, :, phys_ch[name]], device=rows.device)
        assert float((w_obs[:, 59:, mi] * std[mi] + mean[mi] - lib).abs().max()) < 1e-3, \
            f"rebuilt {name} does not match weather.npy"
    w = w_obs.clone()
    for name, mi in ch_of.items():
        w[:, 59:, mi] = (torch.as_tensor(phys2[cells][:, :, phys_ch[name]], device=rows.device)
                         - mean[mi]) / std[mi]
    variants["temp_plus2_may_aug"] = delta(w)

    out = {}
    for label, (dd, dm) in variants.items():
        per_crop = {}
        for k, c in enumerate(d["classes"]):
            sel = crops2022 == k
            if sel.any():
                per_crop[c] = {"n": int(sel.sum()),
                               **dict(zip(SUMMARIES, np.nanmean(dd[sel, 0], 0).tolist())),
                               "mean_ndvi_mar_sep": float(np.nanmean(dm[sel, 0, 0])),
                               "mean_sm_jun_sep": float(np.nanmean(dm[sel, 0, 1]))}
        feed = [c for c in FEED_CROPS if c in per_crop]
        up = {"ndvi": sum(per_crop[c]["mean_ndvi_mar_sep"] > 0 for c in feed),
              "sm": sum(per_crop[c]["mean_sm_jun_sep"] > 0 for c in feed)}
        out[label] = {
            "mean_delta_2022": dict(zip(SUMMARIES, np.nanmean(dd[:, 0], 0).tolist())),
            "mean_delta_2023": dict(zip(SUMMARIES, np.nanmean(dd[:, 1], 0).tolist())),
            "mean_delta_2024": dict(zip(SUMMARIES, np.nanmean(dd[:, 2], 0).tolist())),
            "mean_ndvi_mar_sep": {str(2022 + i): float(np.nanmean(dm[:, i, 0])) for i in range(3)},
            "mean_sm_jun_sep": {str(2022 + i): float(np.nanmean(dm[:, i, 1])) for i in range(3)},
            "feed_crops_moving_up": up,
            "feed_crops_moving_down": {k: len(feed) - v for k, v in up.items()},
            "per_crop_2022": per_crop,
        }
    return {"status": "ok", "channels_used": {"precip": ip, "temp": it},
            "note": "ET0, hot_days and frost_days are recomputed from perturbed daily POWER; rh2m, ws2m, solar, precip and dry_run_max are unchanged",
            "obs_2022_anomaly": dict(zip(
                SUMMARIES, np.nanmean(obs[:, 0] - clim[:, 0], 0).tolist())),
            "variants": out}


def diagnosis(d, model):
    """Why sunflower, soybeans, dry pulses and BG fail: labels, spread, confident subset."""
    rows = d["val"]
    cutoff, H = 59, 36
    mod = summaries(rollout(model, {"d": d, "rows": rows}, cutoff))
    obs = summaries(observed_monthly(d, rows, cutoff, H))
    cl = summaries(clim_series(d, rows, cutoff, H, climatology(d)))
    conf22 = d["conf"][rows][:, 5].cpu().numpy().astype(float)
    crop22 = d["crop"][rows][:, 5, 0].cpu().numpy()
    splits = pl.read_parquet(d["data_path"] / "splits.parquet")
    ids = np.load(d["data_path"] / "point_ids.npy").tolist()
    cmap = dict(zip(splits["point_id"].to_list(), splits["country"].to_list()))
    country = np.array([cmap[ids[i]] for i in rows.cpu().numpy()])

    om = observed_monthly(d, rows, cutoff, H).cpu().numpy()[:, :12, 0]  # 2022 crop year
    months = cal_of(np.arange(cutoff + 1, cutoff + 13))
    filled = np.where(np.isfinite(om[:, 5:]), om[:, 5:], -np.inf)
    peak_month = months[np.argmax(filled, axis=1) + 5].astype(float)
    peak_month[~np.isfinite(om[:, 5:]).any(axis=1)] = np.nan

    groups = {c: crop22 == d["classes"].index(c)
              for c in ("sunflower", "soybeans", "dry_pulses")}
    groups["BG"] = country == "BG"
    out = {}
    for name, sel in groups.items():
        if not sel.any():
            out[name] = {"n": 0}
            continue
        c = conf22[sel]
        ok = np.isfinite(c)
        share80 = float((c[ok] >= 80).mean()) if ok.any() else None
        hi = sel & (conf22 >= 80)
        res = {
            "n": int(sel.sum()),
            "confidence": {"mean": float(np.nanmean(c)) if ok.any() else None,
                           "median": float(np.nanmedian(c)) if ok.any() else None,
                           "share_null": float((~ok).mean()),
                           "share_ge_80": share80},
            "observed_peak_ndvi_std": float(np.nanstd(obs[sel, 0, 0])),
            "observed_peak_month_median": (int(np.nanmedian(peak_month[sel]))
                                           if np.isfinite(peak_month[sel]).any() else None),
            "observed_peak_month_share": {
                int(m): float(np.nanmean(peak_month[sel] == m))
                for m in sorted(set(peak_month[sel][np.isfinite(peak_month[sel])].astype(int)))},
            "skill_all": {SUMMARIES[i]: _skill(mod[sel, 0, i], cl[sel, 0, i], obs[sel, 0, i])
                          for i in range(4)},
            "n_conf_ge_80": int(hi.sum()),
            "skill_conf_ge_80": ({SUMMARIES[i]: _skill(mod[hi, 0, i], cl[hi, 0, i], obs[hi, 0, i])
                                  for i in range(4)} if hi.any() else None),
        }
        hi_skill = (res["skill_conf_ge_80"]["ndvi_peak"]["skill"]
                    if res["skill_conf_ge_80"] else None)
        if share80 is not None and share80 < 0.5:
            res["reading"] = "data: fewer than half the labels reach confidence 0.8"
        elif hi_skill is not None and hi_skill < 0:
            res["reading"] = "model: skill stays negative on confident labels"
        elif hi_skill is not None:
            res["reading"] = "recovers on confident labels"
        else:
            res["reading"] = "no confident labels to test"
        out[name] = res
    return out


def test4(d, model, blocks_path):
    detail = ("processed arrays cover 2016-10..2024-09 only; raw POWER starts 1981 but "
              "ALLSKY_SFC_SW_DWN starts 1984 and IMERG precipitation starts 2000, so a "
              "consistent 10-channel 1981-2025 block cannot be built from the arrays")
    if not blocks_path:
        return {"status": "blocked", "missing": "--weather-blocks", "detail": detail}
    p = Path(blocks_path)
    if not p.exists():
        return {"status": "blocked", "missing": str(p), "detail": detail}
    blocks = np.load(p)
    assert blocks.ndim == 4 and blocks.shape[1:] == (245, 48, 10), blocks.shape
    sidecar = p.with_suffix(".json")
    starts = ([int(x) for x in json.loads(sidecar.read_text())["starts"]]
              if sidecar.exists() else [1981 + i for i in range(blocks.shape[0])])
    assert len(starts) == blocks.shape[0], "block sidecar does not match the array"

    rows = d["val"]
    n = len(rows)
    cells = d["cell"][rows]
    w_obs = _pad(d["weather"][cells][:, 1:], 107)

    # training percentiles per calendar month, both channels, physical units
    sub = d["train"][::10]
    vals = destandardise(d, d["z"][sub], np.arange(96), d["crop"][sub]).cpu().numpy()
    mcal = np.broadcast_to(cal_of(np.arange(96)), (len(sub), 96)).reshape(-1)
    flat = vals.reshape(-1, 2)
    q = {ch: np.array([np.nanpercentile(flat[mcal == m, ch], [1, 99]) for m in range(1, 13)])
         for ch in range(2)}

    wmean = np.asarray(d["norm"]["weather"]["mean"])
    wstd = np.asarray(d["norm"]["weather"]["std"])
    shares, all_sum, drift, meta, ymeans = [], [], [], [], []
    mcal_f = np.broadcast_to(cal_of(np.arange(60, 108)), (n, 48))
    for b in range(blocks.shape[0]):
        w = w_obs.clone()
        w[:, 59:, :] = torch.as_tensor(blocks[b], device=rows.device)[cells]
        v = rollout(model, {"d": d, "rows": rows}, 59, weather=w, horizon=48).cpu().numpy()
        oob = tot = 0
        for ch in range(2):
            lo = q[ch][:, 0][mcal_f - 1]
            hi = q[ch][:, 1][mcal_f - 1]
            oob += int(((v[:, :, ch] < lo) | (v[:, :, ch] > hi)).sum())
            tot += v[:, :, ch].size
        shares.append(oob / tot)
        mod = summaries(v)
        all_sum.append(mod)
        vm = v.reshape(n, 4, 12, 2)
        ymeans.append(np.stack([np.nanmean(vm[:, :, :, 0], 2),
                                np.nanmean(vm[:, :, :, 1], 2)], -1))
        drift.append(np.nanmean(mod[:, 3] - mod[:, 2], 0))
        meta.append({"block_start": int(starts[b]),
                     "mean_t2m": float((w[:, 59:, 0] * wstd[0] + wmean[0]).mean()),
                     "mean_precip": float((w[:, 59:, 5] * wstd[5] + wmean[5]).mean())})

    all_sum = np.stack(all_sum)              # [B, N, 4 years, 4 summaries]
    spread = np.nanmean(np.nanstd(all_sum, 0), 0)   # [4 years, 4 summaries]
    years = [int(starts[0]) + 2022 - starts[0] + i for i in range(4)]  # 2022..2025
    obs_year_spread = np.nanmean(np.nanstd(summaries(observed_monthly(d, rows, -1, 96)), 0), 0)
    ym = np.stack(ymeans)                     # [B, N, 4 years, 2 channels]
    ym_spread = np.nanmean(np.nanstd(ym, 0), 0)      # [4 years, 2]
    ov = observed_monthly(d, rows, -1, 96).cpu().numpy().reshape(n, 8, 12, 2)
    ov_ym = np.stack([np.nanmean(ov[:, :, :, 0], 2), np.nanmean(ov[:, :, :, 1], 2)], -1)
    ov_spread = np.nanmean(np.nanstd(ov_ym, 0), 0)   # [2]
    ym_drift = np.nanmean(ym[:, :, 3] - ym[:, :, 2], (0, 1))
    return {"status": "ok", "blocks": int(blocks.shape[0]),
            "share_outside_train_1_99": [float(x) for x in shares],
            "block_meta": meta,
            "spread_across_blocks": {
                str(2022 + i): dict(zip(SUMMARIES, spread[i].tolist())) for i in range(4)},
            "observed_interannual_spread": dict(zip(SUMMARIES, obs_year_spread.tolist())),
            "year4_minus_year3_drift": dict(zip(
                SUMMARIES, np.nanmean(drift, 0).tolist())),
            "yearly_mean": {
                "spread_across_blocks": {str(2022 + i): {"ndvi": float(ym_spread[i, 0]),
                                                         "sm": float(ym_spread[i, 1])}
                                         for i in range(4)},
                "observed_interannual_spread": {"ndvi": float(ov_spread[0]),
                                                "sm": float(ov_spread[1])},
                "year4_minus_year3": {"ndvi": float(ym_drift[0]), "sm": float(ym_drift[1])}}}


def test5(d, models):
    if len(models) < 2:
        return {"status": "blocked",
                "missing": "at least two distinct-seed run dirs"}
    rows = d["val"]
    obs = summaries(observed_monthly(d, rows, 59, 36))
    members = np.stack([summaries(rollout(m, {"d": d, "rows": rows}, 59)) for m in models])
    mean, sd = np.nanmean(members, 0), np.nanstd(members, 0)
    lo, hi = np.nanmin(members, 0), np.nanmax(members, 0)
    ok = np.isfinite(obs)
    out = {"members": len(models), "coverage": {}, "spread_error": {}}
    for i, s in enumerate(SUMMARIES):
        sel = ok[:, :, i]
        cover = (obs[:, :, i] >= lo[:, :, i]) & (obs[:, :, i] <= hi[:, :, i]) & sel
        out["coverage"][s] = float(cover.sum() / sel.sum()) if sel.any() else None
        x = sd[:, :, i][sel]
        e = (mean[:, :, i][sel] - obs[:, :, i][sel]) ** 2
        edges = np.quantile(x, np.linspace(0, 1, 6))
        out["spread_error"][s] = [
            {"lo": float(edges[b]), "hi": float(edges[b + 1]),
             "n": int(((x >= edges[b]) & (x <= edges[b + 1])).sum()),
             "rmse": float(np.sqrt(e[(x >= edges[b]) & (x <= edges[b + 1])].mean()))
             if ((x >= edges[b]) & (x <= edges[b + 1])).any() else None}
            for b in range(5)]
    return out


# ------------------------------------------------------------------ figures

def figure_test1(t1, path):
    fig, axes = plt.subplots(2, 2, figsize=(13, 9))
    for ax, key in zip(axes.ravel(), ["by_forecast_year_pooled", "year_2022_vs_other"]):
        groups = t1[key]
        labels = list(groups)
        x = np.arange(len(labels))
        for i, s in enumerate(SUMMARIES):
            ax.bar(x + i * 0.2, [groups[g][s]["skill"] for g in labels], 0.2, label=s)
        ax.set_xticks(x + 0.3)
        ax.set_xticklabels(labels, fontsize=8)
        ax.axhline(0, color="k", lw=0.8)
        ax.set_title(key)
        ax.legend(fontsize=6)
    for ax, key, title in ((axes[1, 0], "by_crop", "cutoff 2021-09: by crop"),
                           (axes[1, 1], "by_year", "cutoff 2021-09: by forecast year")):
        groups = t1["by_cutoff"]["59"][key]
        labels = list(groups)
        x = np.arange(len(labels))
        for i, s in enumerate(SUMMARIES):
            ax.bar(x + i * 0.2, [groups[g][s]["skill"] for g in labels], 0.2, label=s)
        ax.set_xticks(x + 0.3)
        ax.set_xticklabels(labels, rotation=30, ha="right", fontsize=8)
        ax.axhline(0, color="k", lw=0.8)
        ax.set_title(title)
    fig.suptitle("Test 1 - skill vs crop x cell x month climatology (val split)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def figure_test2(t2, path):
    crops = list(t2["crops"])
    x = np.arange(len(crops))
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.5))
    for i, s in enumerate(SUMMARIES):
        axes[0].bar(x + i * 0.2,
                    [t2["crops"][c]["summary_vs_observed"][s]["mean_diff"] for c in crops],
                    0.2, label=s)
    axes[0].set_xticks(x + 0.3)
    axes[0].set_xticklabels(crops, rotation=30, ha="right", fontsize=8)
    axes[0].axhline(0, color="k", lw=0.8)
    axes[0].set_title("predicted - observed, 2022")
    axes[0].legend(fontsize=7)
    axes[1].bar(x, [t2["crops"][c]["sm_sept_mean"] for c in crops])
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(crops, rotation=30, ha="right", fontsize=8)
    axes[1].set_title("September soil moisture after swap")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def figure_test3(t3, path):
    labels = list(t3["variants"])
    x = np.arange(len(labels))
    fig, ax = plt.subplots(figsize=(9, 4.5))
    for i, s in enumerate(SUMMARIES):
        ax.bar(x + i * 0.2, [t3["variants"][v]["mean_delta_2022"][s] for v in labels],
               0.2, label=s)
    ax.set_xticks(x + 0.3)
    ax.set_xticklabels(labels)
    ax.axhline(0, color="k", lw=0.8)
    ax.set_title("Test 3 - 2022 summary change under weather perturbations")
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


# ------------------------------------------------------------------ main

def main(argv=None):
    ap = argparse.ArgumentParser(prog="eval_rollouts.py")
    ap.add_argument("run_dirs", nargs="+")
    ap.add_argument("--tests", default="1,2,3,4,5")
    ap.add_argument("--weather-blocks", default=None)
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--out", default=None)
    args = ap.parse_args(argv)
    tests = {t.strip() for t in args.tests.split(",") if t.strip()}
    assert tests <= {"1", "2", "3", "4", "5"}, tests

    run_dir = Path(args.run_dirs[0])
    model, cfg, epoch, val_loss = load_model(run_dir, args.device)
    device = next(model.parameters()).device
    d = load_data(cfg, device)
    rows = d["val"]

    # checks: an override equal to the observations changes nothing, and months before
    # the cutoff match a fully observed pass
    r = rows[:256]
    w_obs = _pad(d["weather"][d["cell"][r]][:, 1:], 95)
    a = rollout(model, {"d": d, "rows": r}, 59)
    b = rollout(model, {"d": d, "rows": r}, 59, crops=d["crop"][r], weather=w_obs)
    ident = float((a - b).abs().max())
    if d.get("delta"):
        prefix = 0.0  # autoregressive rollout has no simulation-mode prefix to compare
    else:
        o_sim, _, _ = _forward(model, d, r, 59, 95)
        o_obs, _, _ = _forward(model, d, r, 94, 95)
        prefix = float((o_sim[:, :59] - o_obs[:, :59]).abs().max())
    assert ident == 0.0 and prefix == 0.0, f"rollout checks failed: {ident} {prefix}"
    print(f"rollout checks: override identity {ident}, pre-cutoff match {prefix}")

    report = {"run": str(run_dir), "epoch": epoch, "val_loss": val_loss,
              "checks": {"override_identity_max_abs": ident, "pre_cutoff_max_abs": prefix},
              "split": "val", "n_val": int(len(rows))}

    base59 = rollout(model, {"d": d, "rows": rows}, 59) if tests & {"1", "2", "3"} else None
    if "1" in tests:
        report["test1"] = test1(d, model)
        report["diagnosis"] = diagnosis(d, model)
        figure_test1(report["test1"], run_dir / "test1_skill_breakdowns.png")
    if "2" in tests:
        report["test2"] = test2(d, model, base59)
        figure_test2(report["test2"], run_dir / "test2_crop_swap.png")
    if "3" in tests:
        report["test3"] = test3(d, model, base59)
        figure_test3(report["test3"], run_dir / "test3_weather_sensitivity.png")
    if "4" in tests:
        report["test4"] = test4(d, model, args.weather_blocks)
    if "5" in tests:
        models = [model]
        for extra in args.run_dirs[1:]:
            m, c, _, _ = load_model(extra, device)
            assert c["data_dir"] == cfg["data_dir"], "ensemble members use different data"
            models.append(m)
        report["test5"] = test5(d, models)

    out = Path(args.out) if args.out else run_dir / "rollout_report.json"
    out.write_text(json.dumps(report, indent=2, default=float))
    print(f"wrote {out}")
    return report


if __name__ == "__main__":
    main()
