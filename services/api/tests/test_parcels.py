from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import parcels
from api.main import app
from api.settings import get_settings

# Two small squares near Aiud, side by side, and one far away near Sebeș.
SQUARE_A = [(23.70, 46.30), (23.71, 46.30), (23.71, 46.31), (23.70, 46.31)]
SQUARE_B = [(23.71, 46.30), (23.72, 46.30), (23.72, 46.31), (23.71, 46.31)]
FAR = [(23.57, 45.95), (23.58, 45.95), (23.58, 45.96), (23.57, 45.96)]
HISTORY = {
    "crop_history": [
        {"year": 2018, "crop": "maize", "share": 0.8},
        {"year": 2022, "crop": "common_wheat", "share": 0.7},
    ],
    "soil": {"soc_g_per_kg": 14.9, "ph_h2o": 6.6, "clay_pct": 33.1, "sand_pct": 21.6},
}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    path = tmp_path / "parcels.sqlite"
    written = parcels.write_db(
        path,
        [
            (1, 7.5, "TA", SQUARE_A, HISTORY),
            (2, 3.25, "PP", SQUARE_B, None),
            (3, 1.0, "TA", FAR, None),
        ],
    )
    assert written == 3
    monkeypatch.setattr(get_settings(), "parcels_path", path)
    parcels._connect.cache_clear()
    return TestClient(app)


def test_returns_parcels_in_the_box(client: TestClient) -> None:
    res = client.get(
        "/v1/parcels", params={"west": 23.69, "south": 46.29, "east": 23.73, "north": 46.32}
    )
    assert res.status_code == 200
    body = res.json()
    assert sorted(p["id"] for p in body["parcels"]) == [1, 2]
    assert body["truncated"] is False
    assert "APIA" in body["source"]
    first = next(p for p in body["parcels"] if p["id"] == 1)
    assert first["land_use"] == "TA"
    assert first["area_ha"] == 7.5
    assert first["boundary"][0] == {"lat": 46.30, "lon": 23.70}
    assert len(first["boundary"]) == 4
    assert [c["crop"] for c in first["crop_history"]] == ["maize", "common_wheat"]
    assert first["soil"]["clay_pct"] == 33.1
    second = next(p for p in body["parcels"] if p["id"] == 2)
    assert second["crop_history"] == [] and second["soil"] is None


def test_box_touching_one_parcel(client: TestClient) -> None:
    res = client.get(
        "/v1/parcels", params={"west": 23.565, "south": 45.945, "east": 23.575, "north": 45.955}
    )
    assert [p["id"] for p in res.json()["parcels"]] == [3]


def test_large_box_is_refused(client: TestClient) -> None:
    res = client.get(
        "/v1/parcels", params={"west": 23.0, "south": 46.0, "east": 24.0, "north": 47.0}
    )
    assert res.status_code == 422


def test_empty_box_is_refused(client: TestClient) -> None:
    res = client.get(
        "/v1/parcels", params={"west": 23.72, "south": 46.3, "east": 23.70, "north": 46.31}
    )
    assert res.status_code == 422


def test_no_file_means_not_available(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "parcels_path", tmp_path / "missing.sqlite")
    res = TestClient(app).get(
        "/v1/parcels", params={"west": 23.69, "south": 46.29, "east": 23.73, "north": 46.32}
    )
    assert res.status_code == 404


def test_merge_joins_touching_parcels(client: TestClient) -> None:
    res = client.post("/v1/parcels/merge", json={"ids": [2, 1]})
    assert res.status_code == 200
    body = res.json()
    assert body["parcel_ids"] == [1, 2]
    assert body["area_ha"] == 10.75
    lons = [c["lon"] for c in body["boundary"]]
    lats = [c["lat"] for c in body["boundary"]]
    # One rectangle from 23.70 to 23.72: the shared edge is gone.
    assert min(lons) == pytest.approx(23.70, abs=1e-5)
    assert max(lons) == pytest.approx(23.72, abs=1e-5)
    assert min(lats) == pytest.approx(46.30, abs=1e-5)
    assert max(lats) == pytest.approx(46.31, abs=1e-5)
    assert len(body["boundary"]) == 4


def test_merge_refuses_parcels_far_apart(client: TestClient) -> None:
    res = client.post("/v1/parcels/merge", json={"ids": [1, 3]})
    assert res.status_code == 422
    assert res.json()["detail"] == "not_touching"


def test_merge_unknown_parcel(client: TestClient) -> None:
    assert client.post("/v1/parcels/merge", json={"ids": [1, 99]}).status_code == 404


def test_merge_closes_a_farm_track(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Two strips 10 m apart (a track between them): one field.
    gap = 10 / 111_320 / 0.69
    left = [(23.70, 46.30), (23.701, 46.30), (23.701, 46.301), (23.70, 46.301)]
    right = [
        (23.701 + gap, 46.30),
        (23.702 + gap, 46.30),
        (23.702 + gap, 46.301),
        (23.701 + gap, 46.301),
    ]
    path = tmp_path / "track.sqlite"
    parcels.write_db(path, [(1, 0.8, "TA", left, None), (2, 0.8, "TA", right, None)])
    monkeypatch.setattr(get_settings(), "parcels_path", path)
    parcels._connect.cache_clear()
    assert TestClient(app).post("/v1/parcels/merge", json={"ids": [1, 2]}).status_code == 200
