"""FastAPI application entrypoint."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api import accounts, mocks
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

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounts.router)
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
