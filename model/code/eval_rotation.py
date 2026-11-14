"""Impose the most common 3-year crop rotation on fields that did not follow it.

Validation split, cutoff 2021-09, 36-month autoregressive rollout with observed weather.
The rotation is the most frequent 2022-2024 crop sequence in the whole dataset. Fields
whose own 2022-2024 sequence differs get it imposed on the forecast-year crop inputs
(previous-crop channels rebuilt from it); their 2020 and 2021 history stays as observed.
Predicted curves are the mean over those fields; observed curves are the mean over
validation fields that really followed the rotation.

    venv/bin/python code/eval_rotation.py runs/monthly_delta
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
CAL = ("Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep")


def curve(x):
    return np.nanmean(x[:, :, 0], axis=0)


def common_rotation(d):
    """Most frequent (2022, 2023, 2024) crop sequence, as class indices."""
    seq = d["crop"][:, 5:8, 0].cpu().numpy()
    u, cnt = np.unique(seq, axis=0, return_counts=True)
    i = int(np.argmax(cnt))
    return u[i].tolist(), float(cnt[i] / len(seq))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--device", default="cuda:0")
    args = ap.parse_args()

    model, cfg, epoch, val_loss = ev.load_model(args.run_dir, args.device)
    d = ev.load_data(cfg, next(model.parameters()).device)
    assert d.get("delta"), "this script scores the delta model only"

    rows, classes = d["val"], d["classes"]
    rot, share = common_rotation(d)
    names = [classes[k] for k in rot]

    seq = d["crop"][rows][:, 5:8, 0].cpu().numpy()
    follows = (seq == np.asarray(rot)).all(1)
    print(f"rotation {' -> '.join(names)} ({share:.1%} of all fields)")
    print(f"val: {int(follows.sum())} follow it, {int((~follows).sum())} get it imposed")

    crop = d["crop"][rows].clone()
    for t, k in enumerate(rot):          # forecast years 2022-2024
        crop[:, 5 + t, 0] = k
        crop[:, 5 + t, 1] = torch_prev(crop, 5 + t, 1, k, rot, t)
        crop[:, 5 + t, 2] = torch_prev(crop, 5 + t, 2, k, rot, t)

    pred = ev.rollout(model, {"d": d, "rows": rows}, CUTOFF, crops=crop,
                      horizon=H).cpu().numpy()
    obs = ev.observed_monthly(d, rows, CUTOFF, H).cpu().numpy()

    out = {}
    fig, axes = plt.subplots(1, 3, figsize=(13, 4), sharey=True)
    for ax, (yi, year) in zip(axes, enumerate(YEARS)):
        sl = slice(12 * yi, 12 * yi + 12)
        nd_p = curve(pred[~follows, sl])
        nd_o = curve(obs[follows, sl])
        out[str(year)] = {
            "n_predicted": int((~follows).sum()), "n_observed": int(follows.sum()),
            "pred_ndvi_curve": nd_p.tolist(), "obs_ndvi_curve": nd_o.tolist(),
            "mae_curve": float(np.nanmean(np.abs(nd_p - nd_o))),
            "peak_month_pred": CAL[int(np.nanargmax(nd_p))],
            "peak_month_obs": CAL[int(np.nanargmax(nd_o))],
        }
        ax.plot(range(12), nd_o, lw=2, label="observed (fields that followed the rotation)")
        ax.plot(range(12), nd_p, lw=2, ls="--", label="predicted (rotation imposed)")
        ax.set_title(f"{year}  MAE {out[str(year)]['mae_curve']:.3f}")
        ax.set_xticks(range(12))
        ax.set_xticklabels(CAL, rotation=45, ha="right")
        ax.set_xlabel(names[yi])
    axes[0].set_ylabel("NDVI")
    axes[0].legend(frameon=False, fontsize=8)

    # one point per month across the whole 36-month rollout
    m_p, m_o = curve(pred[~follows]), curve(obs[follows])
    fig2, ax = plt.subplots(figsize=(11, 4))
    ax.plot(range(H), m_o, lw=2, marker="o", ms=3, label="observed (fields that followed the rotation)")
    ax.plot(range(H), m_p, lw=2, marker="o", ms=3, ls="--", label="predicted (rotation imposed)")
    months = [f"{CAL[i % 12]}\n{2021 + (i + 3) // 12}" if i % 12 == 0 else CAL[i % 12] for i in range(H)]
    ax.set_xticks(range(H))
    ax.set_xticklabels(months, fontsize=7, rotation=45, ha="right")
    for b in range(12, H, 12):
        ax.axvline(b - 0.5, color="0.85", lw=0.8, zorder=0)
    ax.set_ylabel("NDVI")
    ax.legend(frameon=False, fontsize=8)
    ax.set_title(f"Mean NDVI per month, imposed {' -> '.join(names)}, rollout from 2021-09", fontsize=10)
    fig2.tight_layout()
    fig2.savefig(Path(args.run_dir) / "rotation_rollout_monthly.png", dpi=140)
    fig.suptitle(f"Imposed rotation {' -> '.join(names)}, rollout from 2021-09, "
                 f"epoch {epoch}, val {val_loss:.5f}", fontsize=10)
    fig.tight_layout()

    # cell- and soil-matched comparison: same POWER cell (same weather), and cell means of
    # clay, sand, soc, ph, elevation and slope within 0.5 SD of each other
    cell = d["cell"][rows].cpu().numpy()
    static = d["static"][rows].cpu().numpy()
    sd = static.std(0)
    imp, ref = ~follows, follows
    matched, info = {}, []
    for c in np.unique(cell):
        a, b = imp & (cell == c), ref & (cell == c)
        if a.sum() < 20 or b.sum() < 10:
            continue
        dsoil = np.abs(static[a].mean(0) - static[b].mean(0)) / np.where(sd > 0, sd, 1)
        if np.nanmax(dsoil) > 0.5:
            continue
        matched[int(c)] = (a, b)
        info.append((c, int(a.sum()), int(b.sum()), float(np.nanmax(dsoil))))
    m_out = {}
    for yi, year in enumerate(YEARS):
        sl = slice(12 * yi, 12 * yi + 12)
        p_c, o_c = [], []
        for a, b in matched.values():
            p_c.append(np.nanmean(pred[a, sl, 0], 0))
            o_c.append(np.nanmean(obs[b, sl, 0], 0))
        if not p_c:
            m_out[str(year)] = {"n_cells": 0}
            continue
        nd_p, nd_o = np.nanmean(p_c, 0), np.nanmean(o_c, 0)
        m_out[str(year)] = {
            "n_cells": len(matched),
            "n_predicted": int(sum(i[1] for i in info)),
            "n_observed": int(sum(i[2] for i in info)),
            "pred_ndvi_curve": nd_p.tolist(), "obs_ndvi_curve": nd_o.tolist(),
            "mae_curve": float(np.nanmean(np.abs(nd_p - nd_o))),
            "peak_month_pred": CAL[int(np.nanargmax(nd_p))],
            "peak_month_obs": CAL[int(np.nanargmax(nd_o))],
        }
        print(f"matched {year}: cells {len(matched)}  MAE {m_out[str(year)]['mae_curve']:.4f}"
              f"  peak {m_out[str(year)]['peak_month_pred']}/{m_out[str(year)]['peak_month_obs']}"
              f"  fields {m_out[str(year)]['n_predicted']}/{m_out[str(year)]['n_observed']}")

    # matched figures: per-cell means averaged over the matched cells only
    p36 = [np.nanmean(pred[a, :, 0], 0) for a, _ in matched.values()]
    o36 = [np.nanmean(obs[b, :, 0], 0) for _, b in matched.values()]
    mp, mo = np.nanmean(p36, 0), np.nanmean(o36, 0)

    run = Path(args.run_dir)
    fig3, axes3 = plt.subplots(1, 3, figsize=(13, 4), sharey=True)
    for ax, year in zip(axes3, YEARS):
        r = m_out[str(year)]
        if not r.get("n_cells"):
            ax.set_title(f"{year}: no matched cell")
            continue
        ax.plot(range(12), r["obs_ndvi_curve"], lw=2, label="observed (matched fields)")
        ax.plot(range(12), r["pred_ndvi_curve"], lw=2, ls="--", label="predicted (matched fields)")
        ax.set_title(f"{year}  MAE {r['mae_curve']:.3f}  {r['n_cells']} cells")
        ax.set_xticks(range(12))
        ax.set_xticklabels(CAL, rotation=45, ha="right")
        ax.set_xlabel(names[YEARS.index(year)])
    axes3[0].set_ylabel("NDVI")
    axes3[0].legend(frameon=False, fontsize=8)
    fig3.suptitle(f"Matched by POWER cell and soil, imposed {' -> '.join(names)}", fontsize=10)
    fig3.tight_layout()
    fig3.savefig(run / "rotation_rollout_matched.png", dpi=140)

    fig4, ax4 = plt.subplots(figsize=(11, 4))
    ax4.plot(range(H), mo, lw=2, marker="o", ms=3, label="observed (matched fields)")
    ax4.plot(range(H), mp, lw=2, marker="o", ms=3, ls="--", label="predicted (matched fields)")
    ax4.set_xticks(range(H))
    ax4.set_xticklabels(months, fontsize=7, rotation=45, ha="right")
    for b in range(12, H, 12):
        ax4.axvline(b - 0.5, color="0.85", lw=0.8, zorder=0)
    ax4.set_ylabel("NDVI")
    ax4.legend(frameon=False, fontsize=8)
    ax4.set_title(f"Matched mean NDVI per month, imposed {' -> '.join(names)}", fontsize=10)
    fig4.tight_layout()
    fig4.savefig(run / "rotation_rollout_matched_monthly.png", dpi=140)
    # distribution view: no averaging over fields, matched cells only
    imp_m = np.zeros(len(rows), bool)
    ref_m = np.zeros(len(rows), bool)
    for a, b in matched.values():
        imp_m |= a
        ref_m |= b
    Pp, Oo = pred[imp_m, :, 0], obs[ref_m, :, 0]
    qp = np.nanpercentile(Pp, [10, 25, 50, 75, 90], 0)
    qo = np.nanpercentile(Oo, [10, 25, 50, 75, 90], 0)
    spread = {}
    for yi, year in enumerate(YEARS):
        sl = slice(12 * yi, 12 * yi + 12)
        spread[str(year)] = {
            "pred_iqr": float(np.nanmean(qp[3, sl] - qp[1, sl])),
            "obs_iqr": float(np.nanmean(qo[3, sl] - qo[1, sl])),
            "pred_p10_p90": float(np.nanmean(qp[4, sl] - qp[0, sl])),
            "obs_p10_p90": float(np.nanmean(qo[4, sl] - qo[0, sl])),
            "n_predicted": int(imp_m.sum()), "n_observed": int(ref_m.sum()),
        }
        print(f"spread {year}: IQR pred {spread[str(year)]['pred_iqr']:.3f} "
              f"obs {spread[str(year)]['obs_iqr']:.3f} | p10-p90 pred "
              f"{spread[str(year)]['pred_p10_p90']:.3f} obs {spread[str(year)]['obs_p10_p90']:.3f}")

    fig5, ax5 = plt.subplots(figsize=(11, 4.5))
    ax5.fill_between(range(H), qo[0], qo[4], color="C0", alpha=0.12, label="observed p10-p90")
    ax5.fill_between(range(H), qo[1], qo[3], color="C0", alpha=0.25, label="observed IQR")
    ax5.plot(range(H), qo[2], color="C0", lw=2, label="observed median")
    ax5.fill_between(range(H), qp[0], qp[4], color="C1", alpha=0.12, label="predicted p10-p90")
    ax5.fill_between(range(H), qp[1], qp[3], color="C1", alpha=0.25, label="predicted IQR")
    ax5.plot(range(H), qp[2], color="C1", lw=2, ls="--", label="predicted median")
    ax5.set_xticks(range(H))
    ax5.set_xticklabels(months, fontsize=7, rotation=45, ha="right")
    for b in range(12, H, 12):
        ax5.axvline(b - 0.5, color="0.85", lw=0.8, zorder=0)
    ax5.set_ylabel("NDVI")
    ax5.legend(frameon=False, fontsize=7, ncol=2)
    ax5.set_title(f"Matched field distribution per month, imposed {' -> '.join(names)}", fontsize=10)
    fig5.tight_layout()
    fig5.savefig(run / "rotation_rollout_matched_bands.png", dpi=140)

    rng = np.random.default_rng(0)
    fig6, ax6 = plt.subplots(figsize=(11, 4.5))
    for i in rng.choice(len(Pp), size=min(300, len(Pp)), replace=False):
        ax6.plot(range(H), Pp[i], color="C1", lw=0.5, alpha=0.15)
    for i in rng.choice(len(Oo), size=min(300, len(Oo)), replace=False):
        ax6.plot(range(H), Oo[i], color="C0", lw=0.5, alpha=0.25)
    ax6.plot(range(H), qp[2], color="C1", lw=2, ls="--", label="predicted median")
    ax6.plot(range(H), qo[2], color="C0", lw=2, label="observed median")
    ax6.set_xticks(range(H))
    ax6.set_xticklabels(months, fontsize=7, rotation=45, ha="right")
    for b in range(12, H, 12):
        ax6.axvline(b - 0.5, color="0.85", lw=0.8, zorder=0)
    ax6.set_ylabel("NDVI")
    ax6.legend(frameon=False, fontsize=8)
    ax6.set_title("300 randomly drawn predicted and observed field curves", fontsize=10)
    fig6.tight_layout()
    fig6.savefig(run / "rotation_rollout_matched_fields.png", dpi=140)

    run = Path(args.run_dir)
    fig.savefig(run / "rotation_rollout.png", dpi=140)
    (run / "rotation_rollout.json").write_text(json.dumps(
        {"run": args.run_dir, "cutoff": "2021-09", "rotation": names,
         "share_of_all_fields": share, "years": out, "matched": m_out,
         "monthly": {"months": months, "pred_ndvi": m_p.tolist(),
                     "obs_ndvi": m_o.tolist()},
         "matched_monthly": {"pred_ndvi": mp.tolist(), "obs_ndvi": mo.tolist()},
         "matched_spread": spread}, indent=2))
    for year, r in out.items():
        print(f"{year} {CAL[int(np.nanargmax(r['obs_ndvi_curve']))]:>3s} "
              f"MAE {r['mae_curve']:.4f}  peak pred/obs "
              f"{r['peak_month_pred']}/{r['peak_month_obs']}")
    print(f"wrote {run / 'rotation_rollout.json'} and rotation_rollout*.png")


def torch_prev(crop, year, lag, k, rot, t):
    """Previous-crop value for forecast year `year` and lag 1 or 2.

    Inside the rollout window it comes from the rotation; earlier history (year 5, lag 1
    and 2) stays as observed.
    """
    src = t - lag
    return rot[src] if src >= 0 else crop[:, year, lag]


if __name__ == "__main__":
    main()
