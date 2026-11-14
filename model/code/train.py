"""Train the monthly field-dynamics LSTM.

    venv/bin/python code/train.py [--config configs/monthly.yaml] [--set key=value ...]

Reads the processed tensors, trains on the train split, validates on val, keeps the best
checkpoint in runs/<run_name>/best.pt and logs one MLflow run.
"""
import argparse
import json
import os
import random
import subprocess
import time
from pathlib import Path

os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")  # MLflow 3.x gates the file backend
import mlflow
import numpy as np
import polars as pl
import torch
import torch.nn.functional as F
import yaml
from torch import optim
from tqdm import tqdm

from model import MonthlyModel

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "configs" / "monthly.yaml"
T = 95  # inputs are months 0..94, targets 1..95
N_CLASSES = 10


def load_config(path, sets):
    cfg = yaml.safe_load(Path(path).read_text())
    for s in sets:
        key, sep, value = s.partition("=")
        if not sep or key not in cfg:
            raise SystemExit(f"--set needs a known key: {s}")
        cfg[key] = yaml.safe_load(value)
    return cfg


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out.update(flatten(v, prefix + k + "."))
        else:
            out[prefix + k] = "null" if v is None else v
    return out


def git_info():
    def run(*args):
        r = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else "unknown"
    return run("rev-parse", "HEAD"), bool(run("status", "--porcelain"))


def check_standardisation(z, mask, train, cal):
    """The stats were computed on train points; the pooled monthly values must come back 0/1."""
    zt, mt = z[train], mask[train]
    print("standardisation on train (mean / std):")
    print("  month   ndvi mean   ndvi std   sm mean   sm std")
    for m in range(1, 13):
        sel = (cal == m)[None, :]
        row = []
        for ch in range(2):
            v = zt[:, :, ch][(mt[:, :, ch] == 1) & sel]
            mean, std = float(v.mean()), float(v.std())
            assert abs(mean) < 1e-3 and abs(std - 1) < 1e-3, (m, ch, mean, std)
            row += [mean, std]
        print(f"  {m:5d}   {row[0]:9.4f}   {row[1]:8.4f}   {row[2]:7.4f}  {row[3]:7.4f}")


def load_data(cfg, device):
    p = ROOT / cfg["data_dir"]
    meta = json.loads((p / "meta.json").read_text())
    norm = json.loads((p / "norm_stats.json").read_text())
    state = np.load(p / "state.npy")
    mask = np.load(p / "state_mask.npy")
    crop = np.load(p / "crop.npy")
    conf = np.load(p / "confidence.npy")
    static = np.load(p / "static.npy")
    weather = np.load(p / "weather.npy")
    cell_idx = np.load(p / "cell_idx.npy")
    ids = np.load(p / "point_ids.npy").tolist()
    n = len(ids)

    if (p / "splits.parquet").exists():  # absent for a hosted tensor set built without split.py
        split = pl.read_parquet(p / "splits.parquet")
        train = pl.Series(ids).is_in(split.filter(pl.col("split") == "train")["point_id"].implode()).to_numpy()
        val = pl.Series(ids).is_in(split.filter(pl.col("split") == "val")["point_id"].implode()).to_numpy()
        assert not (train & val).any()
    else:
        train = val = np.zeros(n, bool)
    for ch in range(2):
        assert (np.isnan(state[:, :, ch]) == (mask[:, :, ch] == 0)).all(), "state NaN != mask 0"
    assert crop.min() >= 0 and crop.max() < N_CLASSES, "crop class outside the embedding table"

    cal = np.array([int(m[5:7]) for m in meta["months"]])  # 1..12; month 0 is October
    year = np.arange(96) // 12                             # crop-year index per month
    nd = norm["ndvi"]
    nd_mean = np.asarray(nd["mean"], np.float32)[crop[:, year, 0], cal - 1]
    nd_std = np.asarray(nd["std"], np.float32)[crop[:, year, 0], cal - 1]
    sm_mean = np.asarray(norm["sm"]["mean"], np.float32)[cal - 1]
    sm_std = np.asarray(norm["sm"]["std"], np.float32)[cal - 1]

    z = np.empty_like(state, np.float32)
    with np.errstate(invalid="ignore"):
        z[:, :, 0] = (state[:, :, 0] - nd_mean) / nd_std
        z[:, :, 1] = (state[:, :, 1] - sm_mean) / sm_std
    del state

    if train.any():  # inference-only tensor sets have no train rows to check
        check_standardisation(z, mask, train, cal)

    # HRL confidence per crop year on train points: the weight of that year's labels
    if train.any():
        med = np.array([np.nanmedian(conf[train, y]) if np.isfinite(conf[train, y]).any()
                        else np.nanmedian(conf[train]) for y in range(8)], np.float32)
        weight = (np.where(np.isnan(conf), med[None, :], conf) / 100.0).astype(np.float32)
    else:
        weight = np.ones_like(conf, np.float32)  # label weight, unused at inference
    del conf

    wmean = np.asarray(norm["weather"]["mean"], np.float32)
    wstd = np.asarray(norm["weather"]["std"], np.float32)
    weather = (weather - wmean) / wstd
    static = (static - np.asarray(norm["static"]["mean"], np.float32)) / np.asarray(
        norm["static"]["std"], np.float32)

    d = {
        "z": torch.as_tensor(z, device=device),
        "mask": torch.as_tensor(mask, device=device),
        "crop": torch.as_tensor(crop, device=device, dtype=torch.long),
        "weight": torch.as_tensor(weight, device=device),
        "static": torch.as_tensor(static, device=device),
        "cell": torch.as_tensor(cell_idx, device=device, dtype=torch.long),
        "weather": torch.as_tensor(weather, device=device),
        "train": torch.as_tensor(np.flatnonzero(train), device=device),
        "val": torch.as_tensor(np.flatnonzero(val), device=device),
        "delta": bool(cfg.get("delta", False)),
    }
    # crop year of each target month (input step t predicts month t+1)
    d["tgt_year"] = torch.arange(1, 96, device=device) // 12
    phase = 2 * np.pi * (cal[1:] - 1) / 12.0
    d["ts"] = torch.as_tensor(np.stack([np.sin(phase), np.cos(phase)], 1).astype(np.float32),
                              device=device)
    print(f"loaded {n} sequences | train {int(train.sum())} | val {int(val.sum())}")
    return d


