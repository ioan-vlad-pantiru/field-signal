# contracts

Shared data formats between `data/` (Bogdan), `ml/` (Răzvan), `services/api/` and `apps/web/` (Vlad).
Agree here before changing anything downstream. Version: **0.1.0** (13 Nov 2026).

```
 data/  ──(1) features.parquet──▶  ml/  ──(2) predictions.parquet──▶  services/api  ──(3) JSON──▶  apps/web
   └─────────────(1) same features, for the replay grid and indicators────────────▶┘
```

| # | Handoff | Format | Defined in |
|---|---|---|---|
| 1 | Features: zone × crop × season | Parquet | this file (below) |
| 2 | Model predictions | Parquet or JSON Lines, one `ModelPrediction` per row | `model_prediction.schema.json` |
| 3a | Farmer screen | `POST /v1/fields/analyze` → `FieldAnalysis` | `field_request.schema.json`, `field_analysis.schema.json` |
| 3b | Buyer screen | `GET /v1/sourcing/region?season=2025` → `SourcingRegion` | `sourcing_region.schema.json` |

**Source of truth:** the pydantic models in `services/api/src/api/contracts.py`. Do not edit the
`*.schema.json` files or `apps/web/src/lib/contracts.ts` by hand; regenerate them:

```bash
uv run --package api python -m api.export_contracts
npm i --prefix /tmp/jstt json-schema-to-typescript@15
NODE_PATH=/tmp/jstt/node_modules node scripts/gen-contract-types.cjs
```

**Mocks:** `examples/*.mock.json` (also copied to `apps/web/src/mocks/`) are fabricated, have
`"mock": true`, and are what the API returns until the real pipeline is wired. They validate against
the schemas (see `services/api/tests/test_contracts.py`). Never present mock numbers as real.

## Conventions

- Crops: `maize, wheat, barley, soybean, sunflower, pea, cover_mustard, cover_phacelia, cover_vetch, fallow`.
- Zones: Romanian communes keyed by **SIRUTA** code (string). Fields use `field:<lat>,<lon>` rounded to 2 decimals. Counties use `county:<AB|CJ|MS|SB|HD|AR|BH|VL>`.
- Season = harvest year. Winter wheat sown in Oct 2024 is season 2025.
- Units in column names (`_mm`, `_days`, `_pct`, `_c`). Missing = null, never 0 or -999.
- Farmer scores 0–100, higher is better. Buyer risk scores 0–100, higher is riskier.
- Every estimate shown to a user has a `Range` and a `Confidence`.
- User-facing text is `{ "ro": ..., "en": ... }`.

## (1) Feature table: `data/cache/features/<zone_type>.parquet`

One row per `zone_id × crop × season`. Window dates come from `data/crops.toml`
(placeholder windows until the agronomist review; record the version used). Validated by
`FeatureRow` (`feature_row.schema.json`); real example rows in `examples/feature_row.example.json`.
Built by `data/scripts/build_features.py`. Point sources (POWER, MODIS, SMAP) are sampled at
cropland points inside the zone (5 per county, 2 per commune, 1 for the field); daily values
are averaged over the points first, then the season indicators are computed.

| column | type | description | source |
|---|---|---|---|
| `zone_id` | str | SIRUTA, `field:46.30,23.75`, or `county:AB` | |
| `zone_type` | str | `field` \| `commune` \| `county` | |
| `crop` | str | crop id | |
| `season` | int | harvest year | |
| `lat`, `lon` | float | zone representative point (field: the clicked point) | |
| `crop_area_ha` | float? | area of this crop in the zone: counties from INS (per year); communes from EUCROPMAP 2018 (seasons 2018–21) / 2022 (2022+), null before | INS AGR108A / EUCROPMAP |
| `hot_days_flowering` | int | days with T2M_MAX ≥ threshold inside the crop's flowering window | POWER |
| `max_tmax_flowering_c` | float | hottest day in the flowering window | POWER |
| `rain_flowering_mm` | float | rain in the flowering window | POWER |
| `rain_season_mm` | float | rain sowing → harvest | POWER |
| `rh_flowering_pct` | float | mean RH2M in the flowering window (fusarium proxy for wheat) | POWER |
| `wet_days_flowering` | int | days with rain ≥ 1 mm in the flowering window | POWER |
| `rain_harvest_mm` | float | rain in the harvest window | POWER |
| `frost_days_winter` | int | days with T2M_MIN ≤ −15 °C, 1 Dec – end Feb (winter crops only; snow cover not modelled) | POWER |
| `et0_season_mm` | float | FAO-56 reference ET, sowing → harvest | POWER |
| `water_deficit_mm` | float | `et0_season_mm − rain_season_mm` (crude, no Kc yet) | POWER |
| `gwetroot_critical` | float | POWER root-zone wetness (0–1, model) in the critical month | POWER |
| `smap_rootzone_critical` | float? | SMAP L4 root-zone soil moisture (m³/m³), critical months; null before 2015 | SMAP |
| `smap_rootzone_anomaly` | float? | z-score vs 2015–2025 for the same zone and window | SMAP |
| `ndvi_peak` | float? | max usable NDVI, sowing → harvest. Cropland greenness at the sample points, not crop-specific (no yearly crop masks) | MODIS MOD13Q1 |
| `ndvi_peak_anomaly` | float? | z-score vs all seasons of the same zone and crop | MODIS |
| `ndvi_usable_share` | float? | share of composites with reliability 0–1; null when the source has no reliability layer (MODIS cube) | MODIS |
| `soc_g_per_kg`, `ph_h2o`, `clay_pct`, `sand_pct` | float? | 0–30 cm | SoilGrids |
| `yield_t_ha` | float? | official yield (counties only) | INS AGR110A |
| `yield_anomaly_pct` | float? | % vs a linear trend over the county × crop record (counties only, ≥ 8 years) | derived |
| `crops_yaml_version` | str | version of the crop windows used | |

A null NDVI or SMAP value (`ndvi_peak`, `ndvi_peak_anomaly`, `ndvi_usable_share`, `smap_*`) means "not measured", never zero.

Required for the pitch minimum: at least three NASA indicators over ≥ 5 seasons for the demo
field (we have POWER, MODIS, SMAP).

## (2) Model predictions: `ml/out/predictions.parquet`

One `ModelPrediction` per row (see `model_prediction.schema.json`):
`zone_id, zone_type, crop, season, p_bad_year, yield_anomaly_pct {low, mid, high},
top_drivers [Reason], model_version, cv_metric_name, cv_metric_value`.

- `p_bad_year`: probability that the detrended yield anomaly is below the agreed cut-off
  (proposal: −15%; to confirm with Răzvan).
- `top_drivers`: up to 3 features with the largest contribution, using the feature column name
  as `code`.
- `cv_metric_*`: leave-one-year-out score, so the app can show how good the model is.

## (3a) Field cells: per-hexagon farmland mask (proposal, #22)

`FieldAnalysis.field_cells` is optional: `null` (the default, and every current mock) means the
mask was not computed, and the web keeps its OpenStreetMap check. When present, one `FieldCell`
per 1 ha hexagon of the field plan:

| field | type | description |
|---|---|---|
| `id` | str | axial `"q,r"` of a pointy-top 1 ha hexagon, `"0,0"` centred on `location.point`; same ids as `apps/web/src/lib/field-plan.ts` |
| `cropland_fraction` | float 0–1 | share of the hexagon mapped as cropland |

The map behind the fractions (e.g. EUCROPMAP) and its year go in `FieldAnalysis.sources`.
