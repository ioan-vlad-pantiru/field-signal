"""Scoring for the farm planner (plan §3.6): world-model rows -> four scores 0-100, higher better.

Scoring reads only `RotationOutcome` rows (yearly physical summaries) and the rotation itself.
Soil (pH, texture, organic carbon), elevation and weather are NOT inputs here: they act through
the world model only, so using them again would count them twice.

Score             What it measures, the proxy used, and what it does NOT measure
yield_stability   measures: expected yield level over the plan
                  proxy:    mean over plan years of the yield_rel mid (P50); no spread term
                  not:      prices, costs, margins; uncertainty (counted once, in low_risk)
water             measures: whether root-zone moisture meets the crop's need when it matters
                  proxy:    mean over plan years of rootzone_sm_critical mid against the crop's
                            water_need (not ET: derived from NDVI, it would repeat the yield)
                  not:      irrigation, groundwater, the farm's water use
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
from functools import lru_cache

import numpy as np
from numpy.typing import NDArray

from api.contracts import Priority, RotationOutcome, ScoreBreakdown
from api.planner import mock_world_model as wm
from api.planner.crops import CROPS, LEGUMES
from api.planner.grid import Piece

Array = NDArray[np.float64]

COLUMNS = ("total", "yield_stability", "water", "soil_health", "low_risk")
_PRIORITIES = (Priority.YIELD, Priority.WATER, Priority.SOIL, Priority.RISK)  # COLUMNS[1:] order

# PLACEHOLDER normalisation constants, not calibrated.
YIELD_REL_ZERO, YIELD_REL_FULL = 0.4, 1.2  # yield_rel (mid or P10) mapped to 0 and 100
SM_DRY = 0.25  # root-zone wetness (POWER GWETROOT, 0-1) scored 0
SM_NEED = {"low": 0.35, "medium": 0.45, "high": 0.55}  # wetness scored 100, per crop water_need
COVER_NDVI_ZERO, COVER_NDVI_FULL = 0.15, 0.35  # off-season NDVI mapped to 0 and 100
LEGUME_SHARE_FULL = 0.25  # share of legume years scored 100
COVER_WEIGHT = 0.5  # soil_health = this x cover + the rest x legume share


def _scale(x: Array, zero: float, full: float) -> Array:
    return np.clip((x - zero) / (full - zero), 0, 1) * 100


def weight_vector(weights: Mapping[Priority, float]) -> Array:
    """Weights in COLUMNS[1:] order, normalised to sum 1; all zero = equal weights."""
    w = np.array([float(weights.get(p, 0.0)) for p in _PRIORITIES])
    return w / w.sum() if w.sum() > 0 else np.full(4, 0.25)


def _year_parts(row: RotationOutcome) -> tuple[float, float, float, float] | None:
    """(yield mid, moisture against need, off-season NDVI mid, yield P10) of one plan year."""
    crop, yld, sm, off = (
        CROPS.get(row.crop),
        row.yield_rel,
        row.rootzone_sm_critical,
        row.ndvi_offseason,
    )
    if crop is None or yld is None or sm is None or off is None:
        return None
    need = SM_NEED[crop.water_need]
    return yld.mid, (sm.mid - SM_DRY) / (need - SM_DRY), off.mid, yld.low


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
    parts = [_year_parts(r) for r in rows]
    if not parts or any(p is None for p in parts):
        return None
    arr = np.array(parts, dtype=float)[:, None, :]
    v = _combine(arr, _legume_share([r.crop for r in rows]), weight_vector(weights))[0]
    return ScoreBreakdown(**dict(zip(COLUMNS, v.tolist(), strict=True)))


# ponytail: bounded LRU, about 1.4 KB per entry; per-piece locality keeps it warm on big farms.
@lru_cache(maxsize=4096)
def _parts(point: str, crop: str, prev2: str, prev1: str) -> Array | None:
    """Year parts for every season: [season, part], built from the world model's rows."""
    rows = [wm.outcomes(point, (prev2, prev1), (crop,), s)[0] for s in wm.scenarios(1)]
    parts = [_year_parts(r) for r in rows]
    if any(p is None for p in parts):
        return None
    out = np.array(parts, dtype=float)
    out.setflags(write=False)
    return out


def _rotation_scores(
    point: str, last_two: tuple[str, str], rotation: str, w: Array
) -> Array | None:
    crops = rotation.split(">")
    n = len(wm.scenarios(len(crops)))
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
