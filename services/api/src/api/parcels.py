"""APIA parcels: the outlines farmers declared to APIA, so a farmer can tap their parcel.

The data are APIA's open LPIS layer of parcels declared in the 2025 single applications
(data.gov.ro, CC BY 4.0). `data/scripts/build_apia_parcels.py` turns it into a small SQLite
file with an R-tree index; this module only reads that file. Without the file the endpoint
answers 404 and the web app falls back to drawing by hand.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path
from typing import Any

import shapely  # type: ignore[import-untyped]
from fastapi import APIRouter, HTTPException, Query

from api.contracts import LatLon, MergedParcels, Parcel, ParcelCollection, ParcelMergeRequest
from api.settings import get_settings

router = APIRouter(prefix="/v1/parcels", tags=["farmer"])

SOURCE = "APIA LPIS 2025 (data.gov.ro, CC BY 4.0)"
# A phone screen at field zoom is about 0.03 degrees across; this leaves room for a laptop.
MAX_SPAN_DEG = 0.08
MAX_PARCELS = 2500
# Neighbouring strips are often split by a farm track or an unfarmed edge. Joining grows each
# parcel by GAP_M and shrinks the result back, which closes gaps up to about twice that (16 m).
GAP_M = 8.0
MAX_CORNERS = 500


ParcelRow = tuple[int, float, str | None, list[tuple[float, float]], dict[str, Any] | None]
"""id, declared area in ha, land-use code, outer ring as (lon, lat) without the closing point,
and extra info: {"crop_history": [ParcelCrop...], "soil": ParcelSoil} as plain dicts, or None."""


def write_db(path: Path, rows: Iterable[ParcelRow]) -> int:
    """Write the parcels file the API reads. Returns the number of parcels written."""
    path.unlink(missing_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE parcels (
            id INTEGER PRIMARY KEY, area_ha REAL NOT NULL, land_use TEXT, coords TEXT NOT NULL,
            info TEXT
        );
        CREATE VIRTUAL TABLE parcels_idx USING rtree(id, min_lon, max_lon, min_lat, max_lat);
        """
    )
    count = 0
    for pid, area, land_use, ring, info in rows:
        lons = [lon for lon, _ in ring]
        lats = [lat for _, lat in ring]
        conn.execute(
            "INSERT INTO parcels VALUES (?, ?, ?, ?, ?)",
            (
                pid,
                area,
                land_use,
                json.dumps(ring, separators=(",", ":")),
                json.dumps(info, separators=(",", ":")) if info else None,
            ),
        )
        conn.execute(
            "INSERT INTO parcels_idx VALUES (?, ?, ?, ?, ?)",
            (pid, min(lons), max(lons), min(lats), max(lats)),
        )
        count += 1
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    return count


@lru_cache
def _connect(path: Path) -> sqlite3.Connection:
    # Read-only and shared across requests: the file never changes while the API runs.
    conn = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True, check_same_thread=False)
    return conn


@lru_cache
def _has_info(conn: sqlite3.Connection) -> bool:
    return any(col[1] == "info" for col in conn.execute("PRAGMA table_info(parcels)"))


def _info_column(conn: sqlite3.Connection) -> str:
    """Files built before crop history and soil were added have no `info` column."""
    return "p.info" if _has_info(conn) else "NULL"


def to_parcel(row: tuple[Any, ...]) -> Parcel:
    """A parcel from a (id, area_ha, land_use, coords, info) row."""
    pid, area, land_use, coords, info = row
    extra = json.loads(info) if info else {}
    return Parcel(
        id=pid,
        area_ha=round(area, 2),
        land_use=land_use,
        boundary=[LatLon(lon=lon, lat=lat) for lon, lat in json.loads(coords)],
        crop_history=extra.get("crop_history", []),
        soil=extra.get("soil"),
    )


