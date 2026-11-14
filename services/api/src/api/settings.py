"""Typed application settings, read from environment variables and the repo-root `.env`."""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]

# Local web dev servers: 3000, plus 3010-3014 used by parallel worktrees.
DEV_CORS_ORIGINS = [
    "http://localhost:3000",
    *(f"http://localhost:{port}" for port in range(3010, 3015)),
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Field Signal API"
    environment: str = "development"
    cors_origins: list[str] = ["http://localhost:3000"]
    # SQLite file for farmer accounts and saved fields, used when DATABASE_URL is not set.
    database_path: Path = REPO_ROOT / "data" / "cache" / "field-signal.db"
    # Postgres connection string (production). When set, it is used instead of the SQLite file.
    database_url: SecretStr | None = None
    # APIA parcel outlines (data/scripts/build_apia_parcels.py). Missing file: no parcel picking.
    parcels_path: Path = REPO_ROOT / "services" / "api" / "parcels" / "apia_parcels_alba.sqlite"

    earthdata_username: str | None = None
    earthdata_password: SecretStr | None = None
    llm_api_key: SecretStr | None = None

    @model_validator(mode="after")
    def _dev_cors_origins(self) -> "Settings":
        # Only the development default widens. An explicit CORS_ORIGINS
        # (as in production) is kept exactly as given.
        if self.environment == "development" and "cors_origins" not in self.model_fields_set:
            self.cors_origins = list(DEV_CORS_ORIGINS)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
