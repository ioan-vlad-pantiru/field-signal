# Yield models: Eurostat yields vs observed NDVI

XGBoost per crop on region-centered `ndvi_peak` and `ndvi_sum` anomalies (monotone +). The target is yield minus the region's mean yield over the training years; predictions add the region mean back. Leave-one-harvest-year-out, against the region's mean yield from the other years.

## Training rows per country and crop

| country | barley | dry_pulses | maize | rapeseed | soybeans | sunflower | wheat | total |
|---|---|---|---|---|---|---|---|---|
| AT | 16 | 16 | 16 | 16 | 16 | 16 | 16 | 112 |
| BG | 48 | 39 | 48 | 48 | 3 | 48 | 44 | 278 |
| HR | 26 | 12 | 31 | 18 | 17 | 16 | 32 | 152 |
| HU | 56 | 56 | 56 | 56 | 45 | 56 | 56 | 381 |
| RO | 63 | 0 | 64 | 64 | 51 | 64 | 64 | 370 |
| RS | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 56 |
| SK | 32 | 32 | 32 | 32 | 31 | 32 | 32 | 223 |

## Model vs baseline (leave-one-year-out)

| crop | rows | regions | years | model RMSE | model R2 | baseline RMSE | baseline R2 |
|---|---|---|---|---|---|---|---|
| barley | 249 | 32 | 8 | 0.598 | 0.617 | 0.595 | 0.620 |
| dry_pulses | 163 | 23 | 8 | 0.384 | 0.359 | 0.358 | 0.443 |
| maize | 255 | 32 | 8 | 1.002 | 0.730 | 1.710 | 0.215 |
| rapeseed | 242 | 31 | 8 | 0.351 | 0.296 | 0.373 | 0.208 |
| soybeans | 171 | 25 | 8 | 0.422 | 0.372 | 0.466 | 0.236 |
| sunflower | 240 | 30 | 8 | 0.320 | 0.572 | 0.433 | 0.214 |
| wheat | 252 | 32 | 8 | 0.593 | 0.538 | 0.641 | 0.461 |

## Scatter: observed vs leave-one-year-out prediction

![barley](figures/yield_barley.png)
![dry_pulses](figures/yield_dry_pulses.png)
![maize](figures/yield_maize.png)
![rapeseed](figures/yield_rapeseed.png)
![soybeans](figures/yield_soybeans.png)
![sunflower](figures/yield_sunflower.png)
![wheat](figures/yield_wheat.png)

## Unmatched NUTS codes and crops

NDVI feature rows without a Eurostat yield: 73 (regions: BG31, BG32, BG33, BG34, BG41, BG42, HR02, HR06, RO11, RO12, RO21, RO22, RO31, RO41, RO42)

Eurostat yield rows without NDVI features: 638 (regions: AT13, AT21, AT22, AT31, AT32, AT33, AT34, BG32, BG33, BG34, BG41, BG42, HR03, HR04, HR05, HR06, HU11, HU12, HU31, HU32, RO32, RO41, RS11, RS21, RS22, SK01)

Crops with no training rows: none

Countries with no training rows: none

Notes: wheat = C1110 (common wheat and spelt; C1100 has no NUTS2 production/area); dry_pulses = P0000 (dry pulses and protein crops for grain). apro_cpshr publishes yield only at country level; NUTS2 yield here is harvested production / area from the same table, which reproduces the published country yield. RS regions are present where Eurostat reports them.

Prediction-time region means (yield, ndvi_peak, ndvi_sum) from the final fit are saved next to each model in `models/yield_<crop>_region_means.json`; regions with fewer than 3 training years use the unweighted mean of the crop's region means (also saved as `fallback`). Prediction = region mean yield + model.predict(features - region means).
