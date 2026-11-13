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
| 2026-11-13 | Pilot area: 8 counties (AB, AR, BH, CJ, HD, MS, SB, VL), the 40 Alba communes nearest the Aiud–Sântimbru midpoint (46.22, 23.69) with at least one EUCROPMAP 2022 arable pixel, and a demo field at 46.30, 23.75 | Guide recommends Alba + neighbours; the communes cover the buyer's sourcing area; one field for the farmer demo |
| 2026-11-13 | One feature table (`FeatureRow`) for field, commune and county rows instead of two schemas | Same columns at every scale; `zone_type` tells them apart; ML trains on counties and predicts on all three |
| 2026-11-13 | Zone values from cropland sample points (5 per county, 2 per commune, 1 field): KMeans centres on EUCROPMAP arable pixels; daily inputs averaged over points, then indicators | POWER/SMAP/MODIS are point APIs; keeps forests and towns out; counts stay whole days |
| 2026-11-13 | MODIS and SMAP via AppEEARS point tasks (all sample points, one task per product), not area downloads | Two tasks instead of hundreds of tiles; results are small CSVs |
| 2026-11-13 | SoilGrids via the WCS rasters, cropped to the pilot bbox | The REST point API is paused; rasters serve every point offline |
| 2026-11-13 | NDVI features are cropland greenness, not per-crop | No open yearly crop masks for Romania (IACS is not public); stated in the contracts and the pitch |
| 2026-11-14 | 40 Alba communes instead of 20: the 40 nearest communes with at least one EUCROPMAP 2022 arable pixel; Ponor and Mogoş are skipped for having none. 49 zones, 121 sample points | The guide's sourcing persona follows 40 communes; a commune with no arable land has nothing to source |
| 2026-11-14 | NDVI/EVI from a local MODIS VI cube (MOD13Q1 + MYD13Q1 v061 via Planetary Computer `modis-13Q1-061`) for every point AppEEARS has no rows for; AppEEARS rows win where present. A cube value is one nearest-neighbour MODIS pixel on a 0.01° lattice, Terra and Aqua mixed, with no pixel-quality layer: it describes the area, not a field. `ndvi_usable_share` null marks a cube row. `ndvi_peak` (and its anomaly) is null unless usable 16-day composites cover ≥ 75 % of the crop's flowering window. SMAP stays null until the AppEEARS task lands; the soil-moisture fallback is POWER `GWETROOT` (`gwetroot_critical`) | The AppEEARS tasks cover only the earlier 81 points and are still pending. NDVI peaks around flowering, so a window with missing composites would give a false low peak: Planetary Computer has no MOD13Q1/MYD13Q1 items for tile h19v04 from 2025-06-26 to 2025-11-17, so 2025 maize, soybean and sunflower peaks are null |
