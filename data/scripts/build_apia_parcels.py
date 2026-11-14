"""Build the parcel file for "tap your parcel" from APIA's open LPIS layer.

Input: the parcels declared to APIA in the 2025 single applications (data.gov.ro, CC BY 4.0),
https://data.gov.ro/dataset/parcele_agricole_agionline_apia — download the zip (1.6 GB), then:

    uv run --all-packages python data/scripts/build_apia_parcels.py \
        path/to/parcele_fermieri_apia_agi_online.zip

Output: services/api/parcels/apia_parcels_alba.sqlite, read by the API (api.parcels). Publish it
for the deploy with:

    gh release create apia-parcels-2025 services/api/parcels/apia_parcels_alba.sqlite  # first time
    gh release upload apia-parcels-2025 services/api/parcels/apia_parcels_alba.sqlite --clobber
"""

from __future__ import annotations

import argparse
from collections.abc import Iterator
from pathlib import Path

import pyogrio
import shapely
from pyproj import Transformer

from api.parcels import ParcelRow, write_db

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "services" / "api" / "parcels" / "apia_parcels_alba.sqlite"

# The layer says "Dealul Piscului 1970 / Stereo 70" but carries no datum shift, which would put
# every outline 100 m or more off. EPSG:3844 is the same projection with the official shift.
SOURCE_CRS = "EPSG:3844"
# Outlines are simplified by up to this many metres (in Stereo 70, before reprojecting).
SIMPLIFY_M = 1.0
# The API and saved fields accept at most 500 corners.
MAX_CORNERS = 500
# Five decimals is about 1 m: plenty for a field outline, and it halves the file.
DECIMALS = 5


def outer_ring(geom: shapely.Geometry) -> list[tuple[float, float]] | None:
    """The largest polygon's outer ring, simplified, without the closing point."""
    if isinstance(geom, shapely.MultiPolygon):
        geom = max(geom.geoms, key=lambda g: g.area)
    if not isinstance(geom, shapely.Polygon) or geom.is_empty:
        return None
    ring = shapely.Polygon(geom.exterior)
    tolerance = SIMPLIFY_M
    simple = ring.simplify(tolerance, preserve_topology=True)
    while len(simple.exterior.coords) - 1 > MAX_CORNERS:
        tolerance *= 2
        simple = ring.simplify(tolerance, preserve_topology=True)
    coords = list(simple.exterior.coords)[:-1]
    return coords if len(coords) >= 3 else None


def rows(source: str, county: str) -> Iterator[ParcelRow]:
    # The filtered column must be read too, or the shapefile driver returns nothing.
    df = pyogrio.read_dataframe(
        source, where=f"jud = '{county}'", columns=["gid", "cat_use", "area", "jud"]
    )
    print(f"{len(df):,} parcels in {county}")
    to_wgs84 = Transformer.from_crs(SOURCE_CRS, "EPSG:4326", always_xy=True)
    for gid, land_use, area, geom in zip(
        df["gid"], df["cat_use"], df["area"], df.geometry, strict=True
    ):
        ring = outer_ring(geom)
        if ring is None:
            continue
        xs, ys = zip(*ring, strict=True)
        lons, lats = to_wgs84.transform(xs, ys)
        yield (
            int(gid),
            float(area),
            str(land_use) if land_use else None,
            [
                (round(lon, DECIMALS), round(lat, DECIMALS))
                for lon, lat in zip(lons, lats, strict=True)
            ],
            None,
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("zip", type=Path, help="the data.gov.ro zip (or the unzipped .shp)")
    parser.add_argument("--county", default="AB", help="county code, AB for Alba")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    path = args.zip.resolve()
    source = f"/vsizip/{path}" if path.suffix == ".zip" else str(path)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    count = write_db(args.out, rows(source, args.county))
    size_mb = args.out.stat().st_size / 1e6
    print(f"wrote {count:,} parcels to {args.out.relative_to(REPO_ROOT)} ({size_mb:.0f} MB)")


if __name__ == "__main__":
    main()
