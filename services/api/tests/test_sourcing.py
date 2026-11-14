from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import mocks, sourcing
from api.main import app


@pytest.fixture
def built(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "sourcing_alba.json"
    monkeypatch.setattr(sourcing, "BUILT", path)
    sourcing._built.cache_clear()
    return path


def test_demo_when_nothing_is_built(built: Path) -> None:
    body = TestClient(app).get("/v1/sourcing/region").json()
    assert body["mock"] is True


def test_serves_the_built_region(built: Path) -> None:
    real = mocks.sourcing_region(2025).model_copy(update={"mock": False, "region_name": "Alba"})
    built.write_text(real.model_dump_json(), encoding="utf-8")
    client = TestClient(app)
    body = client.get("/v1/sourcing/region").json()
    assert body["mock"] is False and body["region_name"] == "Alba"
    # Another season is not built: demo again.
    assert client.get("/v1/sourcing/region", params={"season": 2019}).json()["mock"] is True
