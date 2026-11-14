import tomllib
from dataclasses import astuple
from pathlib import Path

import pytest

from api.planner import weather
from api.planner.crops import CROPS, LEGUMES, PlannerCrop

CROPS_TOML = Path(__file__).resolve().parents[3] / "data" / "crops.toml"


def _months(window: list[str]) -> tuple[int, int]:
    return int(window[0][:2]), int(window[1][:2])


def test_planner_crops_match_crops_toml() -> None:
    kb = tomllib.loads(CROPS_TOML.read_text(encoding="utf-8"))
    min_return = kb["rotation"]["min_return_years"]
    assert set(CROPS) == {"maize", "wheat", "barley", "sunflower", "pea"}
    assert {"pea"} == LEGUMES
    for name, crop in CROPS.items():
        c = kb["crops"][name]
        expected = PlannerCrop(
            c["nitrogen_fixing"],
            min_return[name],
            c["family"],
            c["season_type"],
            _months(c["sowing"]),
            _months(c["flowering"]),
            _months(c["harvest"]),
            c["water_need"],
            c["heat_watch_tmax_c"],
        )
        assert astuple(crop) == astuple(expected), name


def test_aiud_cell_lookup() -> None:
    assert weather.cell_id(46.30, 23.75) == "46.500_23.750"


@pytest.mark.parametrize(("lat", "lon"), [(43.6, 25.0), (52.52, 13.40)])
def test_point_outside_coverage(lat: float, lon: float) -> None:
    with pytest.raises(weather.OutsideCoverage):
        weather.cell_id(lat, lon)


def test_seasons_and_season_window() -> None:
    assert weather.seasons() == range(1982, 2026)
    cell = weather.cell_id(46.30, 23.75)
    summer = weather.season_months(cell, 2012)
    assert [(m.year, m.month) for m in summer] == [(2012, k) for k in range(1, 13)]
    winter = weather.season_months(cell, 2012, winter=(10, 7))
    assert (winter[0].year, winter[0].month, winter[-1].month, len(winter)) == (2011, 10, 7, 10)


def test_july_2012_hotter_than_july_2005_at_aiud() -> None:
    cell = weather.cell_id(46.30, 23.75)
    july = {y: weather.season_months(cell, y)[6] for y in (2005, 2012)}
    assert july[2012].hot_days > july[2005].hot_days


def test_data_file_is_small() -> None:
    assert weather.DATA.stat().st_size < 1.5e6
