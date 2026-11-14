"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from api import accounts, assistant, farm, farm_plan, mocks, parcels
from api.analysis import run_field_analysis
from api.contracts import FieldAnalysis, FieldRequest, SourcingRegion
from api.settings import get_settings
from api.whatsapp.router import router as whatsapp_router

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Parcel outlines are long coordinate lists; they shrink several times over gzip.
app.add_middleware(GZipMiddleware, minimum_size=2048)

app.include_router(accounts.router)
app.include_router(assistant.router)
app.include_router(farm_plan.router)
app.include_router(parcels.router)
app.include_router(farm.router)
app.include_router(whatsapp_router)


class Health(BaseModel):
    status: str
    environment: str


@app.get("/health")
def health() -> Health:
    return Health(status="ok", environment=settings.environment)


@app.post("/v1/fields/analyze", tags=["farmer"])
def analyze_field(request: FieldRequest) -> FieldAnalysis:
    """Farmer screen. Currently returns MOCK data (mock=true) shaped like the real response."""
    return run_field_analysis(request)


@app.get("/v1/sourcing/region", tags=["buyer"])
def sourcing_region(season: int = 2025) -> SourcingRegion:
    """Feed-buyer screen. Currently returns MOCK data (mock=true)."""
    return mocks.sourcing_region(season)
