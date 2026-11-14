"""A whole farm: import a parcel file, match it to the APIA layer, and suggest fields.

- Import: the farmer uploads the parcel file exported from AGI Online (or any zipped shapefile,
  GeoJSON or KML). Each outline is matched to the APIA parcels it overlaps, so the farm is made of
  the same parcels the map shows and keeps their crop history and soil.
- Re-match: next year APIA publishes a new layer and parcel ids can change; saved outlines are
  matched to the new layer by overlap, the same way.
- Suggest: parcels farmed together usually touch and had the same crops; they are grouped into
  suggested fields the farmer can change. A field's parcels need not touch.
"""

from __future__ import annotations

import json
import math
import sqlite3
import tempfile
import zipfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pyogrio  # type: ignore[import-untyped]
import shapely  # type: ignore[import-untyped]
from fastapi import APIRouter, HTTPException, Query, Request
from pyproj import CRS, Transformer

from api.contracts import (
    FarmImport,
    FarmSuggestion,
    FarmSuggestRequest,
    LatLon,
    Localized,
    Parcel,
    SuggestedField,
)
from api.parcels import db, parcels_by_id

router = APIRouter(prefix="/v1/farm", tags=["farmer"])

MAX_UPLOAD_BYTES = 20_000_000
MAX_OUTLINES = 3000
# An APIA parcel belongs to an uploaded outline when this share of one lies inside the other.
MIN_OVERLAP = 0.5
# Parcels this close (m) count as neighbours: strips split by a farm track.
NEIGHBOUR_M = 16.0
# Parcels with the same crops this close (m) are suggested as one field even if they do not touch.
SAME_CROPS_M = 500.0
# Suggested fields smaller than this (ha) join the nearest field.
MIN_FIELD_HA = 1.0
# A mapped crop counts only when it covers this share of the parcel.
MIN_CROP_SHARE = 0.5
STEREO_70 = "EPSG:3844"


# --------------------------------------------------------------------------- geometry helpers


@dataclass(frozen=True)
class Frame:
    """A local metric frame (metres) around a latitude; accurate to well under 1% over a farm."""

    kx: float
    ky: float

    @classmethod
    def at(cls, lat: float) -> Frame:
        return cls(kx=111_320 * math.cos(math.radians(lat)), ky=110_540)

    def polygon(self, ring: Iterable[tuple[float, float]]) -> Any:
        return shapely.Polygon([(lon * self.kx, lat * self.ky) for lon, lat in ring]).buffer(0)


def _ring(parcel: Parcel) -> list[tuple[float, float]]:
    return [(c.lon, c.lat) for c in parcel.boundary]


def _source_crs(info: dict[str, Any], default: str) -> str:
    """APIA files say "Dealul Piscului 1970 / Stereo 70" without the datum shift: use EPSG:3844."""
    wkt = info.get("crs")
    if not wkt:
        return default
    crs = CRS.from_user_input(wkt)
    if "stereo" in crs.name.lower() and "70" in crs.name:
        return STEREO_70
    epsg = crs.to_epsg()
    return f"EPSG:{epsg}" if epsg else crs.to_wkt()


def _read_upload(
    data: bytes, filename: str
) -> tuple[list[list[tuple[float, float]]], list[str | None], str]:
    """Outer rings in lon/lat, the crop column if any, and the file's coordinate system."""
    suffix = Path(filename).suffix.lower() or ".zip"
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"upload{suffix}"
        path.write_bytes(data)
        if suffix == ".zip":
            with zipfile.ZipFile(path) as zf:
                shp = [n for n in zf.namelist() if n.lower().endswith(".shp")]
                geo = [
                    n for n in zf.namelist() if n.lower().endswith((".geojson", ".json", ".kml"))
                ]
            if not shp and not geo:
                raise HTTPException(422, "no_shapefile_in_zip")
            source = f"/vsizip/{path}/{(shp or geo)[0]}"
            default = STEREO_70 if shp else "EPSG:4326"
        elif suffix in {".geojson", ".json", ".kml"}:
            source, default = str(path), "EPSG:4326"
        else:
            raise HTTPException(422, "unsupported_file")
        try:
            info = pyogrio.read_info(source)
            df = pyogrio.read_dataframe(source)
        except Exception as error:
            raise HTTPException(422, "unreadable_file") from error
    if len(df) > MAX_OUTLINES:
        raise HTTPException(422, "too_many_outlines")
    crs = _source_crs(info, default)
    to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    crop_column = next(
        (
            c
            for c in df.columns
            if c.lower() in {"cultura", "crop", "cultura_2025", "denumire_cultura"}
        ),
        None,
    )
    rings: list[list[tuple[float, float]]] = []
    crops: list[str | None] = []
    for i, geom in enumerate(df.geometry):
        if geom is None or geom.is_empty:
            continue
        parts = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
        for part in parts:
            if part.geom_type != "Polygon":
                continue
            xs, ys = zip(*part.exterior.coords, strict=True)
            lons, lats = to_wgs84.transform(xs, ys)
            rings.append(list(zip(lons, lats, strict=True)))
            value = df[crop_column].iloc[i] if crop_column else None
            crops.append(str(value).strip() if value not in (None, "") else None)
    if not rings:
        raise HTTPException(422, "no_outlines")
    return rings, crops, crs


