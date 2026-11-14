"""Make two DEMO "AGI Online" farm exports (a big and a small farm in Alba) for the upload flow.

The real AGI Online export format is not public, so this is a plausible guess, not a copy: a
zipped ESRI shapefile in Stereo 70 (EPSG:3844), one polygon per declared parcel, with:

    nr_parcela  parcel number in the farm, 1..n
    bloc_fizic  physical block id, made up ("DEMO-<commune>-<n>"), not a real LPIS block
    cultura     crop declared for 2025, Romanian name (porumb, grâu, floarea-soarelui, ...)
    cod_cult    crop code, left empty on purpose: we do not invent APIA crop codes
                ("cod_cultura" is 11 characters, over the 10 a shapefile column allows)
    suprafata   area in ha, 2 decimals (the parcel's declared APIA area)

Geometry and areas are REAL APIA parcel outlines (2025 declarations, data.gov.ro, CC BY 4.0), so
they line up with the "tap your parcel" layer; which parcels belong together, the crops and the
block ids are invented. Deterministic (fixed seed). Input is the same zip as
build_apia_parcels.py:

    uv run --all-packages python data/scripts/make_mock_farm_export.py \
        path/to/parcele_fermieri_apia_agi_online.zip

Writes apps/web/public/samples/ferma-{mare,mica}-agi-online-demo.zip.
"""

from __future__ import annotations

import argparse
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pyogrio
import shapely
from pyproj import Transformer

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "apps" / "web" / "public" / "samples"
CRS = "EPSG:3844"  # see build_apia_parcels.py: the layer's own CRS lacks the datum shift
SEED = 2025
# Arable land east of Aiud, the app's demo field (farm_data.zones.DEMO_FIELD).
CENTRE = (46.30, 23.75)
ARABLE = ("TA", "TAn")
# Big farm: three clusters of neighbouring strips (target ha each) plus a few scattered parcels.
CLUSTER_HA = (170.0, 110.0, 60.0)
SCATTERED = 14
NEAR_M = 40.0  # parcels this close count as neighbours (tracks, hedges, unfarmed edges)
MIN_HA = 1.0  # smallest parcel a big farm takes
BLOCK_M = 450.0  # crops are planted in blocks of about this size
CROPS = ("porumb", "grâu", "floarea-soarelui", "orz", "soia", "rapiță")
CROP_WEIGHTS = (0.32, 0.26, 0.18, 0.1, 0.08, 0.06)

README = """\
DEMO DATA - not a real farmer's export.

{title}: {n} parcels, {ha:.2f} ha, Alba county.

Parcel outlines and areas are real public APIA parcels (2025 single-application declarations,
data.gov.ro, "Parcele agricole AGI Online APIA", CC BY 4.0). Which parcels form this farm, the
2025 crops (cultura) and the physical block ids (bloc_fizic) are made up. The crop code column
(cod_cult) is deliberately empty. The real AGI Online export format is not public; this file
only imitates its likely shape: an ESRI shapefile in Stereo 70 (EPSG:3844).

Made by data/scripts/make_mock_farm_export.py (Field Signal).
"""


def load(source: str) -> gpd.GeoDataFrame:
    df = pyogrio.read_dataframe(
        source, where="jud = 'AB'", columns=["gid", "sirsup_cod", "cat_use", "area", "jud"]
    )
    df = df.set_crs(CRS, allow_override=True)
    df = df[df["cat_use"].isin(ARABLE) & df.geometry.notna()].reset_index(drop=True)
    df["geometry"] = shapely.make_valid(df.geometry.values)
    return df[df.geom_type.isin(["Polygon", "MultiPolygon"])].reset_index(drop=True)


def centre_xy() -> tuple[float, float]:
    x, y = Transformer.from_crs("EPSG:4326", CRS, always_xy=True).transform(CENTRE[1], CENTRE[0])
    return float(x), float(y)


def grow(df: gpd.GeoDataFrame, tree: shapely.STRtree, seed: int, target_ha: float, taken: set):
    """Breadth-first over touching parcels from `seed` until the cluster reaches `target_ha`."""
    cluster, queue, ha = [], [seed], 0.0
    seen = {seed}
    while queue and ha < target_ha:
        i = queue.pop(0)
        if i in taken:
            continue
        cluster.append(i)
        ha += df.at[i, "area"]
        near = tree.query(df.geometry.iat[i], predicate="dwithin", distance=NEAR_M)
        # Nearest first keeps the cluster compact.
        d = shapely.distance(df.geometry.values[near], df.geometry.iat[i].centroid)
        for j in near[np.argsort(d)]:
            if j not in seen and j in df.index:
                seen.add(j)
                queue.append(int(j))
    return cluster, ha


