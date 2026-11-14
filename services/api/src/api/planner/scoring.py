"""Scoring for the farm planner (plan §3.6): world-model rows -> four scores 0-100, higher better.

Scoring reads `RotationOutcome` rows (yearly physical summaries and monthly NDVI), the rotation
and, for `water` only, the NASA POWER weather of the row's cell (monthly Tmax, Tmin, rain) and the
world model's reference NDVI curve. Weather therefore enters `water` directly, through a
soil-water balance (`water_balance`), as well as through the model. Soil (pH, texture, organic
carbon) and elevation are NOT inputs here: they act through the world model only, so using them
again would count them twice; the soil-water balance assumes the same soil for every field.

Score             What it measures, the proxy used, and what it does NOT measure
yield_stability   measures: expected yield level over the plan
                  proxy:    mean over plan years of the yield_rel mid (P50); no spread term
                  not:      prices, costs, margins; uncertainty (counted once, in low_risk)
water             measures: whether the crop gets the water a good-year crop would use, at flowering
                  proxy:    mean over plan years of min(1, sum ETa / sum ETm) over the crop's
                            flowering months (FAO-33 relative evapotranspiration). ETa: a monthly
                            one-layer bucket from ndvi_monthly, rain and Hargreaves ET0, assumed
                            refilled each January (START_FILL). ETm: the same ET0 x the crop
                            coefficient of the reference NDVI curve (P90 over seasons, unknown
                            history, per point and crop). ETa follows NDVI, so this score partly
                            follows yield.
                  not:      irrigation, groundwater, soil texture or depth (one soil assumed),
                            water carried over from last year, the farm's water use; it does not
                            read rootzone_sm_critical or et_season_mm
soil_health       measures: soil cover outside the main crop, and legume years
                  proxy:    ndvi_offseason mid (cover) and the rotation's share of legume years
                  not:      nutrients, organic matter, structure, erosion, disease pressure;
                            it is a cover and legume proxy, not a soil measurement
low_risk          measures: the downside inside one weather window
                  proxy:    yield_rel low (P10) of the worst plan year
                  not:      risk across weather windows (the optimizer's risk slider), prices

No score covers nutrients, disease pressure, organic matter or economics. On the mock world
model every score is a mock score.

The farmer's weights (any non-negative numbers per Priority; normalised to sum 1; all zero =
equal) combine the four into `total`. Values are rounded to 0.1.

Signatures (the service builds on these):

    score(rows, weights) -> ScoreBreakdown | None    # rows of one piece, rotation, scenario
    farm_scores(pieces, histories, rotations, weights) -> dict[(piece_id, rotation_id), ndarray]
        # pieces: grid.Piece; histories: field_id -> crop history, most recent last;
        # rotations: field_id -> rotation IDs "a>b>c", all of one length (plan_years).
        # Each value is [scenario, COLUMNS], scenarios in mock_world_model.scenarios(plan_years)
        # order. A rotation with a null value the scores need is left out for that piece.
    totals(table) -> dict[(piece_id, rotation_id), list[int]]   # total x 10, 0-1000, for CP-SAT

One score column for `optimizer.area_mean`: `{k: v[:, COLUMNS.index("water")].tolist() for k, v
in table.items()}`.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from functools import cache, lru_cache

import numpy as np
from numpy.typing import NDArray

from api.contracts import Priority, RotationOutcome, ScoreBreakdown
from api.planner import models
from api.planner import water_balance as wb
from api.planner import weather
from api.planner.crops import CROPS, LEGUMES, crop_months
from api.planner.grid import Piece

Array = NDArray[np.float64]

COLUMNS = ("total", "yield_stability", "water", "soil_health", "low_risk")
_PRIORITIES = (Priority.YIELD, Priority.WATER, Priority.SOIL, Priority.RISK)  # COLUMNS[1:] order

# PLACEHOLDER normalisation constants, not calibrated.
YIELD_REL_ZERO, YIELD_REL_FULL = 0.4, 1.2  # yield_rel (mid or P10) mapped to 0 and 100
COVER_NDVI_ZERO, COVER_NDVI_FULL = 0.15, 0.35  # off-season NDVI mapped to 0 and 100
LEGUME_SHARE_FULL = 0.25  # share of legume years scored 100
COVER_WEIGHT = 0.5  # soil_health = this x cover + the rest x legume share


def _scale(x: Array, zero: float, full: float) -> Array:
    return np.clip((x - zero) / (full - zero), 0, 1) * 100


def weight_vector(weights: Mapping[Priority, float]) -> Array:
    """Weights in COLUMNS[1:] order, normalised to sum 1; all zero = equal weights."""
    w = np.array([float(weights.get(p, 0.0)) for p in _PRIORITIES])
    return w / w.sum() if w.sum() > 0 else np.full(4, 0.25)


@cache
def _cell_weather(cell: str) -> tuple[Array, Array]:
    """[season, month Jan-Dec] ET0 and rain (mm) of a POWER cell, harvest years."""
    m = np.array(
        [
            [(x.tmax_mean_c, x.tmin_mean_c, x.rain_mm) for x in weather.season_months(cell, s)]
            for s in weather.seasons()
        ]
    )
    return wb.et0_mm(m[..., 0], m[..., 1], float(cell.split("_")[0])), m[..., 2]


class _NoReference(Exception):
    """Raised, not returned, so the LRU cache below keeps no value for that point and crop."""


@lru_cache(maxsize=4096)
def _cached_reference_kc(point: str, crop: str) -> Array:
    rows = [models.active().outcomes(point, ("", ""), (crop,), s)[0].ndvi_monthly for s in models.active().scenarios(1)]
    ndvi = np.array([r for r in rows if r is not None], dtype=float).reshape(-1, 12)
    ndvi = ndvi[np.isfinite(ndvi).all(-1)]
    if not len(ndvi):
        raise _NoReference
    kc = wb.crop_coefficient(np.percentile(ndvi, 90, axis=0))
    kc.setflags(write=False)
    return kc


def _reference_kc(point: str, crop: str) -> Array | None:
    """Crop coefficient of a good-year crop per month: P90 over the seasons of the world model's
    monthly NDVI for an unknown history, rows with a null or non-finite value left out; None
    (not cached) when no row is left."""
    try:
        return _cached_reference_kc(point, crop)
    except _NoReference:
        return None


def _year_parts(rows: Sequence[RotationOutcome]) -> Array | None:
    """[row, (yield mid, water ratio, off-season NDVI mid, yield P10)] for rows of one grid point
    and crop (any seasons); None when a value the scores need is null or not finite, a season has
    no weather, or the crop has no reference curve. `water` = min(1, sum ETa / sum ETm) over the
    flowering months; see the module header."""
    point, crop = rows[0].grid_point_id, rows[0].crop
    if crop not in CROPS or any(r.season not in weather.seasons() for r in rows):
        return None
    cols = []
    for r in rows:
        if r.yield_rel is None or r.ndvi_offseason is None or r.ndvi_monthly is None:
            return None
        cols.append((r.yield_rel.mid, r.ndvi_offseason.mid, r.yield_rel.low))
    x, ndvi = np.array(cols), np.array([r.ndvi_monthly for r in rows], dtype=float)
    kc = _reference_kc(point, crop)
    if kc is None or not (np.isfinite(x).all() and np.isfinite(ndvi).all()):
        return None
    et0, rain = _cell_weather(weather.cell_id(*map(float, point.split("_"))))
    i = np.array([r.season for r in rows]) - weather.seasons().start
    f = crop_months(crop)[2]  # the bucket runs from January to the last flowering month
    _, eta, _, _ = wb.bucket(ndvi[:, : f.stop], et0[i, : f.stop], rain[i, : f.stop])
    etm = kc[f] * et0[i, f]
    water = np.minimum(1, eta[:, f].sum(-1) / np.maximum(etm.sum(-1), 1e-9))
    return np.column_stack([x[:, 0], water, x[:, 1], x[:, 2]])


def _combine(parts: Array, legume_share: float, w: Array) -> Array:
    """parts[plan year, scenario, part] -> [scenario, COLUMNS], rounded to 0.1."""
    four = np.stack(
        [
            _scale(parts[..., 0].mean(0), YIELD_REL_ZERO, YIELD_REL_FULL),
            np.clip(parts[..., 1], 0, 1).mean(0) * 100,
            COVER_WEIGHT * _scale(parts[..., 2].mean(0), COVER_NDVI_ZERO, COVER_NDVI_FULL)
            + (1 - COVER_WEIGHT) * min(1.0, legume_share / LEGUME_SHARE_FULL) * 100,
            _scale(parts[..., 3].min(0), YIELD_REL_ZERO, YIELD_REL_FULL),
        ],
        axis=-1,
    )
    return np.round(np.column_stack([four @ w, four]), 1)


def _legume_share(crops: Sequence[str]) -> float:
    return sum(c in LEGUMES for c in crops) / len(crops)


def score(
    rows: Sequence[RotationOutcome], weights: Mapping[Priority, float]
) -> ScoreBreakdown | None:
    """The four scores and the total for the rows of one piece, rotation and scenario (one row
    per plan year); None when a value the scores need is null."""
    parts = [_year_parts([r]) for r in rows]
    if not parts or any(p is None for p in parts):
        return None
    arr = np.concatenate([p for p in parts if p is not None])[:, None, :]
    v = _combine(arr, _legume_share([r.crop for r in rows]), weight_vector(weights))[0]
    return ScoreBreakdown(**dict(zip(COLUMNS, v.tolist(), strict=True)))


# ponytail: bounded LRU, about 1.4 KB per entry; per-piece locality keeps it warm on big farms.
@lru_cache(maxsize=4096)
def _parts(point: str, crop: str, prev2: str, prev1: str) -> Array | None:
    """Year parts for every season: [season, part], built from the world model's rows."""
    out = _year_parts([models.active().outcomes(point, (prev2, prev1), (crop,), s)[0] for s in models.active().scenarios(1)])
    if out is not None:
        out.setflags(write=False)
    return out


