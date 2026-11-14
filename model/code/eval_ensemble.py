"""Five-member delta ensemble: per-seed validation MAE and range coverage.

    venv/bin/python code/eval_ensemble.py runs/monthly_delta runs/monthly_delta_s1 ...
"""
import argparse
import json
from pathlib import Path

import numpy as np

import eval_rollouts_full as ev

CUTOFF = 59
H = 36
TARGETS = ("ndvi", "sm")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dirs", nargs="+")
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--out", default="ensemble.json")
    args = ap.parse_args()
    assert len(args.run_dirs) >= 2, "an ensemble needs at least two members"

    preds, seeds, maes = [], [], []
    obs = None
    for rd in args.run_dirs:
        model, cfg, epoch, val_loss = ev.load_model(rd, args.device)
        d = ev.load_data(cfg, next(model.parameters()).device)
        assert d.get("delta"), "this script scores the delta model only"
        pred = ev.rollout(model, {"d": d, "rows": d["val"]}, CUTOFF, horizon=H).cpu().numpy()
        if obs is None:
            obs = ev.observed_monthly(d, d["val"], CUTOFF, H).cpu().numpy()
        preds.append(pred)
        seeds.append({"run": rd, "epoch": epoch, "val_loss": val_loss})
        m = {"run": rd}
        for ch, name in enumerate(TARGETS):
            m[name] = {"mae": float(np.nanmean(np.abs(pred[:, :, ch] - obs[:, :, ch])))}
        maes.append(m)

    stack = np.stack(preds)                       # [M, N, H, 2]
    lo, hi = np.nanmin(stack, 0), np.nanmax(stack, 0)
    cover = {}
    for ch, name in enumerate(TARGETS):
        ok = np.isfinite(obs[:, :, ch])
        inside = (obs[:, :, ch] >= lo[:, :, ch]) & (obs[:, :, ch] <= hi[:, :, ch])
        cover[name] = {"overall": float(inside[ok].mean()), "n": int(ok.sum())}
        years = {}
        for i, year in enumerate((2022, 2023, 2024)):
            sl = slice(12 * i, 12 * i + 12)
            years[str(year)] = float(inside[:, sl][ok[:, sl]].mean())
        cover[name]["by_year"] = years
        cover[name]["mean_width"] = float(np.nanmean(hi[:, :, ch] - lo[:, :, ch]))

    out = {"members": seeds, "n_members": len(preds), "ideal_coverage": (len(preds) - 1) / (len(preds) + 1),
           "per_seed_mae": maes, "coverage": cover}
    Path(args.run_dirs[0], args.out).write_text(json.dumps(out, indent=2))
    for m in maes:
        print(f"{m['run']:24s} ndvi MAE {m['ndvi']['mae']:.4f}  sm MAE {m['sm']['mae']:.4f}")
    for name in TARGETS:
        c = cover[name]
        print(f"{name} coverage {c['overall']:.3f} (ideal {out['ideal_coverage']:.3f}) "
              f"width {c['mean_width']:.4f}  years {c['by_year']}")
    print(f"wrote {Path(args.run_dirs[0], args.out)}")


if __name__ == "__main__":
    main()
