"""Cross the supply table into the two static files the Buyers › Region map reads.

    venv/bin/python code/export_web_outlook.py

Writes apps/web/public/data/yield-outlook.json (per year, crop and NUTS3 zone: p10/p50/p90 and the
zone's historical normal) and apps/web/public/data/nuts3.geojson (GISCO NUTS3 borders, 20M).
"""

import json
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WEB_DATA = ROOT.parent / "apps" / "web" / "public" / "data"
CROPS = ("wheat", "barley", "maize", "rapeseed", "sunflower", "soybeans", "dry_pulses")
# The forecast years, one block each. Falls back to the single-year table, duplicated, if the
# forecast file is not there yet.
FORECAST = "supply_table_2027_2028.csv"
FALLBACK = "supply_table.csv"
YEARS = (2027, 2028)
NUTS_URL = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2021_4326_LEVL_{}.geojson"


def normal_yield(crop: str, nuts2: str) -> float:
    means = json.loads((ROOT / "models" / f"yield_{crop}_region_means.json").read_text())
    return means["regions"].get(nuts2, means["fallback"])["yield_t_ha"]


def outlook() -> dict:
    supply = ROOT / "data" / "supply"
    forecast = supply / FORECAST
    table = pd.read_csv(forecast if forecast.exists() else supply / FALLBACK)
    # Every crop the table has, in the order above; a crop the table adds goes last.
    present = set(table["crop"].unique())
    crops = [c for c in CROPS if c in present] + sorted(present - set(CROPS))
    assert present <= set(crops), f"crop missing from the export: {present - set(crops)}"
    years = [int(y) for y in sorted(table["year"].unique())] if "year" in table else list(YEARS)
    zones = {zone: zone for zone in table["nuts3"].unique()}  # names filled in from the borders
    values: dict[str, dict[str, dict[str, list[float]]]] = {}
    for year in years:
        values[str(year)] = {}
        for crop in crops:
            rows = table[(table.crop == crop) & (table.year == year)] if "year" in table else table[table.crop == crop]
            values[str(year)][crop] = {
                row.nuts3: [
                    round(row.yield_p10, 2),
                    round(row.yield_p50, 2),
                    round(row.yield_p90, 2),
                    round(normal_yield(crop, row.nuts2), 2),
                ]
                for row in rows.itertuples()
            }
    return {"years": years, "crops": crops, "zones": zones, "values": values}


def gisco(level: int) -> list[dict]:
    with urllib.request.urlopen(NUTS_URL.format(level)) as response:
        source = json.load(response)
    return [f for f in source["features"] if f["properties"]["LEVL_CODE"] == level]


def borders(zone_ids: set[str]) -> dict:
    features = [
        {
            "type": "Feature",
            "properties": {"id": f["properties"]["NUTS_ID"], "name": f["properties"]["NAME_LATN"]},
            "geometry": f["geometry"],
        }
        for f in gisco(3)
        if f["properties"]["NUTS_ID"] in zone_ids
    ]
    missing = zone_ids - {f["properties"]["id"] for f in features}
    assert not missing, f"no border for {sorted(missing)}"
    return {"type": "FeatureCollection", "features": features}


def countries(zone_ids: set[str]) -> dict:
    """The countries the zones are in, so their shared lines stand out from the zone lines."""
    codes = {zone[:2] for zone in zone_ids}
    features = [
        {
            "type": "Feature",
            "properties": {"id": f["properties"]["NUTS_ID"], "name": f["properties"]["NAME_LATN"]},
            "geometry": f["geometry"],
        }
        for f in gisco(0)
        if f["properties"]["NUTS_ID"] in codes
    ]
    assert len(features) == len(codes), f"countries missing: {codes - {f['properties']['id'] for f in features}}"
    return {"type": "FeatureCollection", "features": features}


if __name__ == "__main__":
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    data = outlook()
    map_data = borders(set(data["zones"]))
    data["zones"] = {f["properties"]["id"]: f["properties"]["name"] for f in map_data["features"]}
    (WEB_DATA / "yield-outlook.json").write_text(json.dumps(data, separators=(",", ":")))
    (WEB_DATA / "nuts3.geojson").write_text(json.dumps(map_data, separators=(",", ":")))
    (WEB_DATA / "countries.geojson").write_text(json.dumps(countries(set(data["zones"])), separators=(",", ":")))
    print(f"{len(data['zones'])} zones, {len(data['years'])} years, {(WEB_DATA / 'yield-outlook.json').stat().st_size // 1024} KiB")