def _rotation_scores(
    point: str, last_two: tuple[str, str], rotation: str, w: Array
) -> Array | None:
    crops = rotation.split(">")
    n = len(models.active().scenarios(len(crops)))
    seq = [*last_two, *crops]
    years = []
    for y, crop in enumerate(crops):
        p = _parts(point, crop, seq[y], seq[y + 1])
        if p is None:
            return None
        years.append(p[y : y + n])
    return _combine(np.stack(years), _legume_share(crops), w)


def farm_scores(
    pieces: Iterable[Piece],
    histories: Mapping[str, Sequence[str]],
    rotations: Mapping[str, Iterable[str]],
    weights: Mapping[Priority, float],
) -> dict[tuple[str, str], Array]:
    """(piece_id, rotation_id) -> [scenario, COLUMNS] for every piece and its field's rotations."""
    w = weight_vector(weights)
    memo: dict[tuple[str, tuple[str, str], str], Array | None] = {}
    table: dict[tuple[str, str], Array] = {}
    for p in pieces:
        h = ("", "", *histories.get(p.field_id, ()))
        last_two = (h[-2], h[-1])
        for rid in rotations[p.field_id]:
            key = (p.grid_point_id, last_two, rid)
            if key not in memo:
                memo[key] = _rotation_scores(p.grid_point_id, last_two, rid, w)
            if (v := memo[key]) is not None:
                table[p.piece_id, rid] = v
    return table


def totals(table: Mapping[tuple[str, str], Array]) -> dict[tuple[str, str], list[int]]:
    """Totals as integers 0-1000 (the 0-100 total x 10), the optimizer's score input."""
    return {k: [round(t * 10) for t in v[:, 0].tolist()] for k, v in table.items()}
