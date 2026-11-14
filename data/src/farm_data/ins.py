"""INS TEMPO county crop statistics, 1990-2025 → tidy parquet.

Tables (Institutul Național de Statistică, TEMPO Online, http://statistici.insse.ro:8077/tempo-online/):
- AGR108A cultivated area (ha), AGR109A production (t), AGR110A average yield (kg/ha),
  by main crop x ownership form (we keep "Total") x county x year.
Terms: see README Data sources.

    uv run --package farm-data python -m farm_data.ins   # -> data/cache/ins/county_yields.parquet

Columns: county (ISO 3166-2:RO code), county_name, year, crop (contract id), area_ha,
production_t, yield_t_ha (official AGR110A value / 1000). Missing county-years have no row.
"""

from __future__ import annotations

import csv
import io
import time

import pandas as pd
import requests

from farm_data import CACHE, RAW

TABLES = {"AGR108A": "area_ha", "AGR109A": "production_t", "AGR110A": "yield_kg_ha"}
TEMPO = "http://statistici.insse.ro:8077/tempo-ins"
CROPS = {  # INS label -> contract crop id
    "Porumb boabe": "maize",
    "Grau - total": "wheat",  # common + durum; "Grau comun" only from 1997
    "Orz si orzoaica": "barley",
    "Soia boabe": "soybean",
    "Floarea soarelui": "sunflower",
    "Mazare boabe": "pea",
}
COUNTIES = {
    "Alba": "AB", "Arad": "AR", "Arges": "AG", "Bacau": "BC", "Bihor": "BH",
    "Bistrita-Nasaud": "BN", "Botosani": "BT", "Braila": "BR", "Brasov": "BV", "Buzau": "BZ",
    "Calarasi": "CL", "Caras-Severin": "CS", "Cluj": "CJ", "Constanta": "CT", "Covasna": "CV",
    "Dambovita": "DB", "Dolj": "DJ", "Galati": "GL", "Giurgiu": "GR", "Gorj": "GJ",
    "Harghita": "HR", "Hunedoara": "HD", "Ialomita": "IL", "Iasi": "IS", "Ilfov": "IF",
    "Maramures": "MM", "Mehedinti": "MH", "Municipiul Bucuresti": "B", "Mures": "MS",
    "Neamt": "NT", "Olt": "OT", "Prahova": "PH", "Salaj": "SJ", "Satu Mare": "SM",
    "Sibiu": "SB", "Suceava": "SV", "Teleorman": "TR", "Timis": "TM", "Tulcea": "TL",
    "Vaslui": "VS", "Valcea": "VL", "Vrancea": "VN",
}  # fmt: skip
OUT = CACHE / "ins" / "county_yields.parquet"


def download(table: str) -> None:
    """Dump a whole TEMPO matrix to data/raw/ins_tempo/<table>.csv (no account). Queries one
    item of the first dimension (crop) at a time to keep each pivot request small."""
    out = RAW / "ins_tempo" / f"{table}.csv"
    if out.exists():
        return
    meta = requests.get(f"{TEMPO}/matrix/{table}", timeout=120).json()
    dims = [[str(o["nomItemId"]) for o in d["options"]] for d in meta["dimensionsMap"]]
    det = meta["details"]
    header: list[str] = []
    rows: list[list[str]] = []
    for first in dims[0]:
        body = {
            "language": "ro",
            "encQuery": ":".join([first] + [",".join(d) for d in dims[1:]]),
            "matCode": table,
            "matMaxDim": det["matMaxDim"],
            "matUMSpec": det["matUMSpec"],
            "matRegJ": det["matRegJ"],
        }
        r = requests.post(f"{TEMPO}/pivot", json=body, timeout=120)
        r.raise_for_status()
        header, *body_rows = list(csv.reader(io.StringIO(r.text)))
        rows += body_rows
        time.sleep(0.3)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out.with_suffix(".part"), "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([header, *rows])
    out.with_suffix(".part").rename(out)


def read(table: str) -> pd.DataFrame:
    """One TEMPO pivot CSV (see `download`) -> crop, county, year, value."""
    df = pd.read_csv(RAW / "ins_tempo" / f"{table}.csv", skipinitialspace=True)
    df.columns = ["crop", "ownership", "region", "year", "unit", "value"]
    df = df[(df["ownership"] == "Total") & df["crop"].isin(CROPS) & df["region"].isin(COUNTIES)]
    return pd.DataFrame(
        {
            "county": df["region"].map(COUNTIES),
            "county_name": df["region"],
            "year": df["year"].str.removeprefix("Anul ").astype(int),
            "crop": df["crop"].map(CROPS),
            TABLES[table]: pd.to_numeric(df["value"], errors="coerce"),
        }
    )


def build() -> pd.DataFrame:
    keys = ["county", "county_name", "year", "crop"]
    a, p, y = (read(t).set_index(keys) for t in TABLES)
    df = a.join(p, how="outer").join(y, how="outer").reset_index()
    df["yield_t_ha"] = (df.pop("yield_kg_ha") / 1000).round(3)
    return df.sort_values(keys, ignore_index=True)


if __name__ == "__main__":
    for t in TABLES:
        download(t)
    df = build()
    assert not df.duplicated(["county", "year", "crop"]).any()
    # official yield ≈ production / area (INS divides by harvested area, so allow 15%)
    ok = df.dropna()
    ratio = ok["production_t"] / ok["area_ha"] / ok["yield_t_ha"]
    print(f"yield vs production/area: median ratio {ratio.median():.3f}, "
          f"{(ratio.sub(1).abs() > 0.15).mean():.1%} rows off by >15%")  # fmt: skip
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT, index=False)
    print(
        f"{len(df)} rows, {df.county.nunique()} counties, {df.year.min()}-{df.year.max()} -> {OUT}"
    )
    print(
        df[df.county == "AB"].pivot_table(index="year", columns="crop", values="yield_t_ha").tail(6)
    )
