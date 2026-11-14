"""Crop swap on the delta autoregressive model, validation split.

Every validation point gets its 2022 crop set to each feed crop in turn (with the 2023
and 2024 previous-crop inputs updated), then a 36-month autoregressive rollout from the
2021-09 cutoff with observed weather. NDVI is de-standardised with the swapped crop's
statistics, since the swap tensor is passed through to the rollout.

The 36-month rollout is one continuous trajectory, so its second and third crop years
are scored as well: 2023 and 2024 come from the model's own predictions, not from a
re-anchored state. 2025 would need weather after 2024-09 and has no observations, so it
is not scored.

    venv/bin/python code/eval_crop_swap.py runs/monthly_delta
"""
import argparse
import json
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

import eval_rollouts_full as ev  # noqa: E402

CUTOFF = 59  # 2021-09
H = 36
YEARS = (2022, 2023, 2024)
FEED_CROPS = ("maize", "wheat", "barley", "soybeans", "sunflower", "dry_pulses")
CAL = ("Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep")


def curve(x):
    """[N, 12, 2] -> mean NDVI and mean SM per month over finite points."""
    return np.nanmean(x[:, :, 0], axis=0), np.nanmean(x[:, :, 1], axis=0)


def plot_year(curves, year, epoch, val_loss, path):
    fig, axes = plt.subplots(2, 3, figsize=(12, 6), sharex=True, sharey=True)
    for ax, name in zip(axes.ravel(), FEED_CROPS):
        nd_p, nd_o, mae = curves[name]
        ax.plot(range(12), nd_o, lw=2, label="observed (fields growing the crop)")
        ax.plot(range(12), nd_p, lw=2, ls="--", label="predicted (swapped)")
        ax.set_title(f"{name}  MAE {mae:.3f}")
        ax.axhline(0, color="0.8", lw=0.5)
    for ax in axes[:, 0]:
        ax.set_ylabel("NDVI")
    for ax in axes[1]:
        ax.set_xticks(range(12))
        ax.set_xticklabels(CAL, rotation=45, ha="right")
    axes[0][0].legend(frameon=False, fontsize=8)
    fig.suptitle(f"Mean {year} NDVI curve, continuous rollout from 2021-09, "
                 f"epoch {epoch}, val {val_loss:.5f}", fontsize=10)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--device", default="cuda:0")
    args = ap.parse_args()

    model, cfg, epoch, val_loss = ev.load_model(args.run_dir, args.device)
    d = ev.load_data(cfg, next(model.parameters()).device)
    assert d.get("delta"), "this script scores the delta model only"

    rows, classes = d["val"], d["classes"]
    for c in FEED_CROPS:
        assert c in classes, f"crop class {c!r} not in {classes}"
    true = d["crop"][rows][:, 5:8, 0].cpu().numpy()  # 2022, 2023, 2024
    obs = ev.observed_monthly(d, rows, CUTOFF, H).cpu().numpy()

    out, per_year = {}, {y: {} for y in YEARS}
    for name in FEED_CROPS:
        k = classes.index(name)
        crop = d["crop"][rows].clone()
        crop[:, 5, 0] = k  # 2022 crop
        crop[:, 6, 1] = k  # 2023 previous crop
        crop[:, 7, 2] = k  # 2024 crop two years back
        pred = ev.rollout(model, {"d": d, "rows": rows}, CUTOFF, crops=crop,
                          horizon=H).cpu().numpy()

        years = {}
        for yi, year in enumerate(YEARS):
            sl = slice(12 * yi, 12 * yi + 12)
            sel = true[:, yi] == k
            nd_p, _ = curve(pred[:, sl])
            nd_o, _ = curve(obs[sel][:, sl])
            nd_ps, _ = curve(pred[sel][:, sl])
            years[year] = {
                "n_observed": int(sel.sum()),
                "pred_ndvi_curve": nd_p.tolist(), "obs_ndvi_curve": nd_o.tolist(),
                "mae_curve": float(np.nanmean(np.abs(nd_p - nd_o))),
                "pred_ndvi_curve_same_fields": nd_ps.tolist(),
                "mae_curve_same_fields": float(np.nanmean(np.abs(nd_ps - nd_o))),
                "peak_month_pred": CAL[int(np.nanargmax(nd_p))],
                "peak_month_obs": CAL[int(np.nanargmax(nd_o))],
                "pred_sm_jun_sep": float(np.nanmean(pred[:, 12 * yi + 8:12 * yi + 12, 1])),
            }
            per_year[year][name] = (nd_p, nd_o, years[year]["mae_curve"])
        out[name] = {"n_swapped": int(len(rows)), **years[2022], "years": years}

    run = Path(args.run_dir)
    for year in YEARS:
        plot_year(per_year[year], year, epoch, val_loss,
                  run / ("crop_swap_delta.png" if year == 2022
                         else f"crop_swap_delta_{year}.png"))

    for year in YEARS:
        print(f"{year}: crop  MAE(all)  MAE(same fields)  peak pred/obs")
        for name in FEED_CROPS:
            r = out[name]["years"][year]
            print(f"  {name:11s} {r['mae_curve']:7.4f} {r['mae_curve_same_fields']:12.4f}"
                  f"   {r['peak_month_pred']}/{r['peak_month_obs']:8s}")
    print("2025: no weather after 2024-09 and no observations; not scored")

    (run / "crop_swap_delta.json").write_text(json.dumps(
        {"run": args.run_dir, "cutoff": "2021-09", "months": H, "years": list(YEARS),
         "crops": out}, indent=2))
    print(f"wrote {run / 'crop_swap_delta.json'} and crop_swap_delta*.png")


if __name__ == "__main__":
    main()
