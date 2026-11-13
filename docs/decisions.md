# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-11-13 | Monorepo: Next.js web + FastAPI + uv workspace for data/ml | One repo, shared contracts |
| 2026-11-13 | SPACE2FEED Direction A (livestock feed) | Our crops already match; soy protein is the buyer's real need |
| 2026-11-13 | Demo region: Alba around Sântimbru/Aiud | Recommended by the local guide; real sourcing area |
| 2026-11-13 | Roles: Vlad (research, app, pitch), Bogdan (data), Răzvan (ML) | Team call |
| 2026-11-13 | Pydantic models in `services/api/src/api/contracts.py` are the source of truth; JSON Schema + TS generated | One definition, typed end to end |
| 2026-11-13 | API serves `mock=true` data until the pipeline lands | Web work starts at 11:00 without waiting |
| 2026-11-13 | Crop KB in TOML (stdlib `tomllib`) | No extra dependency; readable for the agronomist |
| 2026-11-13 | MODIS MOD13Q1 is the must-have vegetation source; HLS 30 m is stretch | 48 h scope; organiser tip: start small |
| 2026-11-13 | Small, interpretable risk model, leave-one-year-out validation | ~200 rows per crop; overfitting risk; judges will ask |
| 2026-11-13 | Pilot area: 8 counties (AB, AR, BH, CJ, HD, MS, SB, VL), the 20 Alba communes nearest the Aiud–Sântimbru midpoint (46.22, 23.69), and a demo field at 46.30, 23.75 | Guide recommends Alba + neighbours; the communes cover the buyer's sourcing area; one field for the farmer demo |
| 2026-11-13 | One feature table (`FeatureRow`) for field, commune and county rows instead of two schemas | Same columns at every scale; `zone_type` tells them apart; ML trains on counties and predicts on all three |
| 2026-11-13 | Zone values from cropland sample points (5 per county, 2 per commune, 1 field): KMeans centres on EUCROPMAP arable pixels; daily inputs averaged over points, then indicators | POWER/SMAP/MODIS are point APIs; keeps forests and towns out; counts stay whole days |
| 2026-11-13 | MODIS and SMAP via AppEEARS point tasks (all 81 points, one task per product), not area downloads | Two tasks instead of hundreds of tiles; results are small CSVs |
| 2026-11-13 | SoilGrids via the WCS rasters, cropped to the pilot bbox | The REST point API is paused; rasters serve every point offline |
| 2026-11-13 | NDVI features are cropland greenness, not per-crop | No open yearly crop masks for Romania (IACS is not public); stated in the contracts and the pitch |
