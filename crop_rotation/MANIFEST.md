# Dataset manifest

Generated 2026-11-14T13:30:56+00:00 from files present under `data/` (region: full, pilot: False). Nothing here is asserted unless its file exists.

## Provenance
- git commit: `cb471424831f2e7fcaea00f6aa8926ed3c2af1bc`
- analysis parameters (`data/params.json`): `{"confidence_filter": "none at storage time; sweep 50/60/70/80 at analysis", "countries": ["RO", "HU", "BG", "HR", "SK", "AT1", "RS12"], "gee_project_tier": "REGISTERED_NOT_COMMERCIALLY (restricted mode after quota exhaustion)", "gee_workers_final_run": 4, "hls_window": "monthly median, full year 2016-01-01..latest, L30+S30, Fmask-cleared", "holdout_nuts3": ["RO121", "RO113", "RO125", "RO126", "RO423"], "hrl_years": [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024], "modis": "MOD13Q1 NDVI + SummaryQA stored; quality filter applied at analysis", "points_produced": 508379, "purity_threshold": "none (purity_m250 stored per point-year; lagged covariate only)", "region": "full", "sample_target_points": 300000, "sampling_frame": "centre pixel a target crop in >=1 year and 3x3 window class-uniform; no confidence or purity cut", "spacing": "at most one point per 250 m MODIS cell"}`
- deviation: `power` (weather) and `smap_sm` are keyed by `cell_id`, not `point_id`, because expanding to points would be ~10^10 rows.

### Package versions
```
affine==3.0.1
attrs==26.1.0
certifi==2026.10.23
cffi==2.1.1
charset-normalizer==3.5.2
click==8.5.1
contourpy==1.4.0
cryptography==50.0.2
cycler==0.12.1
earthengine-api==1.7.52
fonttools==4.68.0
geopandas==1.2.0
google-api-core==2.44.0
google-api-python-client==2.202.0
google-auth==2.62.2
google-auth-httplib2==0.4.4
google-cloud-core==2.8.0
google-cloud-storage==3.17.1
google-crc32c==1.9.0
google-resumable-media==2.11.0
googleapis-common-protos==1.76.0
httplib2==0.32.1
idna==3.20
kiwisolver==1.5.1
matplotlib==3.11.2
numpy==2.5.4
opentelemetry-api==1.45.2
packaging==26.3
pandas==3.1.1
pillow==13.0.0
polars==2.1.0
polars-runtime-32==2.1.0
proto-plus==1.29.0
protobuf==7.36.2
pyarrow==26.0.1
pyasn1==0.6.5
pyasn1_modules==0.4.2
pycparser==3.12
pyogrio==0.13.0
pyparsing==3.3.3
pyproj==3.8.0
python-dateutil==4.0.0
rasterio==1.5.2
requests==2.34.2
scipy==1.18.1
shapely==2.2.0
typing_extensions==4.16.0
tzdata==2026.6
uritemplate==4.2.0
urllib3==2.8.0
```

## Datasets
### eucropmap
- paths: `data/raw/eucropmap/part-eucropmap-p000000-002000.parquet`, `data/raw/eucropmap/part-eucropmap-p002000-004000.parquet`, `data/raw/eucropmap/part-eucropmap-p004000-006000.parquet`, `data/raw/eucropmap/part-eucropmap-p006000-008000.parquet`, `data/raw/eucropmap/part-eucropmap-p008000-010000.parquet`, `data/raw/eucropmap/part-eucropmap-p010000-012000.parquet`, `data/raw/eucropmap/part-eucropmap-p012000-014000.parquet`, `data/raw/eucropmap/part-eucropmap-p014000-016000.parquet`, `data/raw/eucropmap/part-eucropmap-p016000-018000.parquet`, `data/raw/eucropmap/part-eucropmap-p018000-020000.parquet` … (245 more)
- size: 6632904 bytes (6.3 MiB)
- rows: 935623
- date/year range: 2018 .. 2022
- distinct variables: 1
- missing `value`: 0.0% (0/935623)

### modis_ndvi
- paths: `data/raw/modis_ndvi/part-modis_ndvi-p000000-002000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p002000-004000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p004000-006000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p006000-008000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p008000-010000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p010000-012000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p012000-014000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p014000-016000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p016000-018000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p018000-020000.parquet` … (245 more)
- size: 694210268 bytes (662.1 MiB)
- rows: 312108320
- date/year range: 2000-02-18 .. 2026-10-16
- distinct variables: 1
- missing `value`: 0.0% (0/312108320)

