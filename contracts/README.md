# contracts

Shared data formats between `data/` (Bogdan), `ml/` (Răzvan), `services/api/` and `apps/web/` (Vlad).
Agree here before changing anything downstream. Version: **0.2.0** (14 Nov 2026; adds the farm planner contracts, nothing removed or renamed).

```
 data/  ──(1) features.parquet──▶  ml/  ──(2) predictions.parquet──▶  services/api  ──(3) JSON──▶  apps/web
   └─────────────(1) same features, for the replay grid and indicators────────────▶┘
```

| # | Handoff | Format | Defined in |
|---|---|---|---|
| 1 | Features: zone × crop × season | Parquet | this file (below) |
| 2 | Model predictions | Parquet or JSON Lines, one `ModelPrediction` per row | `model_prediction.schema.json` |
| 2b | World model → farm planner | Parquet or JSON Lines, one `RotationOutcome` per row | `rotation_outcome.schema.json` |
| 3a | Farmer screen | `POST /v1/fields/analyze` → `FieldAnalysis` | `field_request.schema.json`, `field_analysis.schema.json` |
| 3b | Buyer screen | `GET /v1/sourcing/region?season=2025` → `SourcingRegion` | `sourcing_region.schema.json` |
| 3c | Farm plan | `POST /v1/farm/plan` → `FarmPlanResponse` | `farm_plan_request.schema.json`, `farm_plan_response.schema.json` |

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

## (2b) World-model outcomes for the farm planner: `RotationOutcome`

One row per `grid_point_id × rotation × weather_start_season × plan_year` (see
`rotation_outcome.schema.json`). The world model (`ml/`) owns everything up to these yearly physical
summaries; the planner (`services/api/src/api/planner/`) owns normalisation, weights and rules, so
the rows carry no scores.

- `grid_point_id`: `"{lat:.5f}_{lon:.5f}"` of the centre of a 0.0025° (about 250 m) cell of the
  SoilGrids raster grid (west 20.2, north 48.3).
- `rotation`: the crop sequence joined by `>`, e.g. `maize>wheat>pea`.
- `weather_start_season`: the scenario id, the first harvest season of a window of `plan_years`
  consecutive seasons from the weather record; `season = weather_start_season + plan_year − 1`.
- `plan_year`: 1–5 (plans run 3, 4 or 5 years).
- `yield_rel`, `ndvi_peak`, `ndvi_offseason`, `rootzone_sm_critical`, `et_season_mm`: `Range` with
  low/mid/high = P10/P50/P90 over ensemble members, i.e. the spread across ensemble members for one
  weather window (not across weather windows); null = not predicted, and the planner then drops
  that rotation for that grid point.
- `model_version`: `"mock-0"` while the declared mock world model stands in for the real one.

## (3a) Field cells: per-hexagon farmland mask (proposal, #22)

`FieldAnalysis.field_cells` is optional: `null` (the default, and every current mock) means the
mask was not computed, and the web keeps its OpenStreetMap check. When present, the cells are
centred on `location.point` and cover the 3-ring pin layout (37 hexagons of 1 ha). A hexagon
without a cell means unknown, never 0.

Open decision for the three contract owners: for a drawn field, the web centres its grid on the
exact polygon centroid, while `location` is that centroid rounded (about 6 m off), and the field
can extend beyond ring 3. Serving drawn fields needs either the web to centre its grid on
`location.point`, or a ring count or boundary in `FieldRequest`.

| field | type | description |
|---|---|---|
| `id` | str | axial `"q,r"` of a pointy-top 1 ha hexagon, `"0,0"` centred on `location.point`; same ids as `apps/web/src/lib/field-plan.ts` |
| `cropland_fraction` | float 0–1 | share of the hexagon mapped as cropland |

The map behind the fractions (e.g. EUCROPMAP) and its year go in `FieldAnalysis.sources`.

## (3c) Farm plan: `POST /v1/farm/plan`

`FarmPlanRequest`: 1–10 fields (`id`, optional `name`, drawn `boundary`, `current_rotation` as the
farmer's reference cycle of 2–4 crops, optional `crop_history` of 0–5 observed crops with the most
recent harvest last), shared `priorities` (non-negative weights, normalised server-side),
`risk_aversion` 0–1 (default 0.3), `plan_years` 3, 4 or 5 (default 4), `eco_scheme` (default
false: nothing from the voluntary PD-04 eco-scheme is enforced) and `eco_practice`
(`diversification`, the default, or `legume_share`; read only when `eco_scheme` is true, and only
that one practice is enforced). Without `crop_history`, the cycle `current_rotation` is read
backwards as the field's history, an assumption stated in `caveats`.

`FarmPlanResponse`: up to 3 `plans` plus `current`, the farmer's own rotation scored the same way
(rank 0, null if it cannot be scored). `plans[0]` (rank 1) is the best solution found; it is
optimal for the model only when `proven_optimal` is true. Ranks 2–3 are alternatives that change
the rotation of at least two fields (of the only field on a one-field farm) against each better
plan, not the second and third best solutions. A drawn field is a parcel with exactly one rotation:
`allocations` holds exactly one entry per field, its `area_ha` the field's area. Each `FarmPlan`
also gives the area-weighted mean `score` (0–100 decision metrics, not probabilities, same four
parts as `ScoreBreakdown`), `score_range` (the spread across weather windows: worst / median / best) with the
`worst` and `best` windows named, crop areas per plan year, and `rules`. Each `RuleCheck` row
(`max_crop_share`, `max_two_crops_share`, `legume_share`) names its `source` (profile and year, e.g.
`GAEC 7 2026`, `PD-04 2026`), the limit, the worst-year value, `applies` (true only for the practice
enforced in this request), `passed` and `verified` (the limit was read in the official document).
Rule rows are provisional checks, not a statement of GAEC 7 or PD-04 compliance. `confidence` is how
far the model behind the numbers has been validated: `low` for every plan built on the mock world
model; the rule for the real model is still open. `mock` is true and `model_version` is `"mock-0"`
until the real world model is wired.
