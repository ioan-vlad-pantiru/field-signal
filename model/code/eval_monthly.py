"""Monthly accuracy of the delta autoregressive model, physical units.

Rolls out 36 months from the 2021-09 cutoff on the validation split, feeding its own
predictions back, then scores each crop year against the observations.

    venv/bin/python code/eval_monthly.py runs/monthly_delta
"""
import argparse
import json
from pathlib import Path

import numpy as np

import eval_rollouts_full as ev

CUTOFF = 59  # 2021-09
H = 36
TARGETS = ("ndvi", "sm")


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
    ap.add_argument("--cutoff", type=int, default=CUTOFF)
    ap.add_argument("--horizon", type=int, default=H)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    model, cfg, epoch, val_loss = ev.load_model(args.run_dir, args.device)
    d = ev.load_data(cfg, next(model.parameters()).device)
    assert d.get("delta"), "eval_monthly scores the delta model only"
    cutoff, horizon = args.cutoff, args.horizon

    rows = d["val"]
    pred = ev.rollout(model, {"d": d, "rows": rows}, cutoff, horizon=horizon).cpu().numpy()
    obs = ev.observed_monthly(d, rows, cutoff, horizon).cpu().numpy()
    assert pred.shape[1] == horizon, pred.shape

    out, table = [], []
    for i, year in enumerate(range(int(d["meta"]["months"][cutoff + 1][:4]) + 1,
                                   int(d["meta"]["months"][cutoff + 1][:4]) + 1 + horizon // 12)):
        sl = slice(12 * i, 12 * i + 12)
        for ch, name in enumerate(TARGETS):
            m = metrics(pred[:, sl, ch], obs[:, sl, ch])
            out.append({"year": year, "target": name, **m})
            table.append(f"{name:5s} {year}  n={m['n']:6d}  MAE={m['mae']:.4f}  "
                         f"RMSE={m['rmse']:.4f}  R2={m['r2']:.3f}")
    print(f"{args.run_dir} epoch {epoch} val {val_loss:.5f}")
    print("\n".join(table))

    path = Path(args.run_dir) / (args.out or "monthly_metrics.json")
    path.write_text(json.dumps({"run": args.run_dir, "cutoff": d["meta"]["months"][cutoff], "months": horizon,
                                "rows": out}, indent=2))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
