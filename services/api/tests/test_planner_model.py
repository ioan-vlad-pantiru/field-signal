"""Grid pieces, the mock world model and scoring (plan §3.4-3.6)."""

import numpy as np
import pytest

from api.contracts import Priority, RotationOutcome, ScoreBreakdown
from api.planner import grid, scoring, weather
from api.planner import mock_world_model as wm
from api.planner.crops import CROPS

AIUD = grid.grid_point(46.30, 23.75)
# Demo farm near Aiud: about 37 ha and 8 ha, (lat, lon).
FIELD_A = [(46.3000, 23.7460), (46.3003, 23.7538), (46.2953, 23.7546), (46.2948, 23.7457)]
FIELD_B = [(46.3022, 23.7560), (46.3024, 23.7607), (46.3004, 23.7609), (46.3002, 23.7558)]
# Concave: a U whose notch cuts one grid cell into two separate strips.
FIELD_U = [
    (46.300, 23.745),
    (46.300, 23.748),
    (46.296, 23.748),
    (46.296, 23.7495),
    (46.300, 23.7495),
    (46.300, 23.755),
    (46.292, 23.755),
    (46.292, 23.745),
]


def test_grid_point_rule() -> None:
    assert AIUD == "46.29875_23.75125"
    assert grid.grid_point(48.3 - 1e-9, 20.2 + 1e-9) == "48.29875_20.20125"
    for lat, lon in [(43.59, 25.0), (46.0, 29.81), (48.31, 25.0), (46.0, 20.19)]:
        with pytest.raises(weather.OutsideCoverage):
            grid.grid_point(lat, lon)


def test_projection_matches_geodesic_area() -> None:
    # 0.01° square, 46.30-46.31 N x 23.75-23.76 E: 856 317.5 m² on the WGS84 ellipsoid
    # (pyproj Geod(ellps="WGS84").polygon_area_perimeter, run 14 Nov 2026).
    mx, my = grid.metres_per_degree(46.305)
    square = [(0.0, 0.0), (0.01, 0.0), (0.01, 0.01), (0.0, 0.01)]
    assert grid.shoelace(square) * mx * my == pytest.approx(856317.5, rel=5e-4)


@pytest.mark.parametrize("boundary", [FIELD_A, FIELD_U], ids=["convex", "concave"])
def test_pieces_sum_to_field_area(boundary: list[tuple[float, float]]) -> None:
    ps = grid.pieces("f", boundary)
    mx, my = grid.metres_per_degree((min(b[0] for b in boundary) + max(b[0] for b in boundary)) / 2)
    exact = grid.shoelace([(lon, lat) for lat, lon in boundary]) * mx * my / 1000
    assert abs(sum(p.area_tenths_ha for p in ps) - exact) <= 0.5
    assert len(ps) > 4 and all(p.area_tenths_ha > 0 for p in ps)
    assert len({p.piece_id for p in ps}) == len(ps)


def test_sliver_merges_into_largest_piece() -> None:
    # 1 m over the cell edge at 23.75 E: that piece rounds to 0 and joins the main one.
    sliver = [(46.2999, 23.7476), (46.2999, 23.75001), (46.2976, 23.75001), (46.2976, 23.7476)]
    ps = grid.pieces("s", sliver)
    assert [(p.grid_point_id, p.area_tenths_ha) for p in ps] == [("46.29875_23.74875", 47)]


@pytest.mark.parametrize(
    ("boundary", "error"),
    [
        # 0.2° x 0.5° triangle: about 80 x 200 cells in its box, refused before clipping.
        ([(46.0, 23.5), (46.0, 24.0), (45.8, 24.0)], r"1\d{4} grid cells"),
        # Bow tie: the 2nd and 4th edges cross.
        ([(46.300, 23.745), (46.300, 23.755), (46.292, 23.745), (46.292, 23.755)], "crosses"),
        # The last vertex sits on the first edge.
        ([(46.300, 23.745), (46.300, 23.755), (46.292, 23.750), (46.300, 23.750)], "crosses"),
        # A spike: the boundary runs out to 23.760 and straight back.
        ([(46.3, 23.745), (46.3, 23.755), (46.3, 23.76), (46.3, 23.755), (46.29, 23.75)], "cross"),
        ([(46.3, 23.745), (46.3, 23.745), (46.292, 23.75), (46.3, 23.745)], "3 distinct"),
    ],
    ids=["huge-box", "bow-tie", "touching", "spike", "two-vertices"],
)
def test_bad_boundaries_are_refused(boundary: list[tuple[float, float]], error: str) -> None:
    with pytest.raises(ValueError, match=error):
        grid.pieces("x", boundary)
    with pytest.raises(ValueError, match=error):
        grid.area_ha(boundary)


