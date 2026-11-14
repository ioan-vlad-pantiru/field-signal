"""Monthly NASA POWER weather per grid cell, for the planner's (mock) world model.

The table `data/weather_monthly.csv.gz` is built by `farm_data.power_grid`: every POWER
meteorology cell (MERRA-2, 0.5° x 0.625°) whose box touches Romania, complete years 1981-2025.
A cell is kilometres wide: it describes the area around a field, not the field itself.

    cell = cell_id(46.30, 23.75)                   # "46.500_23.750", or OutsideCoverage
    rows = season_months(cell, 2012)               # summer crop: Jan-Dec 2012
    rows = season_months(cell, 2012, winter=(10, 7))  # winter crop: Oct 2011 - Jul 2012

A season is a harvest year. Winter crops need the previous autumn, so the first season is 1982.
"""

from __future__ import annotations

import csv
import gzip
import math
from dataclasses import dataclass
from functools import cache
from pathlib import Path

DATA = Path(__file__).with_name("data") / "weather_monthly.csv.gz"
DLAT, DLON = 0.5, 0.625


class OutsideCoverage(ValueError):
    """No POWER cell in the table covers the point (south of about 43.75° N or outside Romania)."""


@dataclass(frozen=True)
class Month:
    year: int
    month: int
    tmax_mean_c: float
    tmin_mean_c: float
    rain_mm: float
    hot_days: int  # Tmax >= 30 °C (placeholder threshold)
    frost_days: int  # Tmin < 0 °C (ETCCDI FD)
    longest_dry_spell_days: int  # rain < 1 mm (ETCCDI CDD), counted inside the month
    gwetroot_mean: float  # root-zone soil wetness, 0-1


@cache
def _table() -> dict[str, dict[tuple[int, int], Month]]:
    out: dict[str, dict[tuple[int, int], Month]] = {}
    with gzip.open(DATA, "rt", newline="") as f:
        for r in csv.DictReader(f):
            m = Month(
                int(r["year"]),
                int(r["month"]),
                float(r["tmax_mean_c"]),
                float(r["tmin_mean_c"]),
                float(r["rain_mm"]),
                int(r["hot_days"]),
                int(r["frost_days"]),
                int(r["longest_dry_spell_days"]),
                float(r["gwetroot_mean"]),
            )
            out.setdefault(r["cell_id"], {})[m.year, m.month] = m
    return out


def cell_id(lat: float, lon: float) -> str:
    """ID of the POWER cell whose box contains the point; raises OutsideCoverage if none."""
    cid = f"{math.floor(lat / DLAT + 0.5) * DLAT:.3f}_{math.floor(lon / DLON + 0.5) * DLON:.3f}"
    if cid not in _table():
        raise OutsideCoverage(
            f"No NASA POWER weather cell for {lat:.4f}, {lon:.4f}: "
            "the planner covers Romania north of about 43.75° N only."
        )
    return cid


@cache  # the planner calls it per world-model row; the table it reads is cached too
def seasons() -> range:
    """Harvest seasons with full weather, winter sowing included: 1982-2025."""
    years = {y for y, _ in next(iter(_table().values()))}
    return range(min(years) + 1, max(years) + 1)


def season_months(cell: str, season: int, winter: tuple[int, int] | None = None) -> list[Month]:
    """Monthly rows of one season, in order: January-December of the harvest year, or for a
    winter crop `winter=(sowing_month, harvest_month)` from sowing in the previous year."""
    if season not in seasons():
        raise ValueError(f"season {season} outside {seasons()}")
    start, end = (
        ((season - 1, winter[0]), (season, winter[1])) if winter else ((season, 1), (season, 12))
    )
    rows = _table()[cell]
    return [rows[k] for k in sorted(rows) if start <= k <= end]