def parcels_by_id(conn: sqlite3.Connection, ids: list[int]) -> list[Parcel]:
    marks = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT p.id, p.area_ha, p.land_use, p.coords, {_info_column(conn)} "
        f"FROM parcels AS p WHERE p.id IN ({marks})",
        ids,
    ).fetchall()
    return [to_parcel(row) for row in rows]


def db() -> sqlite3.Connection:
    """The parcels file, read-only. 404 when this deployment has none."""
    path = get_settings().parcels_path
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Parcel outlines are not available here.")
    return _connect(path)


def parcels_in(
    conn: sqlite3.Connection, west: float, south: float, east: float, north: float
) -> ParcelCollection:
    rows = conn.execute(
        f"""
        SELECT p.id, p.area_ha, p.land_use, p.coords, {_info_column(conn)}
        FROM parcels_idx AS i JOIN parcels AS p ON p.id = i.id
        WHERE i.max_lon >= ? AND i.min_lon <= ? AND i.max_lat >= ? AND i.min_lat <= ?
        LIMIT ?
        """,
        (west, east, south, north, MAX_PARCELS + 1),
    ).fetchall()
    parcels = [to_parcel(row) for row in rows[:MAX_PARCELS]]
    return ParcelCollection(parcels=parcels, truncated=len(rows) > MAX_PARCELS, source=SOURCE)


@router.get("")
def list_parcels(
    west: float = Query(ge=-180, le=180),
    south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90),
) -> ParcelCollection:
    """Declared parcels that touch the box: only a small box, about one screen at field zoom."""
    if east <= west or north <= south:
        raise HTTPException(status_code=422, detail="The box is empty.")
    if east - west > MAX_SPAN_DEG or north - south > MAX_SPAN_DEG:
        raise HTTPException(status_code=422, detail="Zoom in to see parcels.")
    return parcels_in(db(), west, south, east, north)


def merge(conn: sqlite3.Connection, ids: list[int]) -> MergedParcels:
    """Join parcels into one outline. 422 when they do not touch, so they cannot be one field."""
    unique = sorted(set(ids))
    marks = ",".join("?" * len(unique))
    rows = conn.execute(
        f"SELECT id, area_ha, coords FROM parcels WHERE id IN ({marks})", unique
    ).fetchall()
    if len(rows) != len(unique):
        raise HTTPException(status_code=404, detail="Some parcels were not found.")
    rings = [json.loads(coords) for _, _, coords in rows]
    # A local metric frame (metres) around the parcels, so the gap and simplification are in metres.
    lat0 = sum(lat for ring in rings for _, lat in ring) / sum(len(ring) for ring in rings)
    kx, ky = 111_320 * math.cos(math.radians(lat0)), 110_540
    polygons = [
        shapely.Polygon([(lon * kx, lat * ky) for lon, lat in ring]).buffer(0) for ring in rings
    ]
    joined = shapely.union_all([p.buffer(GAP_M, join_style="mitre") for p in polygons]).buffer(
        -GAP_M, join_style="mitre"
    )
    if not isinstance(joined, shapely.Polygon):
        raise HTTPException(status_code=422, detail="not_touching")
    outline = shapely.Polygon(joined.exterior)
    tolerance = 1.0
    simple = outline.simplify(tolerance, preserve_topology=True)
    while len(simple.exterior.coords) - 1 > MAX_CORNERS:
        tolerance *= 2
        simple = outline.simplify(tolerance, preserve_topology=True)
    boundary = [
        LatLon(lon=round(x / kx, 6), lat=round(y / ky, 6))
        for x, y in list(simple.exterior.coords)[:-1]
    ]
    return MergedParcels(
        boundary=boundary,
        area_ha=round(sum(area for _, area, _ in rows), 2),
        parcel_ids=unique,
    )


@router.post("/merge")
def merge_parcels(body: ParcelMergeRequest) -> MergedParcels:
    """Join the parcels a farmer tapped into one field outline."""
    return merge(db(), list(body.ids))
