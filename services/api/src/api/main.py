"""FastAPI application entrypoint."""

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from api import accounts, assistant, farm, farm_plan, parcels, sourcing, stocks
from api.analysis import run_field_analysis
from api.contracts import (
    FieldAnalysis,
    FieldRequest,
    OptimizerJob,
    OptimizerRequest,
    OptimizerResponse,
    SourcingRegion,
)
from api.field_model import UnsupportedCrop
from api.planner import jobs
from api.planner.service import PlanRejected, plan_farm
from api.planner.weather import OutsideCoverage
from api.settings import get_settings
from api.whatsapp.router import router as whatsapp_router

settings = get_settings()
# uvicorn configures only its own loggers: show this app's INFO logs (optimizer stage times),
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
app.include_router(farm_plan.router)
app.include_router(parcels.router)
app.include_router(farm.router)
app.include_router(stocks.router)
app.include_router(whatsapp_router)


class Health(BaseModel):
    status: str
    environment: str


@app.get("/health")
def health() -> Health:
    return Health(status="ok", environment=settings.environment)


@app.post("/v1/fields/analyze", tags=["farmer"])
def analyze_field(request: FieldRequest) -> FieldAnalysis:
    """Farmer screen: the trained model's analysis of one field (`api.field_model`); 422 when the
    field is outside the area the model covers."""
    try:
        return run_field_analysis(request)
    except (OutsideCoverage, UnsupportedCrop) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.get("/v1/sourcing/region", tags=["buyer"])
def sourcing_region(season: int | None = None) -> SourcingRegion:
    """Feed-buyer screen: real numbers for Alba's communes when built, else demo (mock=true)."""
    return sourcing.sourcing_region(season)


@app.post("/v1/farm/optimize", tags=["farmer"])
def optimize_farm(request: OptimizerRequest) -> OptimizerResponse:
    """Farm rotation optimizer: an area split per field. Scores come from the trained world model
    (an LSTM, mock=false) when its inputs are deployed, else the mock (mock=true); 422 when a field
    cannot be planned."""
    try:
        return plan_farm(request)
    except PlanRejected as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.post("/v1/farm/optimize/jobs", status_code=202, tags=["farmer"])
def start_optimize_job(request: OptimizerRequest) -> OptimizerJob:
    """The same farm plan as `/v1/farm/optimize`, run in a background worker process: returns the
    job at once; poll `GET /v1/farm/optimize/jobs/{id}`. The web app uses this one."""
    return jobs.submit(request)


@app.get("/v1/farm/optimize/jobs/{job_id}", tags=["farmer"])
def optimize_job(job_id: str) -> OptimizerJob:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown or expired farm plan job.")
    return job
