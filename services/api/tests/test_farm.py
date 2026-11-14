import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import parcels
from api.contracts import Parcel
from api.farm import suggest_fields
from api.main import app
from api.settings import get_settings

# A row of three 100 m x 200 m strips near Aiud, touching, then one 3 km away.
DLON = 100 / (111_320 * 0.6902)  # 100 m in longitude at 46.3° N
DLAT = 200 / 110_540


def strip(i: int, lon0: float = 23.70) -> list[tuple[float, float]]:
    w = lon0 + i * DLON
    return [(w, 46.30), (w + DLON, 46.30), (w + DLON, 46.30 + DLAT), (w, 46.30 + DLAT)]


def history(*crops: str | None) -> dict[str, object]:
    years = (2018, 2022)
    return {
        "crop_history": [
            {"year": y, "crop": c, "share": 0.9 if c else 0.0}
            for y, c in zip(years, crops, strict=True)
        ]
    }


ROWS = [
    (1, 2.0, "TA", strip(0), history("maize", "common_wheat")),
    (2, 2.0, "TA", strip(1), history("maize", "common_wheat")),
    (3, 2.0, "TA", strip(2), history("sunflower", "maize")),
    (4, 2.0, "TA", strip(0, lon0=23.74), history("maize", "common_wheat")),
]


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    path = tmp_path / "parcels.sqlite"
    parcels.write_db(path, ROWS)
    monkeypatch.setattr(get_settings(), "parcels_path", path)
    parcels._connect.cache_clear()
    parcels._has_info.cache_clear()
    return TestClient(app)


def as_parcels() -> list[Parcel]:
    return [
        Parcel.model_validate(
            {
                "id": pid,
                "area_ha": area,
                "land_use": lu,
                "boundary": [{"lon": x, "lat": y} for x, y in ring],
                **info,
            }
        )
        for pid, area, lu, ring, info in ROWS
    ]


def test_suggest_groups_same_crops_and_splits_different_ones() -> None:
    fields = suggest_fields(as_parcels()[:3], {})
    groups = sorted(f.parcel_ids for f in fields)
    assert groups == [[1, 2], [3]]
    assert "maize" in fields[0].reason.en


def test_suggest_joins_far_parcels_with_the_same_known_crops() -> None:
    # Parcel 4 is 3 km away: too far for one field.
    fields = suggest_fields(as_parcels(), {})
    assert sorted(f.parcel_ids for f in fields) == [[1, 2], [3], [4]]


def test_suggest_declared_crop_separates_neighbours() -> None:
    fields = suggest_fields(as_parcels()[:2], {1: "porumb", 2: "grâu"})
    assert sorted(f.parcel_ids for f in fields) == [[1], [2]]


def test_tiny_group_joins_its_neighbour() -> None:
    small = as_parcels()[:3]
    small[2] = small[2].model_copy(update={"area_ha": 0.4})
    fields = suggest_fields(small, {})
    assert sorted(f.parcel_ids for f in fields) == [[1, 2, 3]]


def test_suggest_endpoint(client: TestClient) -> None:
    body = {"parcels": [p.model_dump() for p in as_parcels()[:3]]}
    res = client.post("/v1/farm/suggest", json=body)
    assert res.status_code == 200
    assert sorted(f["parcel_ids"] for f in res.json()["fields"]) == [[1, 2], [3]]


FIXTURES = Path(__file__).parent / "fixtures"


def test_import_shapefile_matches_parcels(client: TestClient) -> None:
    # A zipped shapefile in Stereo 70 (as APIA exports): strips 1 and 3 slightly shrunk, as a
    # farmer's own drawing would be, and one outline where there is no parcel.
    data = (FIXTURES / "export_stereo70.zip").read_bytes()
    res = client.post("/v1/farm/import", params={"filename": "export.zip"}, content=data)
    assert res.status_code == 200, res.text
    body = res.json()
    assert sorted(p["id"] for p in body["parcels"]) == [1, 3]
    assert body["unmatched"] == 1
    assert body["source_crs"] == "EPSG:3844"
    assert body["file_crops"] == {"1": "porumb", "3": "floarea-soarelui"}
    assert body["parcels"][0]["crop_history"][0]["crop"] == "maize"


def test_import_geojson(client: TestClient) -> None:
    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "Polygon", "coordinates": [[*strip(1), strip(1)[0]]]},
            }
        ],
    }
    res = client.post(
        "/v1/farm/import", params={"filename": "farm.geojson"}, content=json.dumps(geojson)
    )
    assert res.status_code == 200, res.text
    assert [p["id"] for p in res.json()["parcels"]] == [2]


def test_import_rejects_other_files(client: TestClient) -> None:
    res = client.post("/v1/farm/import", params={"filename": "notes.txt"}, content=b"hello")
    assert res.status_code == 422


def test_rematch_by_outline(client: TestClient) -> None:
    old = as_parcels()[1].model_copy(update={"id": 999})  # same outline, last year's id
    res = client.post("/v1/farm/rematch", json=[old.model_dump()])
    assert res.status_code == 200
    assert [p["id"] for p in res.json()["parcels"]] == [2]
