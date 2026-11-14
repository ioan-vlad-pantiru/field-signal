#!/bin/sh
# Pack the derived pilot data and publish it as the rolling `data-latest` GitHub pre-release.
#
#   sh data/scripts/pack.sh                 # after build_features.py
#
# Teammates, from the repo root (restores data/cache/ so the code finds it):
#   gh release download data-latest -p field-signal-data.tar.gz -O - | tar -xz -C data
set -eu
cd "$(dirname "$0")/.."
tgz="$(mktemp -d)/field-signal-data.tar.gz"
# BSD (macOS) and GNU tar >= 1.27: -h follows symlinks (real files only); no owner names,
# extended attributes or macOS AppleDouble metadata (COPYFILE_DISABLE)
COPYFILE_DISABLE=1 tar -czhf "$tgz" --no-xattrs --numeric-owner \
  cache/features cache/zones cache/ins cache/power cache/modis_cube $(ls cache/appeears/*.parquet 2>/dev/null)

modis=$([ -f cache/appeears/modis.parquet ] && echo yes || echo "pending (ndvi_* from the local MODIS cube)")
smap=$([ -f cache/appeears/smap.parquet ] && echo yes || echo "pending (smap_* columns null)")
notes="Derived pilot data, built $(date -u +%Y-%m-%dT%H:%MZ) from $(git rev-parse --short HEAD).

| Path | What |
|---|---|
| cache/features/{field,commune,county}.parquet | Feature table, one row per zone x crop x season (contracts/README.md §1, FeatureRow) |
| cache/zones/{zones,points}.parquet | 49 pilot zones (8 counties, 40 Alba communes, demo field) and their 121 cropland sample points |
| cache/ins/county_yields.parquet | INS TEMPO county area, production, yield, 6 crops, 1990-2025 |
| cache/power/*.parquet | NASA POWER daily + FAO-56 ET0 per sample point, 1981-2025 |
| cache/modis_cube/modis.parquet | MODIS MOD13Q1/MYD13Q1 v061 NDVI/EVI per point from a local cube (Planetary Computer modis-13Q1-061): one pixel of about 463 m (2x overview), nearest pixel, no QA layer, 2001-2026; used where AppEEARS has no rows |
| cache/appeears/*.parquet | MODIS NDVI/EVI and SMAP L4 root-zone per point (when ready) |

MODIS: $modis. SMAP: $smap. This release is replaced as the AppEEARS tasks finish.

Install: \`gh release download data-latest -p field-signal-data.tar.gz -O - | tar -xz -C data\`

Sources and attribution: README \"Data sources\" (NASA POWER, MODIS, SMAP: NASA open data; SoilGrids: CC BY 4.0; EUCROPMAP: EC reuse notice (Commission Decision 2011/833/EU of 12 Dec 2011), acknowledge the source; INS TEMPO (Sursa: INS): terms: see README Data sources)."

if gh release view data-latest >/dev/null 2>&1; then
  gh release upload data-latest "$tgz" --clobber
  gh release edit data-latest --notes "$notes"
else
  gh release create data-latest "$tgz" --prerelease --target "$(git rev-parse --abbrev-ref HEAD)" \
    --title "Pilot data (rolling)" --notes "$notes"
fi
ls -l "$tgz"