### modis_qa
- paths: `data/raw/modis_qa/part-modis_qa-p000000-002000.parquet`, `data/raw/modis_qa/part-modis_qa-p002000-004000.parquet`, `data/raw/modis_qa/part-modis_qa-p004000-006000.parquet`, `data/raw/modis_qa/part-modis_qa-p006000-008000.parquet`, `data/raw/modis_qa/part-modis_qa-p008000-010000.parquet`, `data/raw/modis_qa/part-modis_qa-p010000-012000.parquet`, `data/raw/modis_qa/part-modis_qa-p012000-014000.parquet`, `data/raw/modis_qa/part-modis_qa-p014000-016000.parquet`, `data/raw/modis_qa/part-modis_qa-p016000-018000.parquet`, `data/raw/modis_qa/part-modis_qa-p018000-020000.parquet` … (245 more)
- size: 161846533 bytes (154.3 MiB)
- rows: 312108320
- date/year range: 2000-02-18 .. 2026-10-16
- distinct variables: 1
- missing `value`: 0.0% (0/312108320)

### hls_ndvi
- paths: `data/raw/hls_ndvi/part-hls_ndvi-p000000-002000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p002000-004000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p004000-006000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p006000-008000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p008000-010000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p010000-012000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p012000-014000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p014000-016000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p016000-018000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p018000-020000.parquet` … (245 more)
- size: 431557678 bytes (411.6 MiB)
- rows: 62291312
- date/year range: 2016-01-01 .. 2026-10-01
- distinct variables: 1
- missing `value`: 0.0% (0/62291312)

### smap_sm
- paths: `data/raw/smap_sm/part-smap_sm-cE165N605.parquet`, `data/raw/smap_sm/part-smap_sm-cE299N553.parquet`, `data/raw/smap_sm/part-smap_sm-p000000-002000.parquet`, `data/raw/smap_sm/part-smap_sm-p002000-003464.parquet`
- size: 11112924 bytes (10.6 MiB)
- rows: 2141076
- date/year range: 2015-03-22 .. 2026-11-09
- distinct variables: 1
- missing `value`: 0.0% (0/2141076)

### soilgrids
- paths: `data/raw/soilgrids/part-soilgrids-p000000-002000.parquet`, `data/raw/soilgrids/part-soilgrids-p002000-004000.parquet`, `data/raw/soilgrids/part-soilgrids-p004000-006000.parquet`, `data/raw/soilgrids/part-soilgrids-p006000-008000.parquet`, `data/raw/soilgrids/part-soilgrids-p008000-010000.parquet`, `data/raw/soilgrids/part-soilgrids-p010000-012000.parquet`, `data/raw/soilgrids/part-soilgrids-p012000-014000.parquet`, `data/raw/soilgrids/part-soilgrids-p014000-016000.parquet`, `data/raw/soilgrids/part-soilgrids-p016000-018000.parquet`, `data/raw/soilgrids/part-soilgrids-p018000-020000.parquet` … (245 more)
- size: 12093004 bytes (11.5 MiB)
- rows: 1990927
- date/year range: none (static only)
- distinct variables: 4
- missing `value`: 0.0% (0/1990927)

### srtm
- paths: `data/raw/srtm/part-srtm-p000000-002000.parquet`, `data/raw/srtm/part-srtm-p002000-004000.parquet`, `data/raw/srtm/part-srtm-p004000-006000.parquet`, `data/raw/srtm/part-srtm-p006000-008000.parquet`, `data/raw/srtm/part-srtm-p008000-010000.parquet`, `data/raw/srtm/part-srtm-p010000-012000.parquet`, `data/raw/srtm/part-srtm-p012000-014000.parquet`, `data/raw/srtm/part-srtm-p014000-016000.parquet`, `data/raw/srtm/part-srtm-p016000-018000.parquet`, `data/raw/srtm/part-srtm-p018000-020000.parquet` … (245 more)
- size: 8728749 bytes (8.3 MiB)
- rows: 1016758
- date/year range: none (static only)
- distinct variables: 2
- missing `value`: 0.0% (0/1016758)

