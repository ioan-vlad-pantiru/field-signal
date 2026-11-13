# data — owner: Bogdan

Datasets and fetch pipelines (`farm_data`). `raw/` (downloaded inputs) and `cache/` (derived
outputs) are gitignored. Sources and licences: README "Data sources".

**Just want the data?** The built outputs (feature table, zones, INS yields, POWER daily) are on
the rolling `data-latest` pre-release. From the repo root:

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

One-time raw inputs before `build_features.py`:

| Input | Command | Lands in |
|---|---|---|
| GISCO NUTS 2024 + LAU 2024 (RO) | download the GeoPackages from Eurostat GISCO | `raw/boundaries/NUTS_2024.gpkg`, `LAU_2024.gpkg` |
| EUCROPMAP 2018, 2022 (pilot bbox) | `python -m farm_data.cropmap` | `raw/eucropmap/` |
| SoilGrids 0–30 cm (pilot bbox) | `python -m farm_data.soil` | `raw/soilgrids/` |
| INS TEMPO AGR108A/109A/110A | `python -m farm_data.ins` | `raw/ins_tempo/` |
| AppEEARS point tasks | `python -m farm_data.appeears submit`, then `status`, `fetch` | `cache/appeears/` |

Earthdata credentials (AppEEARS): `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` in the repo-root
`.env` or the environment, or a `urs.earthdata.nasa.gov` entry in `~/.netrc`.

Modules (`src/farm_data/`): `zones` (pilot zones + sample points), `power`, `appeears`, `soil`,
`cropmap`, `ins`, `features` (the table in `contracts/README.md` §1), `crops` (`crops.toml`).