def match_outlines(
    conn: sqlite3.Connection, rings: Sequence[Sequence[tuple[float, float]]]
) -> tuple[list[list[int]], int]:
    """For each outline, the APIA parcel ids it covers (by overlap). Also the count with none."""
    matches: list[list[int]] = []
    unmatched = 0
    for ring in rings:
        lons = [lon for lon, _ in ring]
        lats = [lat for _, lat in ring]
        frame = Frame.at(sum(lats) / len(lats))
        outline = frame.polygon(ring)
        candidates = conn.execute(
            """SELECT p.id, p.coords FROM parcels_idx AS i JOIN parcels AS p ON p.id = i.id
               WHERE i.max_lon >= ? AND i.min_lon <= ? AND i.max_lat >= ? AND i.min_lat <= ?""",
            (min(lons), max(lons), min(lats), max(lats)),
        ).fetchall()
        found: list[int] = []
        for pid, coords in candidates:
            parcel = frame.polygon(json.loads(coords))
            if parcel.area == 0 or outline.area == 0:
                continue
            inter = parcel.intersection(outline).area
            if inter / parcel.area >= MIN_OVERLAP or inter / outline.area >= MIN_OVERLAP:
                found.append(int(pid))
        if not found:
            unmatched += 1
        matches.append(found)
    return matches, unmatched


def _imported(
    conn: sqlite3.Connection,
    rings: Sequence[Sequence[tuple[float, float]]],
    crops: Sequence[str | None],
    crs: str,
) -> FarmImport:
    matches, unmatched = match_outlines(conn, rings)
    ids = sorted({pid for found in matches for pid in found})
    file_crops = {
        pid: crop for found, crop in zip(matches, crops, strict=True) if crop for pid in found
    }
    return FarmImport(
        parcels=parcels_by_id(conn, ids) if ids else [],
        unmatched=unmatched,
        source_crs=crs,
        file_crops=file_crops,
    )


@router.post("/import")
async def import_farm(request: Request, filename: str = Query(max_length=200)) -> FarmImport:
    """Upload a parcel file as the request body: a zipped shapefile (as AGI Online exports), GeoJSON
    or KML. Returns the APIA parcels it covers."""
    data = await request.body()
    if not data:
        raise HTTPException(422, "empty_file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file_too_large")
    rings, crops, crs = _read_upload(data, filename)
    return _imported(db(), rings, crops, crs)


@router.post("/rematch")
def rematch(parcels: list[Parcel]) -> FarmImport:
    """Match saved parcels to the current APIA layer by outline (ids change between years)."""
    if not parcels or len(parcels) > 1000:
        raise HTTPException(422, "between 1 and 1000 parcels")
    return _imported(db(), [_ring(p) for p in parcels], [None] * len(parcels), "EPSG:4326")


# --------------------------------------------------------------------------- suggested fields

CROP_NAMES: dict[str, tuple[str, str]] = {
    "maize": ("porumb", "maize"),
    "common_wheat": ("grâu", "wheat"),
    "durum_wheat": ("grâu dur", "durum wheat"),
    "barley": ("orz", "barley"),
    "sunflower": ("floarea-soarelui", "sunflower"),
    "rapeseed": ("rapiță", "rapeseed"),
    "soybean": ("soia", "soybean"),
    "dry_pulses": ("leguminoase", "pulses"),
    "grassland": ("pajiște", "grassland"),
    "fodder_crops": ("furaje", "fodder crops"),
}


def _signature(parcel: Parcel, declared: str | None) -> tuple[str | None, ...]:
    """What was grown: the declared crop (if any) and each mapped year's main crop."""
    mapped = tuple(
        c.crop if c.crop and c.share >= MIN_CROP_SHARE else None for c in parcel.crop_history
    )
    return ((declared.lower() if declared else None), *mapped)