### power
- paths: `data/raw/power/part-power-41.5_23.125.parquet`, `data/raw/power/part-power-41.5_23.75.parquet`, `data/raw/power/part-power-41.5_24.375.parquet`, `data/raw/power/part-power-41.5_25.625.parquet`, `data/raw/power/part-power-41.5_25.parquet`, `data/raw/power/part-power-41.5_26.25.parquet`, `data/raw/power/part-power-42.5_16.25.parquet`, `data/raw/power/part-power-42.5_18.125.parquet`, `data/raw/power/part-power-42.5_18.75.parquet`, `data/raw/power/part-power-42.5_22.5.parquet` … (246 more)
- size: 130123592 bytes (124.1 MiB)
- rows: 30021376
- date/year range: 1981-01-01 .. 2026-11-13
- distinct variables: 7
- missing `value`: 6.4% (1906392/30021376)

## Core tables
### points.parquet
- path: `data/interim/points.parquet`
- size: 13725511 bytes (13.1 MiB)
- rows: 508379

### crops.parquet
- path: `data/interim/crops.parquet`
- size: 47799115 bytes (45.6 MiB)
- rows: 4067032
- confidence coverage (non-null): 81.8% (3327962/4067032)
- purity_m250 coverage (non-null): 73.0% (2969574/4067032)

| country | year | rows |
|---|---|---|
| AT | 2017 | 30712 |
| AT | 2018 | 30712 |
| AT | 2019 | 30712 |
| AT | 2020 | 30712 |
| AT | 2021 | 30712 |
| AT | 2022 | 30712 |
| AT | 2023 | 30712 |
| AT | 2024 | 30712 |
| BG | 2017 | 88278 |
| BG | 2018 | 88278 |
| BG | 2019 | 88278 |
| BG | 2020 | 88278 |
| BG | 2021 | 88278 |
| BG | 2022 | 88278 |
| BG | 2023 | 88278 |
| BG | 2024 | 88278 |
| HR | 2017 | 35602 |
| HR | 2018 | 35602 |
| HR | 2019 | 35602 |
| HR | 2020 | 35602 |
| HR | 2021 | 35602 |
| HR | 2022 | 35602 |
| HR | 2023 | 35602 |
| HR | 2024 | 35602 |
| HU | 2017 | 101935 |
| HU | 2018 | 101935 |
| HU | 2019 | 101935 |
| HU | 2020 | 101935 |
| HU | 2021 | 101935 |
| HU | 2022 | 101935 |
| HU | 2023 | 101935 |
| HU | 2024 | 101935 |
| RO | 2017 | 182598 |
| RO | 2018 | 182598 |
| RO | 2019 | 182598 |
| RO | 2020 | 182598 |
| RO | 2021 | 182598 |
| RO | 2022 | 182598 |
| RO | 2023 | 182598 |
| RO | 2024 | 182598 |
| RS | 2017 | 34887 |
| RS | 2018 | 34887 |
| RS | 2019 | 34887 |
| RS | 2020 | 34887 |
| RS | 2021 | 34887 |
| RS | 2022 | 34887 |
| RS | 2023 | 34887 |
| RS | 2024 | 34887 |
| SK | 2017 | 34367 |
| SK | 2018 | 34367 |
| SK | 2019 | 34367 |
| SK | 2020 | 34367 |
| SK | 2021 | 34367 |
| SK | 2022 | 34367 |
| SK | 2023 | 34367 |
| SK | 2024 | 34367 |

### strata_counts.parquet
- path: `data/interim/strata_counts.parquet`
- size: 4884 bytes (0.0 MiB)
- rows: 49

## HRL inventory
### inventory.parquet
- path: `data/interim/hrl/inventory.parquet`
- size: 119594 bytes (0.1 MiB)
- rows: 1472
- columns: product_id, year, product, tile_id, href, bytes, access_date, path

| year | product | items |
|---|---|---|
| 2017 | cty | 92 |
| 2017 | ctycl | 92 |
| 2018 | cty | 92 |
| 2018 | ctycl | 92 |
| 2019 | cty | 92 |
| 2019 | ctycl | 92 |
| 2020 | cty | 92 |
| 2020 | ctycl | 92 |
| 2021 | cty | 92 |
| 2021 | ctycl | 92 |
| 2022 | cty | 92 |
| 2022 | ctycl | 92 |
| 2023 | cty | 92 |
| 2023 | ctycl | 92 |
| 2024 | cty | 92 |
| 2024 | ctycl | 92 |
- access dates: 2026-11-13

## Not present
_none_
