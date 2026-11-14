from collections.abc import Iterator

import pytest

from api import field_model
from api.contracts import FieldRequest
from api.planner import scoring
from api.planner import world_model as wm

REQUEST = {
    "location": {"lat": 46.30, "lon": 23.75},
    "current_rotation": ["maize", "soybean", "wheat"],
    "priorities": {"water": 0.8, "soil": 0.6, "yield": 0.5, "risk": 0.4},
}


@pytest.fixture(autouse=True)
def _fresh_scoring_caches() -> Iterator[None]:
    """Scoring caches are keyed without the model: clear them so the trained model's rows never
    leak into the mock-pinned planner tests."""
    scoring._parts.cache_clear()
    scoring._cached_reference_kc.cache_clear()
    yield
    scoring._parts.cache_clear()
    scoring._cached_reference_kc.cache_clear()


@pytest.mark.skipif(not wm.available(), reason="world model inputs not built")
def test_analysis_comes_from_the_trained_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_WORLD_MODEL", "lstm")
    a = field_model.run(FieldRequest.model_validate(REQUEST))
    assert a.mock is False and len(a.strategies) >= 3
    current = a.strategies[0]
    assert current.is_current and [str(c) for c in current.sequence] == REQUEST["current_rotation"]
    assert [s.year for s in current.replay] == field_model.YEARS
    assert {i.id for i in a.indicators} >= {"model_ndvi_peak", "jul_hot_days"}
    assert a.soil.clay_pct is not None and "soybean" in " ".join(c.en for c in a.caveats)
    best = max(s.score.total for s in a.strategies[1:])
    assert best >= current.score.total  # alternatives are the model's best rotations


def test_mock_when_the_model_is_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_WORLD_MODEL", "mock")
    assert field_model.run(FieldRequest.model_validate(REQUEST)).mock is True
