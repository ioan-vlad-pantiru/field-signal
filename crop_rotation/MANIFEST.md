# Dataset manifest

Generated 2026-11-14T02:23:00+00:00 from files present under `data/` (region: full, pilot: False). Nothing here is asserted unless its file exists.

## Provenance
- git commit: `cb471424831f2e7fcaea00f6aa8926ed3c2af1bc`
- analysis parameters (`data/params.json`): `{"confidence_filter": "none at storage time; sweep 50/60/70/80 at analysis", "countries": ["RO", "HU", "BG", "HR", "SK", "AT1", "RS12"], "embedding_years_present": [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], "gee_project_tier": "REGISTERED_NOT_COMMERCIALLY (restricted mode after quota exhaustion)", "gee_workers_final_run": 4, "hls_window": "monthly median, full year 2016-01-01..latest, L30+S30, Fmask-cleared", "holdout_nuts3": ["RO121", "RO113", "RO125", "RO126", "RO423"], "hrl_years": [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024], "modis": "MOD13Q1 NDVI + SummaryQA stored; quality filter applied at analysis", "points_produced": 299987, "purity_threshold": "none (purity_m250 stored per point-year; lagged covariate only)", "region": "full", "sample_target_points": 300000, "sampling_frame": "centre pixel a target crop in >=1 year and 3x3 window class-uniform; no confidence or purity cut", "spacing": "at most one point per 250 m MODIS cell"}`
- deviation: `power` (weather) and `smap_sm` are keyed by `cell_id`, not `point_id`, because expanding to points would be ~10^10 rows.

