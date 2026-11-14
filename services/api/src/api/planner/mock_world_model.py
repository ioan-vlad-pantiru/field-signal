"""MOCK world model for the farm planner (plan §3.5). NOT a real model, never real predictions.

It stands in for the `ml/` world model (an LSTM, not ready) with the hand-off shape agreed in
`contracts.RotationOutcome`. Every row says `model_version = "mock-0"`; anything built on it must
say `mock = true`. Every number below is a placeholder picked to make the mock respond in a
plausible direction; none is calibrated or taken from a source.

What it responds to, like the real model will:
- weather of the season (NASA POWER table, `planner.weather`): heat, dry spells and low root-zone
  wetness in the crop's flowering months lower NDVI and yield, scaled by the crop's heat threshold
  and water need; a dry autumn at sowing hurts winter crops;
- crop sequence: a legume before a non-legume helps, the same family as last year (or two years
  back) hurts, the field's last two crops act on plan year 1. This only sketches the carry-over
  (nutrients, moisture, disease, residues) the real model must learn from the crop history;
- grid point: a small stable shift per 0.0025° cell. Root-zone moisture is the POWER cell's
  GWETROOT, identical across a farm (a cell is kilometres wide).

The ensemble (8 members) is synthetic: the same spread for every season, never calibrated. It
stands in for predictive uncertainty and feeds `low_risk`. Deterministic: members are seeded
from a stable hash (blake2b) of the point and crops; the season picks a row of that draw.
A main crop outside `planner.crops.CROPS` (soybean, fallow, cover crops) is not simulated: its
rows hold nulls. Those crops still count as previous crops.

Signatures (the service builds on these):

    scenarios(plan_years) -> list[int]       # weather-window IDs = first harvest season, in order
    state(grid_point_id, last_two, rotation, start) -> ndarray[member, month, variable]
        # 12 x len(rotation) months, Jan-Dec of each harvest year; variables VARIABLES
    summarise(state, grid_point_id, rotation, start) -> list[RotationOutcome]  # one per plan year
    outcomes(grid_point_id, last_two, rotation, start) -> list[RotationOutcome]
        # cached; equal to summarise(state(...)); this is what scoring uses

`last_two` = the field's last two crops, older first (`history[-2:]`; shorter = unknown).
`rotation` = crop names in plan order. `start` = scenario ID: plan year y uses season start+y-1.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from functools import cache, lru_cache

import numpy as np
from numpy.typing import NDArray

from api.contracts import Crop, Range, RotationOutcome
from api.planner import weather
from api.planner.crops import CROPS

Array = NDArray[np.float64]

MODEL_VERSION = "mock-0"
MEMBERS = 8
VARIABLES = ("ndvi", "rootzone_sm", "et_mm")

# PLACEHOLDERS, all of them (mock only).
BARE_NDVI = 0.2
PEAK_NDVI = {"maize": 0.8, "wheat": 0.75, "barley": 0.72, "sunflower": 0.75, "pea": 0.65}
VOLUNTEER_NDVI = 0.1  # weeds and volunteers outside the season: wet (rain/100 mm) and warm months
HEAT_MARGIN_C = 6.0  # monthly mean Tmax this far below the crop's heat_watch_tmax_c starts to hurt
HEAT_LOSS_PER_C = 0.04
DRY_SPELL_OK_DAYS = 7
DRY_LOSS_PER_DAY = 0.01
SM_OK = {"low": 0.35, "medium": 0.45, "high": 0.55}  # GWETROOT (0-1) the crop wants at flowering
WATER_SENSITIVITY = {"low": 0.4, "medium": 0.7, "high": 1.0}
SOWING_RAIN_OK_MM = 40.0  # winter crops: rain in the sowing months of the previous autumn
SOWING_LOSS = 0.1
LEGUME_CREDIT = 0.08  # a non-legume after a legume
SAME_FAMILY = 0.08  # same family as last year
SAME_CROP = 0.05  # on top of SAME_FAMILY: the same crop as last year
SAME_FAMILY_2 = 0.03  # same family two years back
POINT_VARIATION = 0.03
SPREAD = 0.08  # relative member spread of yield, the same for every season
YIELD_CAP = 1.25
KC_PER_NDVI = 1.25  # crop coefficient = KC_PER_NDVI x NDVI
ET0_MM_PER_C_DAY = 0.2  # reference ET from mean temperature alone
_DAYS = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
# Families of crops that may appear only in a field's history, from `data/crops.toml`.
_OTHER_FAMILY = {
    "soybean": "fabaceae",
    "cover_vetch": "fabaceae",
    "cover_mustard": "brassicaceae",
    "cover_phacelia": "boraginaceae",
}


def scenarios(plan_years: int) -> list[int]:
    """Every window of `plan_years` consecutive seasons in the record (42, 41, 40 for 3, 4, 5)."""
    s = weather.seasons()
    return list(range(s.start, s.stop - plan_years + 1))


def _family(crop: str) -> str:
    return CROPS[crop].family if crop in CROPS else _OTHER_FAMILY.get(crop, "")


def _years(last_two: Sequence[str], rotation: Sequence[str]) -> list[tuple[str, str, str]]:
    """(crop, crop two years back, last year's crop) per plan year."""
    seq = [*("", "", *last_two)[-2:], *rotation]
    return [(seq[i + 2], seq[i], seq[i + 1]) for i in range(len(rotation))]


def _seed(*parts: str) -> int:
    return int.from_bytes(hashlib.blake2b("|".join(parts).encode(), digest_size=8).digest())


@cache
def _calendar(cell: str) -> Array:
    """[season, month Jan-Dec, (tmax, tmin, rain, gwetroot, dry spell)] of the harvest years."""
    return np.array(
        [
            [
                (m.tmax_mean_c, m.tmin_mean_c, m.rain_mm, m.gwetroot_mean, m.longest_dry_spell_days)
                for m in weather.season_months(cell, s)
            ]
            for s in weather.seasons()
        ]
    )


@cache
def _crop_months(crop: str) -> tuple[NDArray[np.bool_], Array, slice]:
    """In-season mask and NDVI shape (Jan-Dec of the harvest year), flowering months."""
    c = CROPS[crop]
    first = 1 if c.season_type == "winter" else c.sowing_months[0]  # winter: sown last autumn
    (f0, f1), last = c.flowering_months, c.harvest_months[1]
    m = np.arange(1, 13)
    mask = (m >= first) & (m <= last)
    shape = np.where(
        m < f0,
        (m - first + 1) / (f0 - first + 1),
        np.where(m > f1, (last - m + 1) / (last - f1 + 1), 1.0),
    )
    return mask, np.where(mask, shape, 0.0), slice(f0 - 1, f1)


@cache
def _stress(cell: str, crop: str) -> Array:
    """Weather loss of yield per season (fraction), from the flowering months and, for a
    winter crop, the sowing months of the previous autumn."""
    c, cal = CROPS[crop], _calendar(cell)
    f = _crop_months(crop)[2]
    heat = np.maximum(0, cal[:, f, 0] - (c.heat_watch_tmax_c - HEAT_MARGIN_C)).mean(1)
    dry = np.maximum(0, cal[:, f, 4].max(1) - DRY_SPELL_OK_DAYS)
    deficit = np.maximum(0, SM_OK[c.water_need] - cal[:, f, 3].mean(1))
    loss = HEAT_LOSS_PER_C * heat + WATER_SENSITIVITY[c.water_need] * (
        DRY_LOSS_PER_DAY * dry + deficit
    )
    if c.season_type == "winter":
        s0, s1 = c.sowing_months
        rain = np.array(
            [
                sum(
                    m.rain_mm
                    for m in weather.season_months(cell, s, winter=(s0, c.harvest_months[1]))
                    if m.year == s - 1 and s0 <= m.month <= s1
                )
                for s in weather.seasons()
            ]
        )
        loss += SOWING_LOSS * np.maximum(0, 1 - rain / SOWING_RAIN_OK_MM)
    return loss


def _sequence(crop: str, prev2: str, prev1: str) -> float:
    fam, fam1 = _family(crop), _family(prev1)
    effect = LEGUME_CREDIT if fam1 == "fabaceae" and fam != "fabaceae" else 0.0
    if fam1 == fam:
        effect -= SAME_FAMILY + (SAME_CROP if prev1 == crop else 0.0)
    if _family(prev2) == fam:
        effect -= SAME_FAMILY_2
    return effect


def _simulate(point: str, crop: str, prev2: str, prev1: str) -> Array:
    """Mock monthly state for every season: [season, member, month, variable]."""
    lat, lon = map(float, point.split("_"))
    cell = weather.cell_id(lat, lon)
    cal = _calendar(cell)
    mask, shape, _ = _crop_months(crop)
    u = _seed(point) / 2**64
    base = 1 + _sequence(crop, prev2, prev1) + POINT_VARIATION * (2 * u - 1) - _stress(cell, crop)
    z = np.random.default_rng(_seed(point, prev2, prev1, crop)).standard_normal(
        (len(base), MEMBERS)
    )
    z = (z - z.mean(1, keepdims=True)) / z.std(1, keepdims=True)
    yld = np.clip(base[:, None] * (1 + SPREAD * z), 0, YIELD_CAP)
    tmax, tmin, rain, sm = cal[..., 0], cal[..., 1], cal[..., 2], cal[..., 3]
    off = BARE_NDVI + VOLUNTEER_NDVI * np.minimum(1, rain / 100) * (tmax >= 10)
    ndvi = np.where(
        mask, BARE_NDVI + (PEAK_NDVI[crop] - BARE_NDVI) * yld[..., None] * shape, off[:, None, :]
    )
    et0 = ET0_MM_PER_C_DAY * np.maximum(0, (tmax + tmin) / 2) * _DAYS
    et = KC_PER_NDVI * ndvi * et0[:, None, :]
    return np.stack([ndvi, np.broadcast_to(sm[:, None, :], ndvi.shape), et], axis=-1)


def _summaries(states: Array, crop: str) -> Array:
    """[season, member, month, variable] -> [season, summary, (P10, P50, P90)]. Summaries in
    RotationOutcome order: yield_rel, ndvi_peak, ndvi_offseason, rootzone_sm_critical,
    et_season_mm."""
    mask, _, f = _crop_months(crop)
    ndvi, sm, et = states[..., 0], states[..., 1], states[..., 2]
    peak = ndvi[..., mask].max(-1)
    x = np.stack(
        [
            (peak - BARE_NDVI) / (PEAK_NDVI[crop] - BARE_NDVI),
            peak,
            ndvi[..., ~mask].mean(-1),
            sm[..., f].mean(-1),
            et[..., mask].sum(-1),
        ],
        axis=-1,
    )
    return np.percentile(x, (10, 50, 90), axis=1).transpose(1, 2, 0)


# ponytail: bounded LRU, about 5 KB per entry (4096 = 21 MB); a 150-piece farm reuses it per piece.
@lru_cache(maxsize=4096)
def _season_summaries(point: str, crop: str, prev2: str, prev1: str) -> Array | None:
    if crop not in CROPS:
        return None
    out = _summaries(_simulate(point, crop, prev2, prev1), crop)
    out.setflags(write=False)
    return out


def _check(rotation: Sequence[str], start: int) -> int:
    s = weather.seasons()
    if not (s.start <= start and start + len(rotation) <= s.stop):
        raise ValueError(f"weather window {start}+{len(rotation)} years is outside {s}")
    return start - s.start


def _row(
    point: str, rotation: Sequence[str], start: int, year: int, crop: str, vals: Array | None
) -> RotationOutcome:
    r: list[Range | None] = [None] * 5
    if vals is not None:
        r = [Range(low=lo, mid=mid, high=hi) for lo, mid, hi in vals.tolist()]
    return RotationOutcome(
        grid_point_id=point,
        rotation=">".join(rotation),
        weather_start_season=start,
        plan_year=year,
        crop=Crop(crop),
        season=start + year - 1,
        yield_rel=r[0],
        ndvi_peak=r[1],
        ndvi_offseason=r[2],
        rootzone_sm_critical=r[3],
        et_season_mm=r[4],
        model_version=MODEL_VERSION,
    )


def state(
    grid_point_id: str, last_two: Sequence[str], rotation: Sequence[str], start: int
) -> Array:
    """Mock monthly state [member, month, variable]; NaN for a crop the mock cannot simulate."""
    i = _check(rotation, start)
    return np.concatenate(
        [
            _simulate(grid_point_id, crop, p2, p1)[i + y]
            if crop in CROPS
            else np.full((MEMBERS, 12, len(VARIABLES)), np.nan)
            for y, (crop, p2, p1) in enumerate(_years(last_two, rotation))
        ],
        axis=1,
    )


def summarise(
    state: Array, grid_point_id: str, rotation: Sequence[str], start: int
) -> list[RotationOutcome]:
    """One RotationOutcome per plan year from a state of `state()`."""
    rows = []
    for y, crop in enumerate(rotation):
        block = state[:, 12 * y : 12 * (y + 1)]
        ok = crop in CROPS and not np.isnan(block).any()
        vals = _summaries(block[None], crop)[0] if ok else None
        rows.append(_row(grid_point_id, rotation, start, y + 1, crop, vals))
    return rows


def outcomes(
    grid_point_id: str, last_two: Sequence[str], rotation: Sequence[str], start: int
) -> list[RotationOutcome]:
    """Same rows as `summarise(state(...))`, from the per-year cache."""
    i = _check(rotation, start)
    rows = []
    for y, (crop, p2, p1) in enumerate(_years(last_two, rotation)):
        s = _season_summaries(grid_point_id, crop, p2, p1)
        rows.append(
            _row(grid_point_id, rotation, start, y + 1, crop, None if s is None else s[i + y])
        )
    return rows