def big_farm(df: gpd.GeoDataFrame, rng: np.random.Generator) -> gpd.GeoDataFrame:
    cx, cy = centre_xy()
    home = df.loc[df.distance(shapely.Point(cx, cy)).idxmin(), "sirsup_cod"]
    # The neighbouring commune with most arable parcels within 6 km of the centre.
    near = df[df.distance(shapely.Point(cx, cy)) < 6000]
    other = near[near["sirsup_cod"] != home]["sirsup_cod"].value_counts().index[0]
    # A big farm works the larger strips: arable parcels of MIN_HA-12 ha in the two communes.
    pool = df[df["sirsup_cod"].isin([home, other]) & df["area"].between(MIN_HA, 12.0)]
    pool = pool.reset_index(drop=True)
    tree = shapely.STRtree(pool.geometry.values)
    dist = pool.distance(shapely.Point(cx, cy)).to_numpy()
    taken: set[int] = set()
    clusters = []
    seeds_xy: list[shapely.Point] = []
    for k, target in enumerate(CLUSTER_HA):
        commune = other if k == 1 else home
        cand = np.nonzero((pool["sirsup_cod"] == commune).to_numpy() & (dist < 7000))[0]
        best: tuple[list[int], float] = ([], 0.0)
        for i in rng.permutation(cand)[:400]:
            c = pool.geometry.iat[i].centroid
            if i in taken or any(c.distance(s) < 2500 for s in seeds_xy):
                continue
            cluster, ha = grow(pool, tree, int(i), target, taken)
            if ha > best[1]:
                best = (cluster, ha)
            if ha >= 0.9 * target:
                break
        cluster = best[0]
        clusters.append(cluster)
        taken.update(cluster)
        seeds_xy.append(pool.geometry.iat[cluster[0]].centroid)
    rest = np.nonzero((dist < 6000) & ~pool.index.isin(list(taken)))[0]
    scattered = [int(i) for i in rng.choice(rest, SCATTERED, replace=False)]
    farm = pool.iloc[[i for c in clusters for i in c] + scattered].copy()
    farm["group"] = [k for k, c in enumerate(clusters) for _ in c] + [len(clusters)] * SCATTERED
    return farm


def small_farm(df: gpd.GeoDataFrame, rng: np.random.Generator) -> gpd.GeoDataFrame:
    """Six scattered small strips (0.4-1 ha) within 4 km of the centre, about 4 ha in all."""
    cx, cy = centre_xy()
    pool = df[df.distance(shapely.Point(cx, cy)) < 4000]
    pool = pool[pool["area"].between(0.4, 1.0)]
    while True:
        pick = pool.iloc[rng.choice(len(pool), 6, replace=False)]
        cents = pick.geometry.centroid.values
        apart = min(a.distance(b) for i, a in enumerate(cents) for b in cents[i + 1 :])
        if 3.6 <= pick["area"].sum() <= 4.4 and apart > 300:
            farm = pick.copy()
            farm["group"] = 0
            return farm


def assign(farm: gpd.GeoDataFrame, rng: np.random.Generator) -> gpd.GeoDataFrame:
    """Crop per ~BLOCK_M block (neighbouring strips share a crop), a few odd ones out."""
    c = farm.geometry.centroid
    cell = list(
        zip(np.floor(c.x / BLOCK_M).astype(int), np.floor(c.y / BLOCK_M).astype(int), strict=True)
    )
    cells = sorted(set(cell))
    crop_of = {k: rng.choice(CROPS, p=CROP_WEIGHTS) for k in cells}
    block_of = {k: n + 1 for n, k in enumerate(cells)}
    crops = [
        str(rng.choice(CROPS, p=CROP_WEIGHTS)) if rng.random() < 0.08 else str(crop_of[k])
        for k in cell
    ]
    commune = farm["sirsup_cod"].to_numpy()
    farm = farm.assign(
        _x=c.x.round(-2), _cell=[block_of[k] for k in cell], cultura=crops, sirsup=commune
    )
    farm = farm.sort_values(["group", "_cell", "_x"]).reset_index(drop=True)
    return gpd.GeoDataFrame(
        {
            "nr_parcela": np.arange(1, len(farm) + 1, dtype="int32"),
            "bloc_fizic": [
                f"DEMO-{s}-{b:03d}" for s, b in zip(farm.sirsup, farm._cell, strict=True)
            ],
            "cultura": farm["cultura"],
            "cod_cult": "",
            "suprafata": farm["area"].round(2),
        },
        geometry=farm.geometry.values,
        crs=CRS,
    )


def write_zip(farm: gpd.GeoDataFrame, name: str, title: str) -> Path:
    out = OUT_DIR / f"{name}.zip"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stem = name.replace("-", "_")
    with tempfile.TemporaryDirectory() as tmp:
        shp = Path(tmp) / f"{stem}.shp"
        pyogrio.write_dataframe(farm, shp, encoding="UTF-8")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(Path(tmp).iterdir()):
                z.write(f, f.name)
            z.writestr(
                "README.txt",
                README.format(title=title, n=len(farm), ha=farm["suprafata"].sum()),
            )
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("zip", type=Path, help="the data.gov.ro zip (or the unzipped .shp)")
    args = parser.parse_args()
    path = args.zip.resolve()
    df = load(f"/vsizip/{path}" if path.suffix == ".zip" else str(path))
    print(f"{len(df):,} arable parcels in Alba")
    for name, title, make in (
        ("ferma-mare-agi-online-demo", "Ferma mare (demo)", big_farm),
        ("ferma-mica-agi-online-demo", "Ferma mica (demo)", small_farm),
    ):
        rng = np.random.default_rng(SEED)
        farm = assign(make(df, rng), rng)
        out = write_zip(farm, name, title)
        crops = farm.groupby("cultura")["suprafata"].sum().round(1).to_dict()
        print(
            f"{out.relative_to(REPO_ROOT)}: {len(farm)} parcels, {farm['suprafata'].sum():.1f} ha,"
            f" {out.stat().st_size / 1e3:.0f} kB, {crops}"
        )


if __name__ == "__main__":
    main()
