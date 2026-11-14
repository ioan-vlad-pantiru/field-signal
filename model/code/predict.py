"""Score a frozen run: monthly NDVI and root-zone soil moisture for every point.

    venv/bin/python code/predict.py runs/monthly_delta --cutoff 2021-09 --months 36 \
        --out predictions.parquet

Preprocessing is infer.load_data -> train.load_data, the function training calls, and
code/build.py is the only raw-to-tensor path, so this cannot drift from training.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import polars as pl
import torch

import infer

STAT_KEYS = ("ndvi", "sm", "weather", "static")


def check_norm_drift(run_dir, data_path):
    """Refuse to score with normalisation stats other than the ones the model was trained on."""
    frozen = Path(run_dir) / "norm_stats.json"
    if not frozen.exists():
        return
    live = json.loads((data_path / "norm_stats.json").read_text())
    a = json.loads(frozen.read_text())
    diff = [k for k in STAT_KEYS if a.get(k) != live.get(k)]
    assert not diff, (f"{data_path}/norm_stats.json differs from the frozen {frozen} "
                      f"in {diff}; re-normalising would score a different model")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="predict.py", description="monthly forecasts from a frozen run")
    ap.add_argument("run_dir")
    ap.add_argument("--cutoff", required=True, help="YYYY-MM, e.g. 2021-09")
    ap.add_argument("--months", type=int, default=None, help="months to forecast")
    ap.add_argument("--data-dir", default=None, help="overrides the checkpoint's data_dir")
    ap.add_argument("--points", default=None, help="text file of point_ids to score")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--out", default="predictions.parquet")
    args = ap.parse_args(argv)

    device = torch.device(args.device)
    model, cfg, _, _ = infer.load_model(args.run_dir, device)
    if args.data_dir:
        cfg = {**cfg, "data_dir": args.data_dir}
    data_path = infer.ROOT / cfg["data_dir"]
    check_norm_drift(args.run_dir, data_path)
    d = infer.load_data(cfg, device)

    months = d["meta"]["months"]
    assert args.cutoff in months, f"{args.cutoff} not in the data ({months[0]}..{months[-1]})"
    cutoff = months.index(args.cutoff)
    horizon = args.months or len(months) - 1 - cutoff
    assert horizon > 0, "nothing to forecast: the cutoff is the last month"

    ids = np.load(data_path / "point_ids.npy")
    rows = np.arange(len(ids))
    if args.points:
        keep = set(Path(args.points).read_text().split())
        unknown = keep - set(ids.tolist())
        assert not unknown, f"{len(unknown)} point_ids not in the data, e.g. {sorted(unknown)[:3]}"
        rows = rows[np.isin(ids, sorted(keep))]
    rows_t = torch.as_tensor(rows, device=device)

    pred = infer.rollout(model, {"d": d, "rows": rows_t}, cutoff, horizon=horizon).cpu().numpy()
    label = months[cutoff + 1:cutoff + 1 + horizon]
    pl.DataFrame({
        "point_id": np.repeat(ids[rows], horizon),
        "month": np.tile(label, len(rows)),
        "ndvi": pred[:, :, 0].ravel(),
        "sm_rootzone": pred[:, :, 1].ravel(),
    }).write_parquet(args.out)
    print(f"{len(rows)} points x {horizon} months ({label[0]}..{label[-1]}) -> {args.out}")


if __name__ == "__main__":
    main()
