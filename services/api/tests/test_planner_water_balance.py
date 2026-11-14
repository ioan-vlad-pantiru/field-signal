"""Hargreaves ET0 and the one-layer soil-water bucket of the water score (plan §12)."""

import numpy as np

from api.planner import grid, scoring, weather
from api.planner import mock_world_model as wm
from api.planner import water_balance as wb

AIUD = grid.grid_point(46.30, 23.75)


def test_et0_hargreaves_check_value() -> None:
    # 46° N, July, Tmax 28 °C, Tmin 15 °C: 167 mm by hand (Ra about 16.7 mm/day); plan range.
    e = wb.et0_mm(np.full(12, 28.0), np.full(12, 15.0), 46.0)
    assert 130 < e[6] < 190
    assert (e > 0).all() and e.argmax() in (5, 6)  # the longest days
    # Below -17.8 °C mean the formula turns negative: clipped to 0.
    assert wb.et0_mm(np.full(12, -20.0), np.full(12, -25.0), 46.0).tolist() == [0.0] * 12


def _aiud() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Maize NDVI of every season at Aiud (unknown history), with the cell's ET0 and rain."""
    et0, rain = scoring._cell_weather(weather.cell_id(46.30, 23.75))
    ndvi = [wm.outcomes(AIUD, ("", ""), ("maize",), s)[0].ndvi_monthly for s in wm.scenarios(1)]
    return np.array(ndvi, dtype=float), et0, rain


def test_bucket_stays_in_range_and_balances() -> None:
    ndvi, et0, rain = _aiud()
    level, eta, etc, drainage = wb.bucket(ndvi, et0, rain)
    assert level.shape == eta.shape == etc.shape == drainage.shape == (44, 12)
    assert (level >= 0).all() and (level <= wb.CAPACITY_MM).all()
    assert (eta <= etc + 1e-9).all() and (drainage >= 0).all()
    start = wb.START_FILL * wb.CAPACITY_MM
    end = start + rain.sum(-1) - eta.sum(-1) - drainage.sum(-1)
    np.testing.assert_allclose(end, level[:, -1], atol=1e-9)
    assert (level < wb.CAPACITY_MM).any() and (drainage > 0).any()  # both limits are reached
    # Scoring runs only to the last flowering month: a shorter year is the same months, exactly.
    short = wb.bucket(ndvi[:, :8], et0[:, :8], rain[:, :8])
    for s, full in zip(short, (level, eta, etc, drainage), strict=True):
        assert (s == full[:, :8]).all()


def test_no_rain_never_raises_the_level() -> None:
    ndvi, et0, rain = _aiud()
    level, *_ = wb.bucket(ndvi, et0, np.zeros_like(rain))
    start = np.full((len(level), 1), wb.START_FILL * wb.CAPACITY_MM)
    assert (np.diff(np.hstack([start, level]), axis=-1) <= 0).all()


def test_greener_crop_ends_no_wetter_and_meets_no_more_of_its_demand() -> None:
    ndvi, et0, rain = _aiud()
    low, eta_l, etc_l, _ = wb.bucket(ndvi, et0, rain)
    high, eta_h, etc_h, _ = wb.bucket(np.minimum(1, ndvi * 1.3), et0, rain)
    assert (high[:, -1] <= low[:, -1] + 1e-9).all()
    ratio_l, ratio_h = eta_l.sum(-1) / etc_l.sum(-1), eta_h.sum(-1) / etc_h.sum(-1)
    assert (ratio_h <= ratio_l + 1e-9).all() and (ratio_h < ratio_l).any()
