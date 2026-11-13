# data — owner: Bogdan

Datasets and fetch pipelines (`farm_data`). `raw/` (downloaded inputs) and `cache/` (derived
outputs) are gitignored. Sources and licences: README "Data sources".

**Just want the data?** The built outputs (feature table, zones, INS yields, POWER daily, MODIS
cube NDVI) are on the rolling `data-latest` pre-release. From the repo root:

```bash
gh release download data-latest -p field-signal-data.tar.gz -O - | tar -xz -C data
```

Republish after a rebuild with `sh data/scripts/pack.sh`.

```bash
uv sync --all-packages

# one point, any dates (POWER + ET0, MODIS via ORNL, SMAP via AppEEARS, SoilGrids)
uv run python data/scripts/fetch_point.py --lat 46.30 --lon 23.75 --start 2015-01-01 --end 2025-12-31

# the whole pilot feature table -> data/cache/features/{field,commune,county}.parquet
uv run --package farm-data python data/scripts/build_features.py            # waits for AppEEARS
uv run --package farm-data python data/scripts/build_features.py --no-wait  # NDVI/SMAP null until done
```

Pilot zones: 8 counties (AB, AR, BH, CJ, HD, MS, SB, VL), the 40 Alba communes with arable land
nearest the Aiud–Sântimbru midpoint, and the demo field: 49 zones, 121 cropland sample points.

NDVI source per zone: AppEEARS MODIS (250 m, QA-screened) for points its task covers, the local
MODIS cube (0.01°, ~1 km, no QA layer, so `ndvi_usable_share` is null) for every other point.
The AppEEARS tasks cover the earlier 81 points and are still pending, so today every zone uses the cube.
`ndvi_peak` is null unless usable composites cover ≥ 75 % of the crop's flowering window. The cube
has no composites for tile h19v04 from 2025-06-26 to 2025-11-17, so 2025 maize, soybean and
sunflower peaks are null.

One-time raw inputs before `build_features.py`:

| Input | Command | Lands in |
|---|---|---|
| GISCO NUTS 2024 + LAU 2024 (RO) | download the GeoPackages from Eurostat GISCO | `raw/boundaries/NUTS_2024.gpkg`, `LAU_2024.gpkg` |
| EUCROPMAP 2018, 2022 (pilot bbox) | `python -m farm_data.cropmap` | `raw/eucropmap/` |
| SoilGrids 0–30 cm (pilot bbox) | `python -m farm_data.soil` | `raw/soilgrids/` |
| INS TEMPO AGR108A/109A/110A | `python -m farm_data.ins` | `raw/ins_tempo/` |
| AppEEARS point tasks | `python -m farm_data.appeears submit`, then `status`, `fetch` | `cache/appeears/` |
| MODIS VI cube at the points (after `cache/zones/` exists) | `python -m farm_data.modis_cube <cube_dir>` (one NetCDF per year, see the module docstring) | `cache/modis_cube/` |

Earthdata credentials (AppEEARS): `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` in the repo-root
`.env` or the environment, or a `urs.earthdata.nasa.gov` entry in `~/.netrc`.

Modules (`src/farm_data/`): `zones` (pilot zones + sample points), `power`, `appeears`, `soil`,
`cropmap`, `ins`, `modis_cube`, `features` (the table in `contracts/README.md` §1), `crops` (`crops.toml`).
