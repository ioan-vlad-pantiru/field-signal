from collections import defaultdict

import pytest
from fastapi.testclient import TestClient

from api import farm_plan
from api.analysis import run_field_analysis
from api.contracts import (
    Crop,
    FarmPlan,
    FarmPlanRequest,
    FieldAnalysis,
    FieldRequest,
    LatLon,
    PlanField,
)
from api.main import app

POINT = LatLon(lat=46.30, lon=23.75)
THREE_CROPS = [Crop.MAIZE, Crop.SOYBEAN, Crop.WHEAT]


def _field(i: int, area: float = 10.0, last: Crop | None = None) -> PlanField:
    return PlanField(id=f"f{i}", name=f"Sola {i}", area_ha=area, location=POINT, last_crop=last)


def _request(fields: list[PlanField], years: int = 3) -> FarmPlanRequest:
    return FarmPlanRequest(fields=fields, priorities={"yield": 1.0}, start_year=2027, years=years)


@pytest.fixture
def three_crop_rotation(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Make the best strategy a 3-crop rotation; count how many analyses are run."""
    calls: list[int] = []

    def fake(request: FieldRequest) -> FieldAnalysis:
        calls.append(1)
        analysis = run_field_analysis(request)
        strategies = [
            s.model_copy(update={"sequence": THREE_CROPS}) if s.id == "soy-break" else s
            for s in analysis.strategies
        ]
        best = max(strategies, key=lambda s: s.score.total)
        top = best.score.model_copy(update={"total": 99.0})
        strategies = [
            s.model_copy(update={"score": top}) if s.id == "soy-break" else s for s in strategies
        ]
        return analysis.model_copy(update={"strategies": strategies})

    monkeypatch.setattr(farm_plan, "run_field_analysis", fake)
    return calls


def test_stagger_gives_three_equal_fields_three_crops_each_year(
    three_crop_rotation: list[int],
) -> None:
    plan = farm_plan.plan_farm(_request([_field(1), _field(2), _field(3)]))
    assert all(f.sequence == THREE_CROPS for f in plan.fields)
    for i in range(len(plan.years)):
        assert {f.crops[i] for f in plan.fields} == set(THREE_CROPS)
    # one area per crop per year, all equal
    assert {t.area_ha for t in plan.totals} == {10.0}
    # the fields share a point: one analysis serves all three
    assert len(three_crop_rotation) == 1


def test_last_crop_is_not_repeated(three_crop_rotation: list[int]) -> None:
    fields = [_field(1, last=Crop.MAIZE), _field(2, last=Crop.SOYBEAN), _field(3, last=Crop.WHEAT)]
    plan = farm_plan.plan_farm(_request(fields))
    for f, p in zip(fields, plan.fields, strict=True):
        assert p.crops[0] != f.last_crop
    check = next(c for c in plan.checks if c.id == "no_repeat")
    assert check.ok


def test_deterministic(three_crop_rotation: list[int]) -> None:
    req = _request([_field(1, 7), _field(2, 12, Crop.WHEAT), _field(3, 3)], years=5)
    assert farm_plan.plan_farm(req) == farm_plan.plan_farm(req)


def test_totals_sum_to_farm_area_each_year() -> None:
    fields = [_field(1, 12.5), _field(2, 3.25, Crop.SUNFLOWER), _field(3, 40.0, Crop.WHEAT)]
    plan = farm_plan.plan_farm(_request(fields, years=6))
    assert plan.years == list(range(2027, 2033))
    per_year: dict[int, float] = defaultdict(float)
    for t in plan.totals:
        per_year[t.year] += t.area_ha
    assert set(per_year) == set(plan.years)
    for total in per_year.values():
        assert total == pytest.approx(55.75)
    assert all(len(f.crops) == 6 for f in plan.fields)
    assert plan.mock
    assert {c.id for c in plan.checks} == {"no_repeat", "diversity", "legumes", "maize_share"}


def test_repeat_check_flags_a_crop_that_follows_itself(monkeypatch: pytest.MonkeyPatch) -> None:
    # Make the current rotation (maize, wheat, maize) the best: maize follows itself on wrap.
    def fake(request: FieldRequest) -> FieldAnalysis:
        analysis = run_field_analysis(request)
        strategies = [
            s.model_copy(update={"score": s.score.model_copy(update={"total": 99.0})})
            if s.is_current
            else s
            for s in analysis.strategies
        ]
        return analysis.model_copy(update={"strategies": strategies})

    monkeypatch.setattr(farm_plan, "run_field_analysis", fake)
    plan = farm_plan.plan_farm(_request([_field(1)], years=4))
    assert plan.fields[0].sequence == [Crop.MAIZE, Crop.WHEAT, Crop.MAIZE]
    check = next(c for c in plan.checks if c.id == "no_repeat")
    assert not check.ok
    assert "Sola 1" in check.detail.en


def test_endpoint_returns_a_valid_plan() -> None:
    body = {
        "fields": [
            {
                "id": "a",
                "name": "La drum",
                "area_ha": 8.4,
                "location": {"lat": 46.31, "lon": 23.72},
                "current_rotation": ["maize", "wheat"],
                "last_crop": "maize",
            },
            {"id": "b", "name": "Vale", "area_ha": 5, "location": {"lat": 46.2, "lon": 23.6}},
        ],
        "priorities": {"yield": 0.6, "water": 0.4},
        "start_year": 2027,
    }
    response = TestClient(app).post("/v1/farm/plan", json=body)
    assert response.status_code == 200, response.text
    plan = FarmPlan.model_validate(response.json())
    assert plan.years == [2027, 2028, 2029, 2030]
    assert [f.field_id for f in plan.fields] == ["a", "b"]
    assert plan.fields[0].crops[0] != "maize"


def test_endpoint_rejects_empty_farm() -> None:
    response = TestClient(app).post(
        "/v1/farm/plan", json={"fields": [], "priorities": {}, "start_year": 2027}
    )
    assert response.status_code == 422
