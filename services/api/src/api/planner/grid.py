"""Grid points and field pieces for the farm planner (plan §3.4).

The grid is the one of the SoilGrids rasters already downloaded (EPSG:4326, step 0.0025°,
west 20.2, north 48.3, 3840 x 1880 cells). The API image has no rasters, so the rule is
arithmetic on those constants; `data/tests/test_planner_grid_raster.py` checks them against a
raster when one is present. "250 m" is the nominal name: at 46.3° N a cell is about 278 m x
193 m (5.4 ha), so areas come from a local metric projection, never from the degree step.

Signatures (the service builds on these):

    grid_point(lat, lon) -> str              # "{lat:.5f}_{lon:.5f}" of the cell centre;
                                             # raises weather.OutsideCoverage outside the grid
    pieces(field_id, boundary) -> list[Piece]   # boundary: (lat, lon) vertices, open or closed
    area_ha(boundary) -> float                  # unrounded field area, ha (the farm mode uses it)
    Piece(piece_id, field_id, grid_point_id, area_tenths_ha)

The optimizer's piece tuples are `[(p.piece_id, p.field_id, p.area_tenths_ha) for p in ps]`.
`piece_id` is `"{field_id}:{grid_point_id}"`. A field's pieces sum to its rounded area.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import NamedTuple

from api.planner.weather import OutsideCoverage

STEP = 0.0025
WEST, NORTH = 20.2, 48.3
COLS, ROWS = 3840, 1880
MAX_BOX_CELLS = 10_000  # cells clipped per field at most (about 54 000 ha of bounding box)
_A, _E2 = 6378137.0, 0.00669437999014  # WGS84 semi-major axis (m), first eccentricity squared

Point = tuple[float, float]  # (x, y) = (lon, lat)


class Piece(NamedTuple):
    piece_id: str
    field_id: str
    grid_point_id: str
    area_tenths_ha: int  # 0.1 ha units


def _cell(lat: float, lon: float) -> tuple[int, int]:
    """The grid rule: (row, col) of the cell holding the point. Owns the coverage check."""
    row, col = math.floor((NORTH - lat) / STEP), math.floor((lon - WEST) / STEP)
    if not (0 <= row < ROWS and 0 <= col < COLS):
        raise OutsideCoverage(
            f"{lat:.5f}, {lon:.5f} is outside the planner's 0.0025° grid (20.2-29.8° E, "
            "43.6-48.3° N)."
        )
    return row, col


def _point_id(row: int, col: int) -> str:
    return f"{NORTH - (row + 0.5) * STEP:.5f}_{WEST + (col + 0.5) * STEP:.5f}"


def grid_point(lat: float, lon: float) -> str:
    """ID of the grid cell holding the point: its centre as '{lat:.5f}_{lon:.5f}'."""
    return _point_id(*_cell(lat, lon))


def metres_per_degree(lat: float) -> tuple[float, float]:
    """(east-west, north-south) metres per degree at `lat` on the WGS84 ellipsoid: a local
    equirectangular projection, accurate to well under 0.1 % across a field."""
    w = math.sqrt(1 - _E2 * math.sin(math.radians(lat)) ** 2)
    k = math.pi / 180
    return k * _A * math.cos(math.radians(lat)) / w, k * _A * (1 - _E2) / w**3


def shoelace(poly: Sequence[Point]) -> float:
    """Area of a simple polygon in the units of its coordinates squared."""
    pairs = zip(poly, [*poly[1:], *poly[:1]], strict=True)
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in pairs)) / 2


def _clip(poly: list[Point], box: tuple[float, float, float, float]) -> list[Point]:
    """Sutherland-Hodgman clip against the rectangle (x0, y0, x1, y1). A concave polygon may
    come back with zero-width bridges between its parts; they add no area."""
    for axis, bound, sign in ((0, box[0], 1), (1, box[1], 1), (0, box[2], -1), (1, box[3], -1)):
        out: list[Point] = []
        for prev, cur in zip([*poly[-1:], *poly[:-1]], poly, strict=True):
            dp, dc = sign * (prev[axis] - bound), sign * (cur[axis] - bound)
            if (dp >= 0) != (dc >= 0):
                t = dp / (dp - dc)
                out.append((prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])))
            if dc >= 0:
                out.append(cur)
        poly = out
    return poly


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _within(a: Point, b: Point, c: Point) -> bool:
    """c, collinear with a-b, lies on the segment a-b."""
    return min(a[0], b[0]) <= c[0] <= max(a[0], b[0]) and min(a[1], b[1]) <= c[1] <= max(a[1], b[1])


def _simple(poly: list[Point]) -> bool:
    """No edge touches another except a neighbour at their shared vertex, and no edge folds back
    onto its neighbour."""
    n = len(poly)
    for k in range(n):  # a vertex where the boundary turns back on itself (a spike)
        a, b, c = poly[k - 1], poly[k], poly[(k + 1) % n]
        if (
            _orient(a, b, c) == 0
            and (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0
        ):
            return False
    # ponytail: O(n²) pair scan, about 0.1 s at the contract's 500 vertices; sweep line if more.
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        for j in range(i + 2, n - (i == 0)):  # skip the edge itself and its two neighbours
            r, s = poly[j], poly[(j + 1) % n]
            d1, d2, d3, d4 = _orient(r, s, p), _orient(r, s, q), _orient(p, q, r), _orient(p, q, s)
            if (d1 * d2 < 0 and d3 * d4 < 0) or any(
                d == 0 and _within(*seg, pt)
                for d, seg, pt in (
                    (d1, (r, s), p),
                    (d2, (r, s), q),
                    (d3, (p, q), r),
                    (d4, (p, q), s),
                )
            ):
                return False
    return True


def _apportion(exact: dict[str, float]) -> dict[str, int]:
    """Round areas (0.1 ha) by largest remainder so they sum to the rounded total; a piece that
    rounds to 0 is merged into the field's largest piece."""
    total = round(sum(exact.values()))
    if total < 1:
        raise ValueError("field area rounds to 0 ha")
    exact = dict(exact)
    while True:
        units = {k: math.floor(a) for k, a in exact.items()}
        for k in sorted(exact, key=lambda k: units[k] - exact[k])[: total - sum(units.values())]:
            units[k] += 1
        big = max(exact, key=exact.__getitem__)
        small = [k for k in exact if k != big and (units[k] == 0 or round(exact[k]) == 0)]
        if not small:
            return units
        for k in small:
            exact[big] += exact.pop(k)


