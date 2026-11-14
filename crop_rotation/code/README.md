# Crop-rotation dataset pipeline

Root: `/home/jovyan/work/crop_rotation`. Contract: `code/schema.py` (frozen).

Outputs:
- `data/raw/<dataset>/part-*.parquet` - long-format source data
- `data/interim/hrl/` - HRL-derived crop layers
- `data/interim/points.parquet` - one row per sample point
- `data/interim/crops.parquet` - point x year crop labels
- `data/interim/strata_counts.parquet` - sampling quotas/shortfall
- `logs/`; secrets at `/home/jovyan/.crop_secrets` (container-local, mode 700;
  the NFS volume squashes UIDs so a private dir cannot live there)

Steps: `venv/bin/python code/run.py {step1|step2|step3|step4|manifest} [--region alba|full] [--pilot]`
- step1 HRL crop layers -> crop labels
- step2 sample points and strata quotas
- step3 GEE embeddings (embedding, eucropmap, modis_ndvi, hls_ndvi)
- step4 weather/static covariates (power, smap_sm, soilgrids, srtm)
- manifest output manifest

| table | columns |
|---|---|
| points.parquet | point_id str, lon/lat float64, country/nuts3/county/cell_id/modal_crop str, holdout bool, inclusion_probability float64 |
| crops.parquet | point_id str, year int16, crop str, confidence uint8?, purity_m250 float32?, flags str |
| strata_counts.parquet | country/crop str, n_eligible/quota/sampled/shortfall int64 |
| data/raw/<dataset>/part-*.parquet | point_id str (cell_id for power/smap_sm), date_or_year str, variable str, value float32 |
