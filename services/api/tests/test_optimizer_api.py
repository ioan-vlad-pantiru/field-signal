"""POST /v1/farm/optimize through the API (plan §3.9, T5)."""

import json
import logging
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api.contracts import OptimizerResponse
from api.main import app
from api.planner import grid, optimizer
from api.planner.crops import RULE_LEGUMES

client = TestClient(app)
EXAMPLE = Path(__file__).resolve().parents[3] / "contracts/examples/optimizer.mock.json"
# Demo farm near Aiud (46.30 N, 23.75 E): about 37 ha and 8 ha, as in test_planner_model.py.
FIELD_A = [(46.3000, 23.7460), (46.3003, 23.7538), (46.2953, 23.7546), (46.2948, 23.7457)]
FIELD_B = [(46.3022, 23.7560), (46.3024, 23.7607), (46.3004, 23.7609), (46.3002, 23.7558)]
# Two more parcels (about 20 ha and 10 ha): one rotation per field, so a PD-04 practice needs
# enough fields (three crops a year above 30 ha; pea every year needs pea's return interval).
FIELD_C = [(46.2930, 23.7460), (46.2930, 23.7540), (46.2900, 23.7540), (46.2900, 23.7460)]
FIELD_D = [(46.2890, 23.7460), (46.2890, 23.7520), (46.2870, 23.7520), (46.2870, 23.7460)]


def _rectangle(ha: float) -> list[tuple[float, float]]:
    """A 0.006° tall rectangle near Aiud whose width is scaled to `ha` with the grid's own
    projection (the one `grid.area_ha` uses at the rectangle's middle latitude)."""
    north, south, west = 46.300, 46.294, 23.740
    mx, my = grid.metres_per_degree((north + south) / 2)
    east = west + ha * 10_000 / (mx * my * (north - south))
    return [(north, west), (north, east), (south, east), (south, west)]


def _field(fid: str, boundary: list[tuple[float, float]], **kw: Any) -> dict[str, Any]:
    return {
        "id": fid,
        "boundary": [{"lat": lat, "lon": lon} for lat, lon in boundary],
        "current_rotation": ["maize", "wheat", "maize"],
        **kw,
    }


def _body(**kw: Any) -> dict[str, Any]:
    return {
        "fields": [_field("f1", FIELD_A), _field("f2", FIELD_B)],
        "priorities": {"yield": 0.5, "water": 0.8, "soil": 0.6, "risk": 0.4},
        **kw,
    }


def _plan(body: dict[str, Any]) -> OptimizerResponse:
    r = client.post("/v1/farm/optimize", json=body)
    assert r.status_code == 200, r.text
    return OptimizerResponse.model_validate(r.json())


def _en(res: OptimizerResponse) -> str:
    return "\n".join(c.en for c in res.caveats)


@pytest.fixture(scope="module")
def demo() -> OptimizerResponse:
    return _plan(_body())


def test_demo_farm(demo: OptimizerResponse) -> None:
    assert demo.mock is True and demo.model_version == "mock-0"
    assert 44 < demo.total_area_ha < 46 and demo.plan_years == 4
    assert demo.scenario_count == demo.scenario_last - demo.scenario_first + 1
    assert 1 <= len(demo.plans) <= 3
    assert [p.rank for p in demo.plans] == list(range(1, len(demo.plans) + 1))
    assert demo.current is not None and demo.current.rank == 0
    for p in [*demo.plans, demo.current]:
        assert p.confidence == "low"
        # 45 ha: split mode; f2 (8.4 ha) stays whole, f1 holds up to 3 rotations of 5 ha or more.
        per_field = [a.field_id for a in p.allocations]
        assert per_field.count("f2") == 1 and 1 <= per_field.count("f1") <= 3
        assert all(a.area_ha >= 5 for a in p.allocations if a.field_id == "f1")
        area = sum(a.area_ha for a in p.allocations)
        assert area == pytest.approx(demo.total_area_ha)
        assert p.score_range.low <= p.score_range.mid <= p.score_range.high
        assert p.worst.total == p.score_range.low and p.best.total == p.score_range.high
    assert demo.current.proven_optimal is False
    assert all(len(c.ro) > 0 for c in demo.caveats)