def _polygon(boundary: Sequence[tuple[float, float]]) -> tuple[list[Point], int, int, int, int]:
    """The cleaned (lon, lat) polygon and its cell box (r0, c0, r1, c1); checks the boundary."""
    pts = [(lon, lat) for lat, lon in boundary]
    poly = [p for i, p in enumerate(pts) if p != pts[i - 1]]  # drop closing and repeated vertices
    if len(poly) < 3:
        raise ValueError("a field needs at least 3 distinct vertices")
    lats, lons = [p[1] for p in poly], [p[0] for p in poly]
    r0, c0 = _cell(max(lats), min(lons))
    r1, c1 = _cell(min(lats), max(lons))
    if (cells := (r1 - r0 + 1) * (c1 - c0 + 1)) > MAX_BOX_CELLS:
        raise ValueError(f"the field's bounding box spans {cells} grid cells (max {MAX_BOX_CELLS})")
    if not _simple(poly):
        raise ValueError("the boundary crosses or touches itself")
    return poly, r0, c0, r1, c1


def _metres(poly: Sequence[Point]) -> tuple[float, float]:
    lats = [p[1] for p in poly]
    return metres_per_degree((min(lats) + max(lats)) / 2)


def area_ha(boundary: Sequence[tuple[float, float]]) -> float:
    """The field's unrounded area in hectares, same polygon and projection as `pieces` (whose
    pieces sum to this rounded to 0.1 ha). Same OutsideCoverage / ValueError as `pieces`."""
    poly = _polygon(boundary)[0]
    mx, my = _metres(poly)
    return shoelace(poly) * mx * my / 10_000


def pieces(field_id: str, boundary: Sequence[tuple[float, float]]) -> list[Piece]:
    """Cut a field polygon, `(lat, lon)` vertices, by the grid cells it touches. Raises
    OutsideCoverage when a vertex lies outside the grid; ValueError for a bounding box over
    MAX_BOX_CELLS cells, a polygon that is not simple, or a field under 0.05 ha."""
    poly, r0, c0, r1, c1 = _polygon(boundary)
    mx, my = _metres(poly)
    exact: dict[str, float] = {}
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            x0, y1 = WEST + c * STEP, NORTH - r * STEP
            area = shoelace(_clip(poly, (x0, y1 - STEP, x0 + STEP, y1))) * mx * my / 1000
            if area > 0:
                exact[_point_id(r, c)] = area
    return [Piece(f"{field_id}:{g}", field_id, g, a) for g, a in _apportion(exact).items()]
