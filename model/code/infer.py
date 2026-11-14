"""Inference for a frozen run: checkpoint + tensors -> physical monthly forecasts.

The preprocessing here is train.load_data, the same function training calls, so hosting
cannot drift from the training pipeline; code/build.py is the only raw-to-tensor path.
code/predict.py and the eval scripts both go through this module.
"""
import json
from pathlib import Path

import numpy as np
import polars as pl
import torch

import train
from model import MonthlyModel

ROOT = Path(__file__).resolve().parents[1]


def cal_of(idx):
    """Calendar month (1..12) of an absolute month index; index 0 is October."""
    return (np.asarray(idx) % 12 + 9) % 12 + 1


def _pad(x, length, fill=0.0):
    if x.shape[1] >= length:
        return x[:, :length]
    out = x.new_full((x.shape[0], length) + tuple(x.shape[2:]), fill)
    out[:, : x.shape[1]] = x
    return out


# ------------------------------------------------------------------ loading

def load_model(run_dir, device):
    ck = torch.load(Path(run_dir) / "best.pt", map_location=device, weights_only=False)
    cfg = ck["config"]
    model = MonthlyModel(hidden=cfg["hidden"], emb_dim=cfg["emb_dim"],
                         dropout=cfg["dropout"]).to(device)
    model.load_state_dict(ck["model"])
    model.eval()
    return model, cfg, ck.get("epoch"), ck.get("val_loss")


def load_data(cfg, device):
    d = train.load_data(cfg, device)
    p = ROOT / cfg["data_dir"]
    meta = json.loads((p / "meta.json").read_text())
    norm = json.loads((p / "norm_stats.json").read_text())
    d["nd_mean"] = torch.tensor(norm["ndvi"]["mean"], device=device)
    d["nd_std"] = torch.tensor(norm["ndvi"]["std"], device=device)
    d["sm_mean"] = torch.tensor(norm["sm"]["mean"], device=device)
    d["sm_std"] = torch.tensor(norm["sm"]["std"], device=device)
    d["norm"] = norm
    d["meta"] = meta
    d["classes"] = meta["classes"]
    d["data_path"] = p
    d["conf"] = torch.as_tensor(np.load(p / "confidence.npy"), device=device)
    ids = np.load(p / "point_ids.npy")
    pts = pl.read_parquet(ROOT / "data" / "interim" / "points.parquet").select(
        "point_id", "cell_id")
    d["cell_ids"] = sorted(pl.DataFrame({"point_id": ids}).join(
        pts, on="point_id", how="left")["cell_id"].unique().to_list())
    return d


# ------------------------------------------------------------------ inference

