"""Export frozen runs for the API: torch checkpoint -> numpy weights, plus the frozen normalisation.

    venv/bin/python code/export_npz.py runs/monthly_delta [runs/monthly_delta_s1 ...] \
        --out ../services/api/src/api/planner/data/world_model

Writes one `<run_name>.npz` per run (the MonthlyModel state dict as float32 arrays, plus the
config as JSON) and `norm_stats.json` (the first run's; every run must carry the same stats).
The API runs the LSTM in numpy (`api.planner.world_model`), so its image needs no torch; the
parity test there checks it against `infer.rollout` on fixed inputs.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import torch


def main(argv=None):
    ap = argparse.ArgumentParser(prog="export_npz.py")
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    norm = None
    for run in map(Path, args.runs):
        ck = torch.load(run / "best.pt", map_location="cpu", weights_only=False)
        assert ck["config"].get("delta"), f"{run}: only the delta head is served"
        # seed runs share the tensors (and so the stats) of the first run; some carry no copy
        own = run / "norm_stats.json"
        stats = json.loads(own.read_text()) if own.exists() else norm
        if norm is None:
            norm = stats
        assert all(stats[k] == norm[k] for k in ("ndvi", "sm", "weather", "static")), \
            f"{run}: normalisation differs from {args.runs[0]}"
        arrays = {k: v.detach().cpu().numpy().astype(np.float32) for k, v in ck["model"].items()}
        meta = {"run": run.name, "epoch": ck.get("epoch"), "val_loss": ck.get("val_loss"),
                "config": ck["config"]}
        np.savez_compressed(out / f"{run.name}.npz", meta=np.array(json.dumps(meta)), **arrays)
        print(f"{run.name}: epoch {meta['epoch']}, val_loss {meta['val_loss']:.4f}")
    (out / "norm_stats.json").write_text(json.dumps(norm))


if __name__ == "__main__":
    main()