def test_default_enforces_no_eco_rule(demo: OptimizerResponse) -> None:
    assert demo.current is not None
    for p in [*demo.plans, demo.current]:
        assert p.rules and not any(r.applies for r in p.rules)
        assert all(r.verified for r in p.rules)
    en = _en(demo)
    assert "GAEC 7 asks for rotation" in en and "APIA 2026 guides" in en
    assert "Soil cover" in en and "Eligibility and exemptions are not checked" in en
    assert "No eco-scheme (PD-04) rule was enforced" in en
    assert "assumed from the current rotation" in en
    assert "best solution found" in en and "alternatives" in en
    assert "Each field carries one rotation" in en and "as the EU crop rotation rule" in en
    assert "Areas are hectares, not drawn boundaries" not in en
    assert "Rule shares are computed over the selected fields only" in en
    assert "area split" not in en and "which part of a field" not in en
    assert "shown as optimal only when the solver proves it" in en
    assert "the weather of its NASA POWER cell" in en and "whole farm" not in en
    assert "modelled monthly balance of rain and crop water use" in en
    assert "assumed refilled each winter; it is not a measurement" in en
    assert "just across the border" in en
    assert "proven_optimal" not in en
    for c in demo.caveats:
        for text in (c.ro, c.en):
            assert "complian" not in text.lower() and "conform" not in text.lower()
            assert " met" not in text


@pytest.mark.parametrize(
    ("practice", "rules"),
    [
        ("diversification", {"max_crop_share", "max_two_crops_share"}),
        ("legume_share", {"legume_share"}),
    ],
)
def test_eco_scheme_applies_the_chosen_practice_only(practice: str, rules: set[str]) -> None:
    body = _body(eco_scheme=True, eco_practice=practice)
    body["fields"] += [_field("f3", FIELD_C), _field("f4", FIELD_D)]
    res = _plan(body)
    assert res.plans
    for p in res.plans:
        applied = {(r.id, r.source) for r in p.rules if r.applies}
        assert applied == {(r, "PD-04 2026") for r in rules}
        assert all(r.passed for r in p.rules if r.applies)
    assert res.current is not None and not any(r.applies for r in res.current.rules)
    assert "One PD-04 practice was enforced" in _en(res)


@pytest.mark.parametrize("ha", [20.0, 74.99])
def test_without_the_eco_scheme_every_field_stays_whole(ha: float) -> None:
    body = _body()
    body["fields"] = [_field("f1", _rectangle(ha))]
    res = _plan(body)
    assert res.plans
    for p in res.plans:
        assert len(p.allocations) == 1 and p.allocations[0].field_id == "f1"
        crop_change = next(r for r in p.rules if r.id == "crop_change")
        assert crop_change.passed and crop_change.value_pct == 0
    assert "Each field carries one rotation" in _en(res)


@pytest.mark.parametrize(("ha", "rotations"), [(20.0, 2), (40.0, 3)])
def test_one_field_diversification_splits_by_the_rule_bands(ha: float, rotations: int) -> None:
    """PD-04 diversification on one field: 2 crops a year between 10 and 30 ha, 3 above 30 ha."""
    body = _body(eco_scheme=True, eco_practice="diversification")
    body["fields"] = [_field("f1", _rectangle(ha))]
    res = _plan(body)
    assert res.plans
    assert "One PD-04 practice was enforced: crop diversification" in _en(res)
    assert f"may be divided between up to {rotations} rotations" in _en(res)
    for p in res.plans:
        assert len(p.allocations) == rotations
        assert all(r.passed for r in p.rules if r.applies)


def test_priorities_change_the_plan() -> None:
    a = _plan(_body(priorities={"yield": 1}))
    b = _plan(_body(priorities={"soil": 1}))
    assert (a.plans[0].score, a.plans[0].allocations) != (b.plans[0].score, b.plans[0].allocations)


def test_five_years() -> None:
    res = _plan(_body(plan_years=5))
    assert res.plan_years == 5 and res.plans
    assert all(len(a.sequence) == 5 for p in res.plans for a in p.allocations)
    assert all(len(p.yearly_areas) == 5 for p in res.plans)


def test_soybean_rotation_has_no_baseline_and_history_is_used() -> None:
    body = _body()
    body["fields"] = [
        _field("f1", FIELD_A, current_rotation=["soybean", "wheat"], crop_history=["wheat", "pea"])
    ]
    res = _plan(body)
    assert res.current is None and res.plans
    en = _en(res)
    assert "current rotation is not scored" in en
    assert "assumed from the current rotation" not in en