### Package versions
```
affine==3.0.1
attrs==26.1.0
certifi==2026.10.23
cffi==2.1.1
charset-normalizer==3.5.2
click==8.5.1
cryptography==50.0.2
earthengine-api==1.7.52
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
numpy==2.5.4
opentelemetry-api==1.45.2
packaging==26.3
pandas==3.1.1
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
### embedding
- paths: `data/raw/embedding/part-embedding-p000000-002000.parquet`, `data/raw/embedding/part-embedding-p002000-004000.parquet`, `data/raw/embedding/part-embedding-p004000-006000.parquet`, `data/raw/embedding/part-embedding-p006000-008000.parquet`, `data/raw/embedding/part-embedding-p008000-010000.parquet`, `data/raw/embedding/part-embedding-p010000-012000.parquet`, `data/raw/embedding/part-embedding-p012000-014000.parquet`, `data/raw/embedding/part-embedding-p014000-016000.parquet`, `data/raw/embedding/part-embedding-p016000-018000.parquet`, `data/raw/embedding/part-embedding-p018000-020000.parquet` … (140 more)
- size: 226539015 bytes (216.0 MiB)
- rows: 172792512
- date/year range: 2017 .. 2025
- distinct variables: 64
- missing `value`: 0.0% (0/172792512)

### eucropmap
- paths: `data/raw/eucropmap/part-eucropmap-p000000-002000.parquet`, `data/raw/eucropmap/part-eucropmap-p002000-004000.parquet`, `data/raw/eucropmap/part-eucropmap-p004000-006000.parquet`, `data/raw/eucropmap/part-eucropmap-p006000-008000.parquet`, `data/raw/eucropmap/part-eucropmap-p008000-010000.parquet`, `data/raw/eucropmap/part-eucropmap-p010000-012000.parquet`, `data/raw/eucropmap/part-eucropmap-p012000-014000.parquet`, `data/raw/eucropmap/part-eucropmap-p014000-016000.parquet`, `data/raw/eucropmap/part-eucropmap-p016000-018000.parquet`, `data/raw/eucropmap/part-eucropmap-p018000-020000.parquet` … (140 more)
- size: 3782752 bytes (3.6 MiB)
- rows: 535142
- date/year range: 2018 .. 2022
- distinct variables: 1
- missing `value`: 0.0% (0/535142)

### modis_ndvi
- paths: `data/raw/modis_ndvi/part-modis_ndvi-p000000-002000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p002000-004000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p004000-006000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p006000-008000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p008000-010000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p010000-012000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p012000-014000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p014000-016000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p016000-018000.parquet`, `data/raw/modis_ndvi/part-modis_ndvi-p018000-020000.parquet` … (140 more)
- size: 413776805 bytes (394.6 MiB)
- rows: 184162422
- date/year range: 2000-02-18 .. 2026-10-16
- distinct variables: 1
- missing `value`: 0.0% (0/184162422)

### modis_qa
- paths: `data/raw/modis_qa/part-modis_qa-p000000-002000.parquet`, `data/raw/modis_qa/part-modis_qa-p002000-004000.parquet`, `data/raw/modis_qa/part-modis_qa-p004000-006000.parquet`, `data/raw/modis_qa/part-modis_qa-p006000-008000.parquet`, `data/raw/modis_qa/part-modis_qa-p008000-010000.parquet`, `data/raw/modis_qa/part-modis_qa-p010000-012000.parquet`, `data/raw/modis_qa/part-modis_qa-p012000-014000.parquet`, `data/raw/modis_qa/part-modis_qa-p014000-016000.parquet`, `data/raw/modis_qa/part-modis_qa-p016000-018000.parquet`, `data/raw/modis_qa/part-modis_qa-p018000-020000.parquet` … (140 more)
- size: 99180426 bytes (94.6 MiB)
- rows: 184162422
- date/year range: 2000-02-18 .. 2026-10-16
- distinct variables: 1
- missing `value`: 0.0% (0/184162422)

### hls_ndvi
- paths: `data/raw/hls_ndvi/part-hls_ndvi-p000000-002000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p002000-004000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p004000-006000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p006000-008000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p008000-010000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p010000-012000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p012000-014000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p014000-016000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p016000-018000.parquet`, `data/raw/hls_ndvi/part-hls_ndvi-p018000-020000.parquet` … (140 more)
- size: 254477422 bytes (242.7 MiB)
- rows: 36639997
- date/year range: 2016-01-01 .. 2026-10-01
- distinct variables: 1
- missing `value`: 0.0% (0/36639997)

### smap_sm
- paths: `data/raw/smap_sm/part-smap_sm-p000000-002000.parquet`, `data/raw/smap_sm/part-smap_sm-p002000-003464.parquet`
- size: 7594825 bytes (7.2 MiB)
- rows: 1475238
- date/year range: 2015-03-22 .. 2026-11-09
- distinct variables: 1
- missing `value`: 0.0% (0/1475238)

### soilgrids
- paths: `data/raw/soilgrids/part-soilgrids-p000000-002000.parquet`, `data/raw/soilgrids/part-soilgrids-p002000-004000.parquet`, `data/raw/soilgrids/part-soilgrids-p004000-006000.parquet`, `data/raw/soilgrids/part-soilgrids-p006000-008000.parquet`, `data/raw/soilgrids/part-soilgrids-p008000-010000.parquet`, `data/raw/soilgrids/part-soilgrids-p010000-012000.parquet`, `data/raw/soilgrids/part-soilgrids-p012000-014000.parquet`, `data/raw/soilgrids/part-soilgrids-p014000-016000.parquet`, `data/raw/soilgrids/part-soilgrids-p016000-018000.parquet`, `data/raw/soilgrids/part-soilgrids-p018000-020000.parquet` … (140 more)
- size: 7049357 bytes (6.7 MiB)
- rows: 1179496
- date/year range: none (static only)
- distinct variables: 4
- missing `value`: 0.0% (0/1179496)

### srtm
- paths: `data/raw/srtm/part-srtm-p000000-002000.parquet`, `data/raw/srtm/part-srtm-p002000-004000.parquet`, `data/raw/srtm/part-srtm-p004000-006000.parquet`, `data/raw/srtm/part-srtm-p006000-008000.parquet`, `data/raw/srtm/part-srtm-p008000-010000.parquet`, `data/raw/srtm/part-srtm-p010000-012000.parquet`, `data/raw/srtm/part-srtm-p012000-014000.parquet`, `data/raw/srtm/part-srtm-p014000-016000.parquet`, `data/raw/srtm/part-srtm-p016000-018000.parquet`, `data/raw/srtm/part-srtm-p018000-020000.parquet` … (140 more)
- size: 5106844 bytes (4.9 MiB)
- rows: 599974
- date/year range: none (static only)
- distinct variables: 2
- missing `value`: 0.0% (0/599974)

### power
- paths: `data/raw/power/part-power-41.5_23.125.parquet`, `data/raw/power/part-power-41.5_23.75.parquet`, `data/raw/power/part-power-41.5_24.375.parquet`, `data/raw/power/part-power-41.5_25.625.parquet`, `data/raw/power/part-power-41.5_25.parquet`, `data/raw/power/part-power-41.5_26.25.parquet`, `data/raw/power/part-power-42.5_16.25.parquet`, `data/raw/power/part-power-42.5_18.125.parquet`, `data/raw/power/part-power-42.5_18.75.parquet`, `data/raw/power/part-power-42.5_22.5.parquet` … (177 more)
- size: 94950697 bytes (90.6 MiB)
- rows: 21929677
- date/year range: 1981-01-01 .. 2026-11-13
- distinct variables: 7
- missing `value`: 6.4% (1392811/21929677)

## Core tables
### points.parquet
- path: `data/interim/points.parquet`
- size: 8294911 bytes (7.9 MiB)
- rows: 299987

### crops.parquet
- path: `data/interim/crops.parquet`
- size: 26951579 bytes (25.7 MiB)
- rows: 2399896
- confidence coverage (non-null): 80.0% (1918939/2399896)
- purity_m250 coverage (non-null): 69.9% (1678555/2399896)

| country | year | rows |
|---|---|---|
| AT | 2017 | 26725 |
| AT | 2018 | 26725 |
| AT | 2019 | 26725 |
| AT | 2020 | 26725 |
| AT | 2021 | 26725 |
| AT | 2022 | 26725 |
| AT | 2023 | 26725 |
| AT | 2024 | 26725 |
| BG | 2017 | 46615 |
| BG | 2018 | 46615 |
| BG | 2019 | 46615 |
| BG | 2020 | 46615 |
| BG | 2021 | 46615 |
| BG | 2022 | 46615 |
| BG | 2023 | 46615 |
| BG | 2024 | 46615 |
| HR | 2017 | 30324 |
| HR | 2018 | 30324 |
| HR | 2019 | 30324 |
| HR | 2020 | 30324 |
| HR | 2021 | 30324 |
| HR | 2022 | 30324 |
| HR | 2023 | 30324 |
| HR | 2024 | 30324 |
| HU | 2017 | 54743 |
| HU | 2018 | 54743 |
| HU | 2019 | 54743 |
| HU | 2020 | 54743 |
| HU | 2021 | 54743 |
| HU | 2022 | 54743 |
| HU | 2023 | 54743 |
| HU | 2024 | 54743 |
| RO | 2017 | 82916 |
| RO | 2018 | 82916 |
| RO | 2019 | 82916 |
| RO | 2020 | 82916 |
| RO | 2021 | 82916 |
| RO | 2022 | 82916 |
| RO | 2023 | 82916 |
| RO | 2024 | 82916 |
| RS | 2017 | 28108 |
| RS | 2018 | 28108 |
| RS | 2019 | 28108 |
| RS | 2020 | 28108 |
| RS | 2021 | 28108 |
| RS | 2022 | 28108 |
| RS | 2023 | 28108 |
| RS | 2024 | 28108 |
| SK | 2017 | 30556 |
| SK | 2018 | 30556 |
| SK | 2019 | 30556 |
| SK | 2020 | 30556 |
| SK | 2021 | 30556 |
| SK | 2022 | 30556 |
| SK | 2023 | 30556 |
| SK | 2024 | 30556 |

### strata_counts.parquet
- path: `data/interim/strata_counts.parquet`
- size: 4880 bytes (0.0 MiB)
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