def test_area_ha_is_the_unrounded_field_area() -> None:
    for b in (FIELD_A, FIELD_B, FIELD_U):
        assert (
            abs(grid.area_ha(b) - sum(p.area_tenths_ha for p in grid.pieces("f", b)) / 10) <= 0.05
        )
    # The 0.01° square of test_projection_matches_geodesic_area: 856 317.5 m².
    square = [(46.30, 23.75), (46.30, 23.76), (46.31, 23.76), (46.31, 23.75)]
    assert grid.area_ha(square) == pytest.approx(85.63175, rel=5e-4)


def test_closed_ring_and_repeated_vertex_give_the_same_pieces() -> None:
    ref = grid.pieces("A", FIELD_A)
    assert grid.pieces("A", [*FIELD_A, FIELD_A[0]]) == ref
    assert grid.pieces("A", [FIELD_A[0], *FIELD_A]) == ref


def _score(rows: list[RotationOutcome], weights: dict[Priority, float]) -> ScoreBreakdown:
    s = scoring.score(rows, weights)
    assert s is not None
    return s


def test_mock_is_deterministic_and_declared() -> None:
    hist, rot = ["maize", "wheat"], ["pea", "wheat", "maize", "sunflower"]
    rows = wm.outcomes(AIUD, hist, rot, 1990)
    wm._season_summaries.cache_clear()
    assert wm.outcomes(AIUD, hist, rot, 1990) == rows
    st = wm.state(AIUD, hist, rot, 1990)
    assert st.shape == (wm.MEMBERS, 48, len(wm.VARIABLES))
    assert np.array_equal(st, wm.state(AIUD, hist, rot, 1990))
    assert wm.summarise(st, AIUD, rot, 1990) == rows
    assert {r.model_version for r in rows} == {"mock-0"}
    assert [(r.plan_year, r.season, r.rotation) for r in rows][-1] == (4, 1993, ">".join(rot))
    for r in rows:
        assert r.yield_rel and r.yield_rel.low <= r.yield_rel.mid <= r.yield_rel.high
    # Not simulated: a null row, and scoring drops it.
    soy = wm.outcomes(AIUD, hist, ["soybean", "wheat", "maize"], 1990)
    assert soy[0].yield_rel is None and soy[1].yield_rel is not None
    assert scoring.score(soy, {}) is None
    assert [len(wm.scenarios(n)) for n in (3, 4, 5)] == [42, 41, 40]


def test_2012_scores_worse_for_maize_than_a_mild_year() -> None:
    s = {y: _score(wm.outcomes(AIUD, ["wheat", "pea"], ["maize"], y), {}) for y in (2005, 2012)}
    assert s[2012].yield_stability < s[2005].yield_stability - 20
    assert s[2012].low_risk < s[2005].low_risk
    assert s[2012].water < s[2005].water
    assert s[2012].total < s[2005].total


def test_water_follows_the_soil_water_balance() -> None:
    # Dry 2012 at Aiud: maize with its NDVI pulled halfway to bare soil uses less water at
    # flowering, against the same good-year demand, so its water part drops.
    row = wm.outcomes(AIUD, ["wheat", "pea"], ["maize"], 2012)[0]
    assert row.ndvi_monthly is not None
    thin = [wm.BARE_NDVI + 0.5 * (v - wm.BARE_NDVI) for v in row.ndvi_monthly]
    assert (
        _score([row.model_copy(update={"ndvi_monthly": thin})], {}).water < _score([row], {}).water
    )
    # Wet 2005: every crop at its reference curve (P90 over seasons) scores close to 100.
    for crop in CROPS:
        rows = [wm.outcomes(AIUD, ["", ""], [crop], s)[0] for s in wm.scenarios(1)]
        ref = np.percentile([r.ndvi_monthly for r in rows], 90, axis=0).tolist()
        wet = rows[2005 - rows[0].season].model_copy(update={"ndvi_monthly": ref})
        assert _score([wet], {}).water > 95, crop
    # A null monthly NDVI drops the rotation; the model's soil moisture and ET are not read.
    assert scoring.score([row.model_copy(update={"ndvi_monthly": None})], {}) is None
    no_sm = row.model_copy(update={"rootzone_sm_critical": None, "et_season_mm": None})
    assert scoring.score([no_sm], {}) == _score([row], {})


