"""FROZEN data contract for the crop-rotation pipeline. Do not change silently.

Raw datasets live in data/raw/<dataset>/part-*.parquet in long format.
Core tables live in data/interim/: points.parquet, crops.parquet,
strata_counts.parquet.

Long format is point_id, date_or_year, variable, value. Exception: power and
smap_sm are keyed by cell_id instead of point_id (POWER's 0.5 x 0.625 degree
cell for power, SMAP's 9 km EASE-Grid 2.0 cell for smap_sm); all other
columns are identical. date_or_year is YYYY-MM-DD for daily/16-day/monthly
data, YYYY for annual data, and "" for static variables.

crops.confidence and crops.purity_m250 are nullable; writers must use pandas
nullable dtypes (UInt8 / Float32) so NA survives the parquet round-trip.
"""

DATASETS = (
    "embedding",
    "eucropmap",
    "modis_ndvi",
    "modis_qa",
    "hls_ndvi",
    "smap_sm",
    "soilgrids",
    "srtm",
    "power",
)

FLAGS = ("none", "low_confidence", "non_crop", "outside", "no_data")

POINTS_COLUMNS = {
    "point_id": "str",
    "lon": "float64",
    "lat": "float64",
    "country": "str",  # ISO2, uppercase
    "nuts3": "str",
    "county": "str",  # RO county name, "" outside RO
    "holdout": "bool",
    "cell_id": "str",  # POWER cell, may be "" until step 4
    "modal_crop": "str",
    "inclusion_probability": "float64",
}

CROPS_COLUMNS = {
    "point_id": "str",
    "year": "int16",
    "crop": "str",
    "confidence": "uint8",  # nullable
    "purity_m250": "float32",  # nullable
    "flags": "str",  # FLAGS, pipe-separated, "none" when clean
}

STRATA_COLUMNS = {
    "country": "str",
    "crop": "str",
    "n_eligible": "int64",
    "quota": "int64",
    "sampled": "int64",
    "shortfall": "int64",
}

LONG_COLUMNS = {
    "point_id": "str",
    "date_or_year": "str",
    "variable": "str",
    "value": "float32",
}

LONG_COLUMNS_CELL = {
    "cell_id": "str",
    "date_or_year": "str",
    "variable": "str",
    "value": "float32",
}

CELL_KEYED_DATASETS = ("power", "smap_sm")

TARGET_CROPS = (
    "wheat",
    "barley",
    "maize",
    "sunflower",
    "soybeans",
    "dry_pulses",
    "rapeseed",
)

OTHER_ARABLE = ["other"]

# HRL CTY integer code -> crop name.
CROP_CODE_MAP = {
    1110: "wheat",
    1120: "barley",
    1130: "maize",
    1140: "other",
    1150: "other",
    1210: "other",
    1220: "dry_pulses",
    1310: "other",
    1320: "other",
    1410: "sunflower",
    1420: "soybeans",
    1430: "rapeseed",
    1440: "other",
    3100: "other",
}

# No cropland, outside, permanent crops.
# No cropland, outside, permanent crops. 3200 ("unclassified permanent crop")
# appears from 2017 on; it is not arable, so it is excluded rather than "other".
EXCLUDED_CODES = {0, 65535, 2100, 2200, 2310, 2320, 3200}

# Verified 2026-11-13 against Eurostat Nuts2json NUTS 2021 level 3
# (eurostat/Nuts2json pub/v2/2021/4326/60M/nutsrg_3.json): id -> name.
HOLDOUT_NUTS3 = {
    "RO121": "Alba",
    "RO113": "Cluj",
    "RO125": "Mureș",
    "RO126": "Sibiu",
    "RO423": "Hunedoara",
}

HRL_YEARS = list(range(2017, 2025))
CTYCL_SENTINELS = (253, 255)
CTY_SENTINELS = (0, 65535)

assert set(CROP_CODE_MAP.values()) <= set(TARGET_CROPS) | set(OTHER_ARABLE)

# SMAP SPL4SMGP masks sm_rootzone over water. This 9 km cell holds the islet of
# Palagruza (2 points, SRTM elevation 17 m) but sits outside SMAP's land mask:
# every 10-day mean is null there, verified 2026-11-14 at the points and over
# open water in the same cell. Recorded, never imputed.
SMAP_UNCOVERED_CELLS = {"E174N548"}