@pytest.mark.parametrize(
    ("boundary", "message"),
    [
        ([(47.50, 19.00), (47.50, 19.01), (47.49, 19.01)], "outside"),  # Budapest: off the grid
        ([(47.50, 20.60), (47.50, 20.61), (47.49, 20.61)], "No NASA POWER"),  # Hungary, on grid
        ([(46.30, 23.75), (46.30, 23.76), (46.30, 23.77)], "crosses or touches"),  # a line
        ([(46.3, 23.75), (46.3, 23.7501), (46.2999, 23.7501)], "area rounds to 0 ha"),  # ~0.04 ha
        ([(46.30, 23.75), (46.29, 23.76), (46.30, 23.76), (46.29, 23.75)], "crosses or touches"),
        ([(46.30, 23.70), (46.30, 23.80), (46.20, 23.80), (46.20, 23.70)], "pieces"),  # ~860 ha
        ([(46.30, 23.40), (46.30, 23.80), (46.00, 23.80), (46.00, 23.40)], "bounding box spans"),
    ],
    ids=["outside-grid", "no-weather", "line", "tiny", "bow-tie", "too-many-pieces", "huge-box"],
)
def test_unplannable_field_is_422(boundary: list[tuple[float, float]], message: str) -> None:
    body = _body()
    body["fields"] = [_field("f1", boundary)]
    r = client.post("/v1/farm/optimize", json=body)
    assert r.status_code == 422
    assert message in r.json()["detail"]


def test_example_is_valid() -> None:
    res = OptimizerResponse.model_validate(json.loads(EXAMPLE.read_text()))
    assert res.mock is True and res.model_version == "mock-0" and res.plans
    web = EXAMPLE.parents[2] / "apps/web/src/mocks/optimizer.mock.json"
    assert web.read_text() == EXAMPLE.read_text()


def test_dropped_practice_explains_why(monkeypatch: pytest.MonkeyPatch) -> None:
    # The practice found no plan in time (or does not fit) and the retry found none either.
    def no_plan(*args: Any, **kwargs: Any) -> optimizer.FarmSolve:
        return optimizer.FarmSolve([], "UNKNOWN", None, True, False)

    monkeypatch.setattr(optimizer, "solve_farm", no_plan)  # service calls it via the module
    split = _body(eco_scheme=True, eco_practice="legume_share")  # 45 ha
    parcel = _body(eco_scheme=True, eco_practice="legume_share")  # about 76 ha
    parcel["fields"] += [_field("f3", FIELD_C), _field("f4", FIELD_D)]
    for body in (split, parcel):
        res = _plan(body)
        assert res.plans == [] and res.current is not None
        en = _en(res)
        assert "No plan meeting the selected PD-04 practice (legume share)" in en
        assert "infeasible" not in en.lower()
        # Legumes never split a field: one rotation each, pea back only after 4 years.
        assert "the farm needs at least 4 fields to grow pea every year" in en
        assert "75 ha" not in en


def test_split_search_out_of_time_keeps_fields_whole(monkeypatch: pytest.MonkeyPatch) -> None:
    """§10.11: the split solves (stubbed) find no plan in time; the 45 ha farm still gets parcel
    mode's plans, not proven optimal, and a caveat says why."""
    real = optimizer._rank

    def no_split(*args: Any) -> Any:
        return ([], "UNKNOWN", [3.0]) if args[9] else real(*args)

    monkeypatch.setattr(optimizer, "_rank", no_split)
    res = _plan(_body(eco_scheme=True, eco_practice="diversification"))
    assert len(res.plans) == 3
    for p in res.plans:
        assert sorted(a.field_id for a in p.allocations) == ["f1", "f2"] and not p.proven_optimal
    whole = [c for c in res.caveats if "Every field is kept whole in these plans" in c.en]
    assert len(whole) == 1 and "fiecare câmp rămâne întreg" in whole[0].ro
    assert "only the plans found until then" not in _en(res)


def test_rule_checks_count_soybean_as_legume() -> None:
    rots = ["soybean>wheat>maize", "wheat>maize>soybean", "maize>soybean>wheat"]
    alloc = {(f"p{i}", r): 100 for i, r in enumerate(rots)}
    rows = optimizer.rule_checks(alloc, RULE_LEGUMES, None)
    legume = next(r for r in rows if r.id == "legume_share")
    assert legume.value_pct == pytest.approx(33.3) and legume.passed


def test_stage_times_are_logged_at_info() -> None:
    assert logging.getLogger("api.planner.service").isEnabledFor(logging.INFO)
    assert logging.getLogger().handlers  # root handler, so they reach the console under uvicorn
