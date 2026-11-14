"""Train-only normalisation stats -> data/processed/norm_stats.json.

Reads the processed tensors, meta.json and splits.parquet; masked values are ignored.

    venv/bin/python code/norm_stats.py
"""
import json
from pathlib import Path

import numpy as np
import polars as pl

OUT = Path("/home/jovyan/work/crop_rotation/data/processed")
MIN_GROUP = 100


def main():
    meta = json.loads((OUT / "meta.json").read_text())
    point_ids = np.load(OUT / "point_ids.npy")
    splits = pl.read_parquet(OUT / "splits.parquet")
    train_ids = splits.filter(pl.col("split") == "train")["point_id"]
    train = pl.Series(point_ids).is_in(train_ids.implode()).to_numpy()  # np.isin on objects is O(n*m)

    state = np.load(OUT / "state.npy")
    mask = np.load(OUT / "state_mask.npy")
    crop = np.load(OUT / "crop.npy")
    n, t, _ = state.shape
    months = np.array([int(m[5:7]) for m in meta["months"]])
    month_of_cell = np.broadcast_to(months, (n, t))

    # NDVI: class of the crop year the month belongs to (Oct t-1 .. Sep t -> year t)
    cls = crop[:, np.arange(t) // 12, 0]
    ok = (mask[:, :, 0] == 1) & train[:, None]
    vals = state[:, :, 0][ok].astype(np.float64)
    group = cls[ok].astype(np.int64) * 12 + (month_of_cell[ok] - 1)  # one group per class x month
    n_cls, n_g = len(meta["classes"]), len(meta["classes"]) * 12
    cnt = np.bincount(group, minlength=n_g).reshape(-1, 12)
    s1 = np.bincount(group, weights=vals, minlength=n_g).reshape(-1, 12)
    s2 = np.bincount(group, weights=vals * vals, minlength=n_g).reshape(-1, 12)
    with np.errstate(invalid="ignore", divide="ignore"):
        nd_mean = s1 / cnt
        nd_std = np.sqrt(np.maximum(s2 / cnt - nd_mean ** 2, 0))

    # groups with too few values fall back to that calendar month's pooled stats
    mo = month_of_cell[ok].astype(np.int64) - 1
    mc = np.bincount(mo, minlength=12)
    pmean = np.bincount(mo, weights=vals, minlength=12) / mc
    pstd = np.sqrt(np.maximum(np.bincount(mo, weights=vals * vals, minlength=12) / mc - pmean ** 2, 0))
    low = cnt < MIN_GROUP
    nd_mean[low], nd_std[low] = np.broadcast_to(pmean, low.shape)[low], np.broadcast_to(pstd, low.shape)[low]
    fallback = [{"class": meta["classes"][k], "month": int(m + 1), "n": int(cnt[k, m])}
                for k, m in zip(*np.nonzero(low))]

    # soil moisture: pooled per calendar month
    ok_sm = (mask[:, :, 1] == 1) & train[:, None]
    vs, mos = state[:, :, 1][ok_sm], month_of_cell[ok_sm]
    sm_mean = [float(vs[mos == m].mean()) for m in range(1, 13)]
    sm_std = [float(vs[mos == m].std()) for m in range(1, 13)]

    # weather: unique POWER cells of train points, all 96 months
    cell_idx = np.load(OUT / "cell_idx.npy")
    weather = np.load(OUT / "weather.npy")[np.unique(cell_idx[train])]
    # static: per train point
    static = np.load(OUT / "static.npy")[train]

    stats = {
        "n_train_points_in_split": int(len(train_ids)),
        "n_train_points_in_tensors": int(train.sum()),
        "ndvi": {"classes": meta["classes"], "months": list(range(1, 13)),
                 "mean": np.round(nd_mean, 6).tolist(), "std": np.round(nd_std, 6).tolist(),
                 "fallback_groups": fallback},
        "sm": {"months": list(range(1, 13)), "mean": np.round(sm_mean, 6).tolist(),
               "std": np.round(sm_std, 6).tolist()},
        "weather": {"channels": meta["weather_channels"],
                    "mean": np.round(np.nanmean(weather, axis=(0, 1)), 6).tolist(),
                    "std": np.round(np.nanstd(weather, axis=(0, 1)), 6).tolist()},
        "static": {"channels": meta["static_channels"],
                   "mean": np.round(static.mean(0), 6).tolist(),
                   "std": np.round(static.std(0), 6).tolist()},
    }
    (OUT / "norm_stats.json").write_text(json.dumps(stats, indent=2))

    print(f"train points in tensors: {int(train.sum())} of {len(train_ids)} in split; "
          f"NDVI observed {int(vals.size)}")
    print(f"ndvi class x month groups falling back to the month pool (<{MIN_GROUP} obs): "
          f"{len(fallback)}")
    for f in fallback:
        print(f"  {f['class']:11s} month {f['month']:2d}  n={f['n']}")
    print(f"wrote {OUT / 'norm_stats.json'}")


if __name__ == "__main__":
    main()
