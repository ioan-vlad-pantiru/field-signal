from fastapi.testclient import TestClient

from api.main import app


def test_health() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_dev_cors_default_includes_worktree_ports() -> None:
    from api.settings import Settings

    dev = Settings(environment="development", _env_file=None)
    assert "http://localhost:3013" in dev.cors_origins
    prod = Settings(environment="production", _env_file=None)
    assert prod.cors_origins == ["http://localhost:3000"]
    explicit = Settings(
        environment="development", cors_origins=["https://fieldsignal.land"], _env_file=None
    )
    assert explicit.cors_origins == ["https://fieldsignal.land"]