def _describe(signature: tuple[str | None, ...], parcel: Parcel, count: int) -> Localized:
    declared, *mapped = signature
    years = [c.year for c in parcel.crop_history]
    ro: list[str] = [f"{count} parcele" if count != 1 else "1 parcelă"]
    en: list[str] = [f"{count} parcels" if count != 1 else "1 parcel"]
    if declared:
        ro.append(f"declarate cu {declared}")
        en.append(f"declared as {declared}")
    seen = [(y, c) for y, c in zip(years, mapped, strict=False) if c]
    if seen:
        ro.append(
            "pe harta culturilor: "
            + ", ".join(f"{CROP_NAMES.get(c, (c, c))[0]} în {y}" for y, c in seen)
        )
        en.append(
            "crop map: " + ", ".join(f"{CROP_NAMES.get(c, (c, c))[1]} in {y}" for y, c in seen)
        )
    if not declared and not seen:
        ro.append("vecine, fără culturi cunoscute")
        en.append("next to each other, crops unknown")
    return Localized(ro="; ".join(ro) + ".", en="; ".join(en) + ".")


class _Groups:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def join(self, a: int, b: int) -> None:
        self.parent[self.find(a)] = self.find(b)

    def members(self) -> dict[int, list[int]]:
        out: dict[int, list[int]] = {}
        for i in range(len(self.parent)):
            out.setdefault(self.find(i), []).append(i)
        return out


def suggest_fields(parcels: Sequence[Parcel], declared: dict[int, str]) -> list[SuggestedField]:
    """Group parcels with the same crops lying close together; tiny groups join a neighbour."""
    if not parcels:
        return []
    lat0 = sum(c.lat for p in parcels for c in p.boundary) / sum(len(p.boundary) for p in parcels)
    frame = Frame.at(lat0)
    shapes = [frame.polygon(_ring(p)) for p in parcels]
    sigs = [_signature(p, declared.get(p.id)) for p in parcels]
    tree = shapely.STRtree(shapes)
    groups = _Groups(len(parcels))
    for i, shape in enumerate(shapes):
        for j in tree.query(shape, predicate="dwithin", distance=SAME_CROPS_M):
            j = int(j)
            if j <= i or sigs[i] != sigs[j]:
                continue
            # Same crops: neighbours always group; farther parcels only when crops are known.
            known = any(s is not None for s in sigs[i])
            if known or shape.distance(shapes[j]) <= NEIGHBOUR_M:
                groups.join(i, j)

    def area(members: list[int]) -> float:
        return sum(parcels[m].area_ha for m in members)

    # Fold groups under MIN_FIELD_HA into the nearest other group, smallest first.
    while True:
        sets = groups.members()
        small = sorted(
            (r for r, m in sets.items() if area(m) < MIN_FIELD_HA), key=lambda r: area(sets[r])
        )
        if not small or len(sets) == 1:
            break
        root = small[0]
        mine = shapely.union_all([shapes[m] for m in sets[root]])
        nearest = min(
            (r for r in sets if r != root),
            key=lambda r: mine.distance(shapely.union_all([shapes[m] for m in sets[r]])),
        )
        groups.join(root, nearest)

    ordered = sorted(groups.members().values(), key=lambda m: -area(m))
    fields: list[SuggestedField] = []
    for n, members in enumerate(ordered, start=1):
        # Describe the group by its largest parcel's crops.
        lead = max(members, key=lambda m: parcels[m].area_ha)
        fields.append(
            SuggestedField(
                id=f"field-{n}",
                name=f"Câmp {n}",
                parcel_ids=sorted(parcels[m].id for m in members),
                reason=_describe(sigs[lead], parcels[lead], len(members)),
            )
        )
    return fields


@router.post("/suggest")
def suggest(body: FarmSuggestRequest) -> FarmSuggestion:
    """Suggested fields for a farm's parcels: same crops and close together."""
    return FarmSuggestion(fields=suggest_fields(body.parcels, dict(body.declared_crops)))


def centroid(parcels: Sequence[Parcel]) -> LatLon:
    """Area-weighted centre of some parcels, for the field's analysis point."""
    total = sum(p.area_ha for p in parcels) or 1.0
    lat = sum(sum(c.lat for c in p.boundary) / len(p.boundary) * p.area_ha for p in parcels) / total
    lon = sum(sum(c.lon for c in p.boundary) / len(p.boundary) * p.area_ha for p in parcels) / total
    return LatLon(lat=round(lat, 5), lon=round(lon, 5))