def make_batch(d, idx, noise):
    obs = d["mask"][idx, :T].float()
    zero = torch.zeros((), device=idx.device)
    state = torch.where(obs.bool(), d["z"][idx, :T], zero)
    if noise:
        state = state + torch.randn_like(state) * noise * obs  # keep missing entries at 0
    tmask = d["mask"][idx, 1:96].bool()
    if d.get("delta"):
        tmask = tmask & d["mask"][idx, :T].bool()  # a delta needs both months observed
        target = torch.where(tmask, d["z"][idx, 1:96] - d["z"][idx, :T], zero)
    else:
        target = torch.where(tmask, d["z"][idx, 1:96], zero)
    return (state, obs,
            d["weather"][d["cell"][idx]][:, 1:96],
            d["ts"].unsqueeze(0).expand(len(idx), -1, -1),
            d["crop"][idx][:, d["tgt_year"]],
            d["static"][idx],
            target,
            tmask.float(),
            d["weight"][idx][:, d["tgt_year"]])


def weighted_huber(pred, target, tmask, weight, beta):
    loss = F.smooth_l1_loss(pred, target, beta=beta, reduction="none")
    w = weight[:, :, None] * tmask
    return (loss * w).sum() / w.sum().clamp_min(1.0)


def train_epoch(model, opt, d, rows, cfg):
    model.train()
    perm = torch.randperm(len(rows), device=rows.device)
    bs = cfg["batch_size"]
    total, seen = 0.0, 0
    bar = tqdm(range(0, len(rows), bs), leave=False, desc="batches")
    for s in bar:
        idx = rows[perm[s:s + bs]]
        parts = make_batch(d, idx, cfg["noise_sigma"])
        loss = weighted_huber(model(*parts[:6]), parts[6], parts[7], parts[8], cfg["huber_beta"])
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        total += float(loss) * len(idx)
        seen += len(idx)
        bar.set_postfix(loss=f"{total / seen:.4f}")
    return total / seen


@torch.no_grad()
def evaluate(model, d, rows, cfg):
    model.eval()
    bs = cfg["batch_size"]
    total, seen = 0.0, 0
    for s in range(0, len(rows), bs):
        idx = rows[s:s + bs]
        parts = make_batch(d, idx, 0.0)
        loss = weighted_huber(model(*parts[:6]), parts[6], parts[7], parts[8], cfg["huber_beta"])
        total += float(loss) * len(idx)
        seen += len(idx)
    return total / seen