def destandardise(d, z, months, crop):
    """Standardised [N,L,2] -> physical, with the crop class of each month's crop year."""
    dev = z.device
    months = np.asarray(months)
    cls = crop[:, torch.as_tensor(months // 12, device=dev).clamp(max=7), 0]
    cal = torch.as_tensor(cal_of(months) - 1, device=dev)[None, :].expand_as(cls)
    nd = z[:, :, 0] * d["nd_std"][cls, cal] + d["nd_mean"][cls, cal]
    sm = z[:, :, 1] * d["sm_std"][cal] + d["sm_mean"][cal]
    return torch.stack([nd, sm], dim=-1)


@torch.no_grad()
def _forward(model, d, rows, cutoff, length, crops=None, weather=None):
    """Standardised prediction for target months 1..length under simulation mode."""
    dev = rows.device
    n = len(rows)
    crop = d["crop"][rows] if crops is None else crops
    assert crop.shape == (n, d["crop"].shape[1], 3), "crops override shape"

    months = torch.arange(length, device=dev)
    keep = (months <= cutoff).float()
    z = _pad(d["z"][rows], length)
    flag = _pad(d["mask"][rows], length).float() * keep[:, None]
    state = torch.where(flag.bool(), z, torch.zeros((), device=dev))

    w = _pad(d["weather"][d["cell"][rows]][:, 1:], length)
    if weather is not None:
        assert weather.shape == (n, length, w.shape[2]), \
            f"weather override {tuple(weather.shape)} != {(n, length, w.shape[2])}"
        w = weather

    tgt = np.arange(1, length + 1)
    ty = torch.as_tensor(tgt // 12, device=dev).clamp(max=crop.shape[1] - 1)
    phase = 2 * np.pi * (cal_of(tgt) - 1) / 12.0
    ts = torch.as_tensor(np.stack([np.sin(phase), np.cos(phase)], 1).astype(np.float32),
                         device=dev).unsqueeze(0).expand(n, -1, -1)
    return model(state, flag, w, ts, crop[:, ty], d["static"][rows]), crop, tgt


def _embed(model, d, rows, state, flag, w, crop, tgt):
    """Model input tensor; mirrors MonthlyModel.forward's concatenation."""
    dev = state.device
    n, t, _ = state.shape
    ty = torch.as_tensor(np.asarray(tgt) // 12, device=dev).clamp(max=crop.shape[1] - 1)
    phase = 2 * np.pi * (cal_of(tgt) - 1) / 12.0
    ts = torch.as_tensor(np.stack([np.sin(phase), np.cos(phase)], 1).astype(np.float32),
                         device=dev)
    return torch.cat([state, flag, w, ts.unsqueeze(0).expand(n, -1, -1),
                      model.emb(crop[:, ty]).flatten(-2),
                      d["static"][rows][:, None, :].expand(n, t, -1)], dim=-1)


@torch.no_grad()
def _rollout_delta(model, batch, cutoff, crops, weather, horizon=None, bs=1024):
    """Delta head: autoregressive from the cutoff, feeding each prediction back in."""
    d, rows = batch["d"], batch["rows"]
    H = horizon if horizon is not None else 95 - cutoff
    length = cutoff + H
    K = cutoff + 1
    out = []
    for s in range(0, len(rows), bs):
        r = rows[s:s + bs]
        n, dev = len(r), r.device
        crop = d["crop"][r] if crops is None else crops[s:s + bs]
        w = _pad(d["weather"][d["cell"][r]][:, 1:], length)
        if weather is not None:
            w = weather[s:s + bs]

        flag = d["mask"][r][:, :K].float()
        state = torch.where(flag.bool(), d["z"][r][:, :K], torch.zeros((), device=dev))
        h, hx = model.lstm(_embed(model, d, r, state, flag, w[:, :K], crop,
                                  np.arange(1, K + 1)))

        maskc = d["mask"][r][:, :K] > 0
        last = torch.full((n, 2), -1, device=dev, dtype=torch.long)
        for t in range(cutoff, -1, -1):
            last = torch.where((maskc[:, t] & (last < 0)), torch.full_like(last, t), last)
        safe = last.clamp_min(0)
        state_prev = torch.gather(d["z"][r][:, :K], 1, safe[:, None, :].expand(n, 1, 2))
        state_prev = torch.where((last >= 0)[:, None, :], state_prev,
                                 torch.zeros_like(state_prev))[:, 0]

        preds = []
        for m in range(cutoff + 1, length + 1):
            x1 = _embed(model, d, r, state_prev[:, None],
                        torch.ones(n, 1, 2, device=dev), w[:, m - 1:m], crop, [m])
            h1, hx = model.lstm(x1, hx)
            state_prev = state_prev + model.head(model.drop(h1))[:, 0]
            preds.append(state_prev)
        out.append(destandardise(d, torch.stack(preds, 1),
                                 np.arange(cutoff + 1, length + 1), crop))
    return torch.cat(out)


@torch.no_grad()
def rollout(model, batch, cutoff, crops=None, weather=None, horizon=None, bs=1024):
    """[N, H, 2] physical monthly states for the H months after the cutoff."""
    d, rows = batch["d"], batch["rows"]
    if d.get("delta"):
        return _rollout_delta(model, batch, cutoff, crops, weather, horizon, bs)
    H = horizon if horizon is not None else 95 - cutoff
    length = cutoff + H
    out = []
    for s in range(0, len(rows), bs):
        r = rows[s:s + bs]
        o, crop, tgt = _forward(
            model, d, r, cutoff, length,
            None if crops is None else crops[s:s + bs],
            None if weather is None else weather[s:s + bs])
        out.append(destandardise(d, o[:, cutoff:], tgt[cutoff:], crop))
    return torch.cat(out)


@torch.no_grad()
def observed_monthly(d, rows, cutoff, H, bs=4096):
    """Physical observed states for the H months after the cutoff (NaN where unobserved)."""
    tgt = np.arange(cutoff + 1, cutoff + H + 1)
    out = []
    for s in range(0, len(rows), bs):
        r = rows[s:s + bs]
        out.append(destandardise(d, d["z"][r][:, cutoff + 1:cutoff + H + 1], tgt, d["crop"][r]))
    return torch.cat(out)