def test_reference_curve_without_ndvi_drops_the_rotation(monkeypatch: pytest.MonkeyPatch) -> None:
    # A model with null or NaN monthly NDVI on the unknown-history rows (the reference curve):
    # all of them drops the rotation, some of them builds the curve from the rest, no exception,
    # and the reference cache keeps nothing bad, so the un-patched model scores as before.
    real, piece = wm.outcomes, grid.pieces("A", FIELD_A)[:1]
    hist, rots = {"A": ["wheat", "pea"]}, {"A": ["maize>wheat>pea"]}
    good = scoring.farm_scores(piece, hist, rots, {})
    assert good

    def patch(bad: set[int], value: list[float] | None) -> None:
        def fake(
            point: str, last_two: tuple[str, str], rotation: tuple[str], start: int
        ) -> list[RotationOutcome]:
            rows = real(point, last_two, rotation, start)
            if tuple(last_two) != ("", "") or start not in bad:
                return rows
            return [r.model_copy(update={"ndvi_monthly": value}) for r in rows]

        monkeypatch.setattr(wm, "outcomes", fake)
        scoring._cached_reference_kc.cache_clear()
        scoring._parts.cache_clear()

    for value in (None, [float("nan")] * 12):
        patch({2012}, value)
        assert scoring.farm_scores(piece, hist, rots, {}).keys() == good.keys()
        patch(set(weather.seasons()), value)
        assert scoring.farm_scores(piece, hist, rots, {}) == {}
    monkeypatch.undo()
    scoring._parts.cache_clear()  # its null for this history is a cached model answer
    later = scoring.farm_scores(piece, hist, rots, {})
    assert later.keys() == good.keys() and all((later[k] == good[k]).all() for k in good)


def test_season_without_weather_drops_the_row() -> None:
    row = wm.outcomes(AIUD, ["wheat", "pea"], ["maize"], 2012)[0]
    for season in (weather.seasons().start - 1, weather.seasons().stop):
        assert scoring.score([row.model_copy(update={"season": season})], {}) is None


def test_legume_before_wheat_beats_wheat_after_wheat() -> None:
    for season in (1990, 2005, 2012, 2016):
        after_pea = _score(wm.outcomes(AIUD, ["maize", "pea"], ["wheat"], season), {})
        after_wheat = _score(wm.outcomes(AIUD, ["maize", "wheat"], ["wheat"], season), {})
        assert after_pea.yield_stability > after_wheat.yield_stability


def test_farm_scores_feed_the_optimizer() -> None:
    ps = grid.pieces("A", FIELD_A) + grid.pieces("B", FIELD_B)
    rots = ["pea>wheat>maize>sunflower", "wheat>barley>maize>maize", "soybean>wheat>maize>pea"]
    hist = {"A": ["maize", "wheat"], "B": ["sunflower", "maize"]}
    w = {Priority.YIELD: 3.0, Priority.WATER: 1.0}
    table = scoring.farm_scores(ps, hist, {"A": rots, "B": rots}, w)
    assert set(table) == {(p.piece_id, r) for p in ps for r in rots[:2]}  # soybean: no mock
    assert scoring.farm_scores(ps, hist, {"A": rots, "B": rots}, w).keys() == table.keys()
    tot = scoring.totals(table)
    assert all(len(v) == 41 and all(0 <= t <= 1000 for t in v) for v in tot.values())
    # The fast path equals scoring the world model's rows one scenario at a time.
    p, i = ps[0], 7
    ref = _score(wm.outcomes(p.grid_point_id, hist["A"], rots[0].split(">"), 1982 + i), w)
    assert table[p.piece_id, rots[0]][i].tolist() == list(ref.model_dump().values())
    assert tot[p.piece_id, rots[0]][i] == round(ref.total * 10)
    assert scoring.weight_vector({}).tolist() == [0.25] * 4
    assert scoring.weight_vector(w).tolist() == [0.75, 0.25, 0.0, 0.0]
