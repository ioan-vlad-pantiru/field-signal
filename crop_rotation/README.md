# crop_rotation

Standalone data pipeline for the crop-rotation training set: Romania, Hungary, Bulgaria,
Croatia, Slovakia, eastern Austria (NUTS1 AT1) and Vojvodina (NUTS2 RS12). Labels 2017–2024,
weather 1981→present.

Self-contained: its own scripts, its own venv, its own data tree. It shares nothing with the
rest of this repo except the checkout, and it does not import `farm_data` or `farm_ml`.

**Contract: nothing is invented or imputed.** A failed precondition halts the step and says why.
Anything missing is recorded in `MANIFEST.md`, not filled in.

## Layout

```
code/          # the pipeline (run.py is the CLI)
docs/          # data_inventory.html — every source, what we do to it, and its gotchas
MANIFEST.md    # provenance, row counts, % missing, package versions
params.json    # sampling and analysis parameters actually used
data/interim/  # HRL tiles, points.parquet, crops.parquet, strata_counts.parquet
data/raw/<ds>/ # one parquet part per (dataset, chunk)
```

`data/` is not in git (~43 GB). It lives on the cluster NFS and is shared read-only by
every worktree through a `data` symlink.

## Running

```bash
venv/bin/python code/run.py step1 --region full   # CDSE: HRL crop types + confidence
venv/bin/python code/run.py step2 --region full   # points, purity, stratified sample
venv/bin/python code/run.py step3 --region full   # Earth Engine extraction
venv/bin/python code/run.py step4 --region full   # NASA POWER weather
venv/bin/python code/run.py manifest --region full
venv/bin/python code/verify.py                    # post-run invariants
venv/bin/python code/eda.py                      # docs/eda_report.md (+ data/interim/hls_presence.parquet)
```

Steps 3 and 4 are independent and run concurrently. `GEE_WORKERS=n` sets Earth Engine
concurrency; every step is resumable and skips parts already on disk.

Secrets are read from `/home/jovyan/.crop_secrets/` (`cdse`, `earthdata`, `gee_project`) and
never printed, never committed.

## Decisions worth knowing

- **No filtering at sampling time.** Every point-year is stored with `confidence`, `purity_m250`
  and flags; filters run at analysis. Stressed fields classify at low confidence, so filtering
  early would remove the years the model needs most.
- **No purity threshold.** 90 % 250 m purity retains 2–14 % of point-years; `purity_m250` is
  kept as a *lagged* covariate only (same-year purity is derived from the label raster and
  would leak the target).
- **One point per 250 m MODIS cell**, to stop many points inside one field acting as
  pseudo-replicates.
- **Earth Engine's free tier** hit its noncommercial quota mid-run; extraction resumed in
  restricted mode. Costs nothing, fails by quota.
- `power` and `smap_sm` are keyed by `cell_id` (grid cell), not `point_id` — expanding them to
  points would be ~10¹⁰ rows.
