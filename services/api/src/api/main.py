"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api import mocks
from api.contracts import FieldAnalysis, FieldRequest, SourcingRegion
from api.settings import get_settings

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Health(BaseModel):
    status: str
    environment: str


@app.get("/health")
def health() -> Health:
    return Health(status="ok", environment=settings.environment)


@app.post("/v1/fields/analyze", tags=["farmer"])
def analyze_field(request: FieldRequest) -> FieldAnalysis:
    """Farmer screen. Currently returns MOCK data (mock=true) shaped like the real response."""
    return mocks.field_analysis(round(request.location.lat, 2), round(request.location.lon, 2))


@app.get("/v1/sourcing/region", tags=["buyer"])
def sourcing_region(season: int = 2025) -> SourcingRegion:
    """Feed-buyer screen. Currently returns MOCK data (mock=true)."""
    return mocks.sourcing_region(season)
