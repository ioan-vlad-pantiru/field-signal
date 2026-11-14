# LSTM ensemble -> NDVI -> yield chain

## Part 1: chain check, rollout from 2021-09 for 36 months, all points

| crop | n | ensemble RMSE | ensemble R2 | observed RMSE | observed R2 | region-mean RMSE | region-mean R2 |
|---|---|---|---|---|---|---|---|
| barley | 93 | 0.556 | +0.628 | 0.556 | +0.628 | 0.555 | +0.629 |
| dry_pulses | 64 | 0.377 | +0.304 | 0.377 | +0.304 | 0.375 | +0.312 |
| maize | 96 | 1.499 | +0.439 | 1.150 | +0.670 | 2.260 | -0.274 |
| rapeseed | 90 | 0.404 | +0.198 | 0.367 | +0.339 | 0.402 | +0.206 |
| soybeans | 62 | 0.514 | +0.099 | 0.474 | +0.235 | 0.581 | -0.153 |
| sunflower | 90 | 0.459 | +0.220 | 0.399 | +0.412 | 0.599 | -0.327 |
| wheat | 96 | 0.687 | +0.420 | 0.534 | +0.650 | 0.620 | +0.529 |

Part 1 `n` is the intersection of ensemble and observed region-crop-year rows with a Eurostat yield; both sides use the observed `state_mask` and the same `<2 observed season months` rule as `yield_models.py`. The ensemble and observed columns use yield models refit on 2017-2021 only (same settings, in memory; the saved models are untouched), so 2022-2024 is out of sample. The region-mean baseline is each NUTS2 region and crop's Eurostat mean yield over 2017-2021 (crop mean for a missing region).

## Part 2: future weather scenarios

- rows: 39032
- NUTS3 zones: 136
- crops: 7
- weather years: 41 (1985-2025)
- point-crop pairs rolled out: 261764

| crop | rows | zones | mean n_points |
|---|---|---|---|
| barley | 5576 | 136 | 277.4 |
| dry_pulses | 5576 | 136 | 277.7 |
| maize | 5576 | 136 | 269.8 |
| rapeseed | 5576 | 136 | 276.7 |
| soybeans | 5576 | 136 | 277.2 |
| sunflower | 5576 | 136 | 270.1 |
| wheat | 5576 | 136 | 276.0 |

## Ambiguities and choices

- Ensemble: five monthly seeds (`monthly_lstm` seed 0 plus `monthly_s1..s4`); the delta ensemble was not used.
- Part 1 uses the observed `state_mask` for 2022-2024 and skips points with fewer than two observed season months, matching `yield_models.py`; Part 2 has no future mask and uses all season months.
- Part 1/2 average the five members' monthly NDVI before computing peak and sum.
- Weather years 1985-2025 were built with `weather_history.monthly_grid` (same channels as `build.py`). Raw POWER has 48 missing `ALLSKY_SFC_SW_DWN` cell-days in 1987-02, 1990-02 and 1993-02; those were filled with the cell-month mean before ET0 so all 41 years are retained.
- Crop eligibility uses the `origin/bogdan/optimizer` planner's own `candidates.candidates`/`is_valid` (last four harvests, a crop returns only after `max(2, min_return)` years), with intervals from `planner/crops.py`: wheat 2, barley 2, maize 1 (so 2 via the solver's floor), sunflower 5; soybeans 3, rapeseed 4 and dry_pulses 4 (= pea) are the task's additions to that table. A crop is allowed in 2025 when `candidates([crop], 1, ...)` is non-empty.
- Points: up to 300 random points per NUTS3 zone and crop, sampled without replacement with seed 2025 from the 365,958 processed points.
- Zones use the NUTS2 region means from `models/yield_<crop>_region_means.json`; a NUTS2 region missing from that file uses the saved crop fallback.
- Barley and dry_pulses use the regional normal yield; `regional_normal=True`. Their Part 1 ensemble and observed columns are therefore identical.
- Part 2 keeps every zone-crop with at least one allowed point; the number of zone-crop pairs below 30 points and the minimum are reported from the output.
- The 2025 rollout keeps real state through 2024-09, then predicts 12 months with the target crop (and 2024/2023 as previous crops) and the past year's weather. The same 12-month weather block is applied to every zone for a given year.
- NUTS2 yield is Eurostat harvested production / area; wheat is C1110 because C1100 has no NUTS2 rows.
- 29 zone-crop pairs have fewer than 30 points (minimum 2), visible in `n_points`.
- No model was retrained.
