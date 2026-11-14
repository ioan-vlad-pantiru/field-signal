"""Monthly soil water for the planner's `water` score (plan §12): Hargreaves reference ET and a
one-layer soil-water bucket driven by monthly NDVI. Pure numpy, no I/O; every function works
over leading axes (seasons) with months from January on the last axis.

    et0 = et0_mm(tmax, tmin, lat_deg)                    # [..., 12] mm per month
    level, eta, etc, drainage = bucket(ndvi, et0, rain)  # each [..., months], mm

Every constant below is a PLACEHOLDER, not calibrated against any soil or crop measurement.

# ponytail: one soil layer and one capacity for every field and crop, so rooting depth and soil
# texture are not used; two layers (FAO-56 dual coefficient) and a soil map are the upgrade.
# ponytail: no memory across years, each crop year starts in January at START_FILL x CAPACITY_MM
# (the soil is assumed refilled over winter); a multi-year chain is the upgrade.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

Array = NDArray[np.float64]

DAYS = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])

# PLACEHOLDERS, all of them. Constraint: (1 - DEPLETION_P) x CAPACITY_MM (75 mm) must stay above
# the largest demand of one sub-step (KC_MAX x the highest monthly ET0 over all 110 POWER cells
# and 44 seasons, 217 mm, / SUBSTEPS = 65 mm), or the bucket empties inside one sub-step and the
# result depends on SUBSTEPS.
CAPACITY_MM = 150.0  # plant-available water of the root zone, the same for every field and crop
# Share of CAPACITY_MM in the bucket each January, an assumption. At Aiud (unknown history) the
# December fill is 0.84-0.98 as a mean per crop, but single seasons fall to about 0.31 (maize).
START_FILL = 0.9
DEPLETION_P = 0.5  # share of CAPACITY_MM the crop uses before it is water-stressed
KC_SLOPE, KC_INTERCEPT = 1.457, -0.1725  # crop coefficient = slope x NDVI + intercept (unverified)
KC_MIN, KC_MAX = 0.15, 1.2  # KC_MIN must stay > 0: it keeps the score's demand above zero
SUBSTEPS = 4  # each month runs in this many equal parts


def et0_mm(tmax: Array, tmin: Array, lat_deg: float) -> Array:
    """Hargreaves reference ET per month (FAO-56 eq. 52) from monthly mean daily Tmax and Tmin
    (°C), [..., 12] -> mm per month. Ra: FAO-56 eq. 21 and 23-25 on the 15th of each month."""
    j = np.cumsum(DAYS) - DAYS + 15  # day of the year
    phi = np.radians(lat_deg)
    dr = 1 + 0.033 * np.cos(2 * np.pi * j / 365)
    dec = 0.409 * np.sin(2 * np.pi * j / 365 - 1.39)
    ws = np.arccos(-np.tan(phi) * np.tan(dec))
    ra = (24 * 60 / np.pi * 0.0820 * dr) * (
        ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws)
    )  # MJ m-2 day-1
    et0 = 0.0023 * ((tmax + tmin) / 2 + 17.8) * np.sqrt(np.maximum(0, tmax - tmin))
    out: Array = np.maximum(0, et0 * 0.408 * ra * DAYS)
    return out


def crop_coefficient(ndvi: Array) -> Array:
    return np.clip(KC_SLOPE * ndvi + KC_INTERCEPT, KC_MIN, KC_MAX)


def bucket(ndvi: Array, et0: Array, rain: Array) -> tuple[Array, Array, Array, Array]:
    """One crop year from January: monthly NDVI, ET0 (mm) and rain (mm), [..., months] ->
    (end-of-month level, actual ET `ETa`, crop demand `ETc`, drainage), each [..., months], mm.
    Months run from January; fewer than 12 stop the year early (scoring stops at flowering)."""
    etc = crop_coefficient(ndvi) * et0
    sm = np.full(etc.shape[:-1], START_FILL * CAPACITY_MM)
    level, eta, drainage = np.zeros_like(etc), np.zeros_like(etc), np.zeros_like(etc)
    stress_below = (1 - DEPLETION_P) * CAPACITY_MM
    for m in range(etc.shape[-1]):
        r, demand = rain[..., m] / SUBSTEPS, etc[..., m] / SUBSTEPS
        used = drained = 0.0
        for _ in range(SUBSTEPS):
            wet = sm + r
            sm = np.minimum(wet, CAPACITY_MM)
            drained = drained + (wet - sm)
            a = np.minimum(np.minimum(sm / stress_below, 1.0) * demand, sm)  # sm >= 0: Ks <= 1
            sm = sm - a
            used = used + a
        level[..., m], eta[..., m], drainage[..., m] = sm, used, drained
    return level, eta, etc, drainage
