import json
from pathlib import Path

from fastapi.testclient import TestClient

from api.contracts import FeatureRow, FieldAnalysis, SourcingRegion
from api.main import app

client = TestClient(app)


def test_analyze_field_returns_valid_mock() -> None:
    response = client.post(
        "/v1/fields/analyze",
        json={
            "location": {"lat": 46.30, "lon": 23.75},
            "current_rotation": ["maize", "wheat", "maize"],
            "priorities": {"water": 0.8, "soil": 0.6, "yield": 0.5, "risk": 0.4},
        },
    )
    assert response.status_code == 200
    body = FieldAnalysis.model_validate(response.json())
    assert body.mock is True
    assert len(body.strategies) >= 3
    assert sum(s.is_current for s in body.strategies) == 1
    assert len(body.indicators) >= 3
    years = {p.year for p in body.indicators[0].series}
    assert len(years) >= 5


def test_analyze_field_rejects_unknown_crop() -> None:
    response = client.post(
        "/v1/fields/analyze",
        json={
            "location": {"lat": 46.30, "lon": 23.75},
            "current_rotation": ["maize", "banana"],
            "priorities": {},
        },
    )
    assert response.status_code == 422


def test_sourcing_region_returns_valid_mock() -> None:
    response = client.get("/v1/sourcing/region", params={"season": 2025})
    assert response.status_code == 200
    body = SourcingRegion.model_validate(response.json())
    assert body.mock is True
    assert body.zones
    s = body.scenario
    for r in (s.added_area_ha, s.added_production_t, s.added_protein_t):
        assert r.low <= r.mid <= r.high


def test_feature_row_example_is_valid() -> None:
    path = Path(__file__).resolve().parents[3] / "contracts/examples/feature_row.example.json"
    rows = [FeatureRow.model_validate(r) for r in json.loads(path.read_text())]
    assert {r.zone_type for r in rows} == {"field", "commune", "county"}