def main(argv=None):
    ap = argparse.ArgumentParser(prog="train.py", description="monthly field-dynamics LSTM")
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE")
    args = ap.parse_args(argv)
    cfg = load_config(args.config, args.set)

    device = torch.device(cfg["device"])
    assert device.type != "cuda" or torch.cuda.is_available(), "CUDA is not available"
    random.seed(cfg["seed"])
    np.random.seed(cfg["seed"])
    torch.manual_seed(cfg["seed"])
    torch.cuda.manual_seed_all(cfg["seed"])

    d = load_data(cfg, device)
    overfit = int(cfg["overfit"]) if cfg["overfit"] else 0
    model = MonthlyModel(hidden=cfg["hidden"], emb_dim=cfg["emb_dim"],
                         dropout=0.0 if overfit else cfg["dropout"]).to(device)
    opt = optim.Adam(model.parameters(), lr=cfg["lr"], weight_decay=cfg["weight_decay"])
    epochs = int(cfg["epochs"])
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(epochs, 1))

    rows = d["train"]
    if overfit:
        gen = torch.Generator().manual_seed(cfg["seed"])
        rows = rows[torch.randperm(len(rows), generator=gen)[:overfit].to(device)]
        cfg["noise_sigma"] = cfg["dropout"] = 0.0

    parts = make_batch(d, rows[:2], 0.0)
    with torch.no_grad():
        out = model(*parts[:6])
    assert out.shape == (len(parts[0]), T, 2) and torch.isfinite(out).all(), "forward smoke check failed"
    print(f"device {device} | batches/epoch {len(rows) // cfg['batch_size'] + 1} | "
          f"overfit {len(rows) if overfit else 0}")

    run_dir = ROOT / cfg["run_dir"] / cfg["run_name"]
    run_dir.mkdir(parents=True, exist_ok=True)
    best_path = run_dir / "best.pt"
    mlflow.set_tracking_uri("file://" + str((ROOT / cfg["mlflow_uri"]).resolve()))
    mlflow.set_experiment(cfg["experiment"])
    sha, dirty = git_info()

    best, bad, best_epoch = float("inf"), 0, 0
    with mlflow.start_run(run_name=cfg["run_name"]):
        mlflow.log_params(flatten(cfg))
        mlflow.set_tags({"git_commit": sha, "git_dirty": str(dirty)})
        for epoch in tqdm(range(1, epochs + 1), desc="epoch"):
            t0 = time.time()
            train_loss = train_epoch(model, opt, d, rows, cfg)
            metrics = {"train_loss": train_loss}
            msg = f"epoch {epoch:3d} | train {train_loss:.5f}"
            if not overfit:
                val_loss = evaluate(model, d, d["val"], cfg)
                metrics["val_loss"] = val_loss
                msg += f" | val {val_loss:.5f}"
                if val_loss < best:
                    best, best_epoch, bad = val_loss, epoch, 0
                    torch.save({"model": model.state_dict(), "config": cfg,
                                "epoch": epoch, "val_loss": val_loss}, best_path)
                else:
                    bad += 1
            mlflow.log_metrics(metrics, step=epoch)
            sched.step()
            tqdm.write(msg + f" | {time.time() - t0:.1f}s")
            if not overfit and bad >= cfg["patience"]:
                tqdm.write(f"early stop at epoch {epoch} (best {best_epoch}: {best:.5f})")
                break

        if overfit:
            final = evaluate(model, d, rows, cfg)
            print(f"overfit final train loss {final:.5f}")
            mlflow.log_metric("final_train_loss", final)
            if not (np.isfinite(final) and final < 0.02):
                raise SystemExit(f"overfit check failed: {final:.5f} >= 0.02")
        else:
            if best_epoch == 0:  # no val improvement ever: keep the last epoch
                torch.save({"model": model.state_dict(), "config": cfg,
                            "epoch": epoch, "val_loss": float("nan")}, best_path)
            mlflow.log_artifact(str(best_path))
            print(f"best epoch {best_epoch} | val {best:.5f} | {best_path}")


if __name__ == "__main__":
    main()
