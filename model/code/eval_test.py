"""Final evaluation on the test split, once.

Same protocol as validation: cutoff 2021-09, 36-month autoregressive rollout on the
model's own predictions, observed weather and crops, physical units, missing NDVI
months skipped. No baselines, no plots, no retuning.

    venv/bin/python code/eval_test.py runs/monthly_delta
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
import polars as pl
import torch

import eval_rollouts_full as ev

CUTOFF = 59  # 2021-09
H = 36
YEARS = (2022, 2023, 2024)
FEED_CROPS = ("maize", "wheat", "barley", "soybeans", "sunflower", "dry_pulses")
COUNTY = {"RO121": "Alba", "RO113": "Cluj", "RO125": "Mures", "RO126": "Sibiu",
          "RO423": "Hunedoara"}


def metrics(pred, obs):
    ok = np.isfinite(pred) & np.isfinite(obs)
    if not ok.any():
        return {"n": 0, "mae": None, "rmse": None, "r2": None}
    e = pred[ok] - obs[ok]
    o = obs[ok]
    mse = float(np.mean(e ** 2))
    sst = float(np.sum((o - o.mean()) ** 2))
    return {"n": int(ok.sum()), "mae": float(np.mean(np.abs(e))), "rmse": mse ** 0.5,
            "r2": None if sst == 0 else 1 - mse * len(o) / sst}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--device", default="cuda:0")
    args = ap.parse_args()

    model, cfg, epoch, val_loss = ev.load_model(args.run_dir, args.device)
    ckpt = hashlib.sha256((Path(args.run_dir) / "best.pt").read_bytes()).hexdigest()
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True,
                                text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain", "code"],
                                    capture_output=True, text=True).stdout.strip())
    except subprocess.CalledProcessError:
        commit, dirty = None, None

    d = ev.load_data(cfg, next(model.parameters()).device)
    assert d.get("delta"), "this script scores the delta model only"
    split = pl.read_parquet(d["data_path"] / "splits.parquet")
    ids = np.load(d["data_path"] / "point_ids.npy").tolist()
    test = pl.Series(ids).is_in(
        split.filter(pl.col("split") == "test")["point_id"].implode()).to_numpy()
    assert test.sum() > 0, "no test field in the tensors"
    rows = torch.as_tensor(np.flatnonzero(test), device=d["z"].device)
    classes = d["classes"]

    pred = ev.rollout(model, {"d": d, "rows": rows}, CUTOFF, horizon=H).cpu().numpy()
    obs = ev.observed_monthly(d, rows, CUTOFF, H).cpu().numpy()

    nuts = dict(zip(split["point_id"].to_list(), split["nuts3"].to_list()))
    region = np.array([nuts[ids[i]] for i in rows.cpu().numpy()])
    true = d["crop"][rows][:, 5:8, 0].cpu().numpy()

    out = {"run": args.run_dir, "checkpoint_sha256": ckpt, "git_commit": commit,
           "code_dirty": dirty, "epoch": epoch, "val_loss": val_loss,
           "split": "test", "n_fields": int(len(rows)),
           "regions": sorted(set(region.tolist())),
           "per_year": {}, "per_region": {}, "per_crop_ndvi": {}}

    for yi, year in enumerate(YEARS):
        sl = slice(12 * yi, 12 * yi + 12)
        out["per_year"][str(year)] = {
            "ndvi": metrics(pred[:, sl, 0], obs[:, sl, 0]),
            "sm": metrics(pred[:, sl, 1], obs[:, sl, 1])}

    for r in np.unique(region):
        m = region == r
        out["per_region"][str(r)] = {
            "name": COUNTY.get(str(r)), "n_fields": int(m.sum()),
            "ndvi": metrics(pred[m, :, 0], obs[m, :, 0]),
            "sm": metrics(pred[m, :, 1], obs[m, :, 1])}

    for name in FEED_CROPS:
        if name not in classes:
            raise SystemExit(f"crop {name!r} not in {classes}")
        k = classes.index(name)
        p_c, o_c, nf = [], [], 0
        for yi in range(len(YEARS)):
            sl = slice(12 * yi, 12 * yi + 12)
            m = true[:, yi] == k
            p_c.append(pred[m, sl, 0])
            o_c.append(obs[m, sl, 0])
            nf += int(m.sum())
        out["per_crop_ndvi"][name] = {
            "n_field_years": nf,
            **metrics(np.concatenate(p_c), np.concatenate(o_c))}

    (Path(args.run_dir) / "test_metrics.json").write_text(json.dumps(out, indent=2))
    print(f"test fields {len(rows)}  epoch {epoch}  val {val_loss:.5f}")
    print(f"commit {commit} dirty {dirty}  sha256 {ckpt[:16]}...")
    for year, r in out["per_year"].items():
        for t in ("ndvi", "sm"):
            m = r[t]
            print(f"{year} {t:4s} n={m['n']:6d} MAE={m['mae']:.4f} "
                  f"RMSE={m['rmse']:.4f} R2={m['r2']:.3f}")
    for reg, r in out["per_region"].items():
        print(f"{reg} {str(r['name']):9s} n={r['n_fields']:5d} "
              f"ndvi MAE={r['ndvi']['mae']:.4f} R2={r['ndvi']['r2']:.3f}  "
              f"sm MAE={r['sm']['mae']:.4f} R2={r['sm']['r2']:.3f}")
    for c, r in out["per_crop_ndvi"].items():
        print(f"{c:11s} fields={r['n_field_years']:6d} MAE={r['mae']:.4f} "
              f"RMSE={r['rmse']:.4f} R2={r['r2']:.3f}")
    print(f"wrote {Path(args.run_dir) / 'test_metrics.json'}")


if __name__ == "__main__":
    main()
