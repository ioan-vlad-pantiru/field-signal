"""FastAPI application entrypoint."""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from api import accounts, assistant, mocks, parcels
from api.analysis import run_field_analysis
from api.contracts import (
    FarmPlanRequest,
    FarmPlanResponse,
    FieldAnalysis,
    FieldRequest,
    SourcingRegion,
)
from api.planner.service import PlanRejected, plan_farm
from api.settings import get_settings
from api.whatsapp.router import router as whatsapp_router

settings = get_settings()
# uvicorn configures only its own loggers: show this app's INFO logs (farm plan stage times),
# keep third-party libraries at WARNING.
logging.basicConfig(level=logging.WARNING, format="%(levelname)s:     %(name)s %(message)s")
logging.getLogger("api").setLevel(logging.INFO)

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
app.include_router(parcels.router)
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


@app.post("/v1/farm/plan", tags=["farmer"])
def farm_plan(request: FarmPlanRequest) -> FarmPlanResponse:
    """Farm rotation plan: an area split per field. Scores come from the MOCK world model
    (mock=true); 422 when a field cannot be planned."""
    try:
        return plan_farm(request)
    except PlanRejected as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
