"""Crops the planner proposes, copied from `data/crops.toml` (that file is not in the API image).

DRAFT values, not reviewed by an agronomist: return intervals are rules of thumb and the heat
thresholds are partly placeholders (see the notes in `data/crops.toml`). A test fails if this
table drifts from that file. Months are (first, last) calendar months of each window; a winter
crop is sown in the previous calendar year. Soybean was dropped by the team on 14 Nov 2026: it
may appear in a farmer's history but is never proposed. Pea is the only legume.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlannerCrop:
    is_legume: bool
    min_return_years: int  # years before the crop may return to the same field
    family: str
    season_type: str  # "summer", "winter" or "spring"
    sowing_months: tuple[int, int]
    flowering_months: tuple[int, int]
    harvest_months: tuple[int, int]
    water_need: str  # "low", "medium" or "high"
    heat_watch_tmax_c: float  # Tmax above which flowering / grain fill is watched


CROPS: dict[str, PlannerCrop] = {
    "maize": PlannerCrop(False, 1, "poaceae", "summer", (4, 5), (7, 8), (9, 10), "high", 32.0),
    "wheat": PlannerCrop(False, 2, "poaceae", "winter", (10, 10), (5, 6), (7, 8), "medium", 30.0),
    "barley": PlannerCrop(False, 2, "poaceae", "winter", (9, 10), (5, 5), (6, 7), "medium", 30.0),
    "sunflower": PlannerCrop(
        False, 5, "asteraceae", "summer", (4, 4), (7, 7), (8, 9), "medium", 34.0
    ),
    "pea": PlannerCrop(True, 4, "fabaceae", "spring", (3, 4), (5, 6), (6, 7), "low", 28.0),
}
LEGUMES = frozenset(c for c, v in CROPS.items() if v.is_legume)
