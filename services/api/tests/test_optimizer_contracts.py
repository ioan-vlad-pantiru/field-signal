import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from api.contracts import (
    EXPORTED,
    Allocation,
    Confidence,
    Crop,
    OptimizerPlan,
    OptimizerRequest,
    OptimizerResponse,
    Range,
    RotationOutcome,
    RuleCheck,
    ScenarioScore,
    ScoreBreakdown,
)

CONTRACTS_DIR = Path(__file__).resolve().parents[3] / "contracts"

FIELD = {
    "id": "f1",
    "boundary": [
        {"lat": 46.30, "lon": 23.75},
        {"lat": 46.30, "lon": 23.76},
        {"lat": 46.31, "lon": 23.76},
    ],
    "current_rotation": ["maize", "wheat", "maize"],
}
REQUEST = {"fields": [FIELD], "priorities": {"yield": 1, "water": 0.5}}


def _plan(rank: int) -> OptimizerPlan:
    score = ScoreBreakdown(total=60, yield_stability=55, water=70, soil_health=50, low_risk=65)
    return OptimizerPlan(
        rank=rank,
        allocations=[
            Allocation(field_id="f1", area_ha=12.5, sequence=[Crop.MAIZE, Crop.WHEAT, Crop.PEA])
        ],
        score=score,
        score_range=Range(low=40, mid=60, high=75),
        worst=ScenarioScore(start_season=2000, end_season=2002, total=40),
        best=ScenarioScore(start_season=2014, end_season=2016, total=75),
        yearly_areas=[],
        rules=[
            RuleCheck(
                id="legume_share",
                source="PD-04 2026",
                limit_pct=2,
                value_pct=0,
                applies=True,
                passed=False,
                verified=False,
            )
        ],
        confidence=Confidence.LOW,
        proven_optimal=rank > 0,
    )


def test_optimizer_request_round_trips_with_defaults() -> None:
    req = OptimizerRequest.model_validate(REQUEST)
    assert (req.risk_aversion, req.plan_years) == (0.3, 4)
    assert (req.eco_scheme, req.eco_practice) == (False, "diversification")
    assert req.fields[0].crop_history is None
    assert OptimizerRequest.model_validate_json(req.model_dump_json()) == req


def test_optimizer_request_accepts_five_years_and_history() -> None:
    history = ["sunflower", "wheat", "barley", "pea", "maize"]
    req = OptimizerRequest.model_validate(
        {
            **REQUEST,
            "fields": [{**FIELD, "crop_history": history}],
            "plan_years": 5,
            "eco_scheme": True,
            "eco_practice": "legume_share",
        }
    )
    assert req.plan_years == 5
    assert req.fields[0].crop_history == history


@pytest.mark.parametrize(
    "change",
    [
        {"plan_years": 6},
        {"plan_years": 2},
        {"eco_practice": "summer_cover"},
        {"legume_rule": True},  # removed field
        {"fields": [{**FIELD, "crop_history": ["maize"] * 6}]},
        {"risk_aversion": 1.5},
        {"priorities": {"yield": -1}},
        {"fields": []},
        {"fields": [FIELD, FIELD]},  # duplicate id
    ],
)
def test_optimizer_request_rejects_bad_input(change: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        OptimizerRequest.model_validate({**REQUEST, **change})


def test_optimizer_response_round_trips() -> None:
    resp = OptimizerResponse(
        mock=True,
        model_version="mock-0",
        plan_years=3,
        total_area_ha=12.5,
        scenario_count=42,
        scenario_first=1982,
        scenario_last=2023,
        plans=[_plan(1)],
        current=_plan(0),
        caveats=[],
        sources=[],
    )
    assert resp.schema_version == "0.2.0"
    assert OptimizerResponse.model_validate_json(resp.model_dump_json()) == resp


def test_rotation_outcome_round_trips_with_nulls() -> None:
    row = RotationOutcome(
        grid_point_id="46.30125_23.75125",
        rotation="maize>wheat>pea",
        weather_start_season=1987,
        plan_year=2,
        crop=Crop.WHEAT,
        season=1988,
        yield_rel=Range(low=0.8, mid=1.0, high=1.1),
        model_version="mock-0",
    )
    assert row.ndvi_peak is None
    assert RotationOutcome.model_validate_json(row.model_dump_json()) == row


@pytest.mark.parametrize("name", ["optimizer_request", "optimizer_response", "rotation_outcome"])
def test_generated_schema_is_in_sync(name: str) -> None:
    on_disk = json.loads((CONTRACTS_DIR / f"{name}.schema.json").read_text(encoding="utf-8"))
    on_disk.pop("$id")
    assert on_disk == EXPORTED[name].model_json_schema(mode="serialization")


def test_rule_check_carries_verified_and_has_no_summer_cover() -> None:
    rule = _plan(1).rules[0]
    assert (rule.source, rule.verified) == ("PD-04 2026", False)
    with pytest.raises(ValidationError):
        RuleCheck.model_validate({**rule.model_dump(), "id": "summer_cover"})
    with pytest.raises(ValidationError):
        RuleCheck.model_validate({k: v for k, v in rule.model_dump().items() if k != "verified"})
