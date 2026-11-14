import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from api import accounts
from api.main import app
from api.settings import get_settings

FIELD = {
    "name": "Behind the barn",
    "request": {
        "location": {"lat": 46.3, "lon": 23.72},
        "current_rotation": ["maize", "wheat"],
        "priorities": {"yield": 0.5, "water": 0.5},
        "irrigated": False,
    },
    "boundary": [
        {"lat": 46.3, "lon": 23.72},
        {"lat": 46.301, "lon": 23.72},
        {"lat": 46.301, "lon": 23.722},
    ],
    "near": "Aiud",
}


# Postgres runs too when TEST_POSTGRES_URL points at a disposable database (it is wiped).
BACKENDS = ["sqlite", *(["postgres"] if os.environ.get("TEST_POSTGRES_URL") else [])]


@pytest.fixture(params=BACKENDS)
def client(
    request: pytest.FixtureRequest, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    settings = get_settings()
    if request.param == "postgres":
        import psycopg

        url = os.environ["TEST_POSTGRES_URL"]
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute("DROP TABLE IF EXISTS fields, sessions, accounts")
        accounts._pools.clear()
        monkeypatch.setattr(settings, "database_url", SecretStr(url))
    else:
        monkeypatch.setattr(settings, "database_url", None)
        monkeypatch.setattr(settings, "database_path", tmp_path / "test.db")
    with TestClient(app) as test_client:
        yield test_client


def sign_up(client: TestClient, email: str = "Ana@Example.ro") -> None:
    response = client.post(
        "/v1/auth/signup", json={"email": email, "password": "grau-2026!", "name": "Ana"}
    )
    assert response.status_code == 201, response.text


def test_signup_login_logout(client: TestClient) -> None:
    sign_up(client)
    me = client.get("/v1/auth/me").json()
    assert me["email"] == "ana@example.ro"
    assert (
        client.post(
            "/v1/auth/signup", json={"email": "ana@example.ro", "password": "x" * 8}
        ).status_code
        == 409
    )

    assert client.post("/v1/auth/logout").status_code == 204
    assert client.get("/v1/auth/me").status_code == 401

    bad = client.post("/v1/auth/login", json={"email": "ana@example.ro", "password": "nope"})
    assert bad.status_code == 401
    good = client.post(
        "/v1/auth/login", json={"email": " ANA@example.ro", "password": "grau-2026!"}
    )
    assert good.status_code == 200
    assert client.get("/v1/auth/me").status_code == 200


def test_short_password_and_bad_email_rejected(client: TestClient) -> None:
    assert (
        client.post("/v1/auth/signup", json={"email": "a@b.ro", "password": "short"}).status_code
        == 422
    )
    assert (
        client.post(
            "/v1/auth/signup", json={"email": "nope", "password": "long enough"}
        ).status_code
        == 422
    )


def test_fields_crud_and_isolation(client: TestClient) -> None:
    assert client.get("/v1/me/fields").status_code == 401
    sign_up(client)
    created = client.post("/v1/me/fields", json=FIELD).json()
    second = client.post("/v1/me/fields", json={**FIELD, "name": "By the river"}).json()
    names = [f["name"] for f in client.get("/v1/me/fields").json()]
    assert set(names) == {"Behind the barn", "By the river"}

    renamed = client.put(f"/v1/me/fields/{created['id']}", json={**FIELD, "name": "North plot"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "North plot"
    assert client.get("/v1/me/fields").json()[0]["id"] == created["id"]

    # Another farmer sees none of it.
    client.post("/v1/auth/logout")
    sign_up(client, "ion@example.ro")
    assert client.get("/v1/me/fields").json() == []
    assert client.get(f"/v1/me/fields/{second['id']}").status_code == 404
    assert client.delete(f"/v1/me/fields/{second['id']}").status_code == 404

    client.post("/v1/auth/logout")
    client.post("/v1/auth/login", json={"email": "ana@example.ro", "password": "grau-2026!"})
    assert client.delete(f"/v1/me/fields/{second['id']}").status_code == 204
    assert len(client.get("/v1/me/fields").json()) == 1


def test_profile_password_and_deletion(client: TestClient) -> None:
    sign_up(client)
    assert client.patch("/v1/auth/me", json={"name": "  Ana Pop "}).json()["name"] == "Ana Pop"
    assert client.get("/v1/auth/me").json()["name"] == "Ana Pop"
    assert client.patch("/v1/auth/me", json={"name": ""}).json()["name"] is None

    wrong = client.post(
        "/v1/auth/password", json={"current_password": "nope", "new_password": "secara-2027!"}
    )
    assert wrong.status_code == 403
    assert wrong.json()["detail"] == "wrong_password"
    ok = client.post(
        "/v1/auth/password", json={"current_password": "grau-2026!", "new_password": "secara-2027!"}
    )
    assert ok.status_code == 204
    assert client.get("/v1/auth/me").status_code == 200  # this device stays signed in

    client.post("/v1/me/fields", json=FIELD)
    stale = client.request("DELETE", "/v1/auth/me", json={"password": "grau-2026!"})
    assert stale.status_code == 403
    gone = client.request("DELETE", "/v1/auth/me", json={"password": "secara-2027!"})
    assert gone.status_code == 204
    assert client.get("/v1/auth/me").status_code == 401
    login = client.post(
        "/v1/auth/login", json={"email": "ana@example.ro", "password": "secara-2027!"}
    )
    assert login.status_code == 401


FARM = {
    "name": "Ferma Pop",
    "parcels": [
        {
            "id": 1,
            "area_ha": 2.0,
            "boundary": [
                {"lat": 46.30, "lon": 23.70},
                {"lat": 46.30, "lon": 23.71},
                {"lat": 46.31, "lon": 23.71},
            ],
        }
    ],
    "fields": [{"id": "field-1", "name": "Câmp 1", "parcel_ids": [1]}],
}


def test_farm_is_saved_per_account(client: TestClient) -> None:
    sign_up(client)
    assert client.get("/v1/me/farm").json() is None
    saved = client.put("/v1/me/farm", json=FARM)
    assert saved.status_code == 200
    assert client.get("/v1/me/farm").json()["fields"][0]["parcel_ids"] == [1]
    renamed = {**FARM, "name": "Ferma Pop 2"}
    client.put("/v1/me/farm", json=renamed)
    assert client.get("/v1/me/farm").json()["name"] == "Ferma Pop 2"
    assert client.delete("/v1/me/farm").status_code == 204
    assert client.get("/v1/me/farm").json() is None
    client.post("/v1/auth/logout")
    assert client.get("/v1/me/farm").status_code == 401
