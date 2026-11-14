"""POST /v1/farm/plan through the API (plan §3.9, T5)."""

import json
import logging
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api.contracts import FarmPlanResponse
from api.main import app
from api.planner import optimizer
from api.planner.crops import RULE_LEGUMES

client = TestClient(app)
EXAMPLE = Path(__file__).resolve().parents[3] / "contracts/examples/farm_plan.mock.json"
# Demo farm near Aiud (46.30 N, 23.75 E): about 37 ha and 8 ha, as in test_planner_model.py.
FIELD_A = [(46.3000, 23.7460), (46.3003, 23.7538), (46.2953, 23.7546), (46.2948, 23.7457)]
FIELD_B = [(46.3022, 23.7560), (46.3024, 23.7607), (46.3004, 23.7609), (46.3002, 23.7558)]
# Two more parcels (about 20 ha and 10 ha): one rotation per field, so a PD-04 practice needs
# enough fields (three crops a year above 30 ha; pea every year needs pea's return interval).
FIELD_C = [(46.2930, 23.7460), (46.2930, 23.7540), (46.2900, 23.7540), (46.2900, 23.7460)]
FIELD_D = [(46.2890, 23.7460), (46.2890, 23.7520), (46.2870, 23.7520), (46.2870, 23.7460)]


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


def _plan(body: dict[str, Any]) -> FarmPlanResponse:
    r = client.post("/v1/farm/plan", json=body)
    assert r.status_code == 200, r.text
    return FarmPlanResponse.model_validate(r.json())


def _en(res: FarmPlanResponse) -> str:
    return "\n".join(c.en for c in res.caveats)


@pytest.fixture(scope="module")
def demo() -> FarmPlanResponse:
    return _plan(_body())


def test_demo_farm(demo: FarmPlanResponse) -> None:
    assert demo.mock is True and demo.model_version == "mock-0"
    assert 44 < demo.total_area_ha < 46 and demo.plan_years == 4
    assert demo.scenario_count == demo.scenario_last - demo.scenario_first + 1
    assert 1 <= len(demo.plans) <= 3
    assert [p.rank for p in demo.plans] == list(range(1, len(demo.plans) + 1))
    assert demo.current is not None and demo.current.rank == 0
    for p in [*demo.plans, demo.current]:
        assert p.confidence == "low"
        assert sorted(a.field_id for a in p.allocations) == ["f1", "f2"]  # one rotation per field
        area = sum(a.area_ha for a in p.allocations)
        assert area == pytest.approx(demo.total_area_ha)
        assert p.score_range.low <= p.score_range.mid <= p.score_range.high
        assert p.worst.total == p.score_range.low and p.best.total == p.score_range.high
    assert demo.current.proven_optimal is False
    assert all(len(c.ro) > 0 for c in demo.caveats)


def test_default_enforces_no_eco_rule(demo: FarmPlanResponse) -> None:
    assert demo.current is not None
    for p in [*demo.plans, demo.current]:
        assert p.rules and not any(r.applies for r in p.rules)
        assert not any(r.verified for r in p.rules)
    en = _en(demo)
    assert "GAEC 7 reading is provisional" in en
    assert "Soil cover" in en and "Eligibility and exemptions are not checked" in en
    assert "No eco-scheme (PD-04) rule was enforced" in en
    assert "assumed from the current rotation" in en
    assert "best solution found" in en and "alternatives" in en
    assert "Each field carries one rotation, one crop per year on its whole area" in en
    assert "area split" not in en and "which part of a field" not in en
    assert "shown as optimal only when the solver proves it" in en
    assert "the weather of its NASA POWER cell" in en and "whole farm" not in en
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


def test_two_field_farm_drops_diversification() -> None:
    # 45 ha, two parcels: at most two crops a year, so the 90 % two-crop limit cannot hold.
    res = _plan(_body(eco_scheme=True, eco_practice="diversification"))
    assert res.plans and not any(r.applies for p in res.plans for r in p.rules)
    en = _en(res)
    assert "No plan meeting the selected PD-04 practice (crop diversification)" in en
    assert "above 30 ha the two largest crops must stay under 90 %" in en
    assert "at least three fields" in en


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
    r = client.post("/v1/farm/plan", json=body)
    assert r.status_code == 422
    assert message in r.json()["detail"]


def test_example_is_valid() -> None:
    res = FarmPlanResponse.model_validate(json.loads(EXAMPLE.read_text()))
    assert res.mock is True and res.model_version == "mock-0" and res.plans
    web = EXAMPLE.parents[2] / "apps/web/src/mocks/farm_plan.mock.json"
    assert web.read_text() == EXAMPLE.read_text()


def test_dropped_practice_explains_why(monkeypatch: pytest.MonkeyPatch) -> None:
    # The practice found no plan in time (or does not fit) and the retry found none either.
    def no_plan(*args: Any, **kwargs: Any) -> optimizer.FarmSolve:
        return optimizer.FarmSolve([], "UNKNOWN", None, True, False)

    monkeypatch.setattr(optimizer, "solve_farm", no_plan)  # service calls it via the module
    res = _plan(_body(eco_scheme=True, eco_practice="legume_share"))
    assert res.plans == [] and res.current is not None
    en = _en(res)
    assert "No plan meeting the selected PD-04 practice (legume share)" in en
    assert "pea returns to a field only after 4 years" in en
    assert "the farm needs at least 4 fields to grow pea every year" in en
    assert "infeasible" not in en


def test_rule_checks_count_soybean_as_legume() -> None:
    rots = ["soybean>wheat>maize", "wheat>maize>soybean", "maize>soybean>wheat"]
    alloc = {(f"p{i}", r): 100 for i, r in enumerate(rots)}
    rows = optimizer.rule_checks(alloc, RULE_LEGUMES, None)
    legume = next(r for r in rows if r.id == "legume_share")
    assert legume.value_pct == pytest.approx(33.3) and legume.passed


def test_stage_times_are_logged_at_info() -> None:
    assert logging.getLogger("api.planner.service").isEnabledFor(logging.INFO)
    assert logging.getLogger().handlers  # root handler, so they reach the console under uvicorn
