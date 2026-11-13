"""Shared data contracts between data/, ml/, services/api and apps/web.

These pydantic models are the single source of truth. JSON Schemas in `contracts/` and the
TypeScript types in `apps/web/src/lib/contracts.ts` are generated from them:

    uv run --package api python -m api.export_contracts

Conventions
- Every user-facing string is `Localized` (Romanian + English).
- Every number shown to a user carries its source and, where it is an estimate, a `Range`
  and a `Confidence`.
- Scores are 0-100 and higher is always better for the farmer. Risk scores are 0-100 and
  higher is always riskier for the buyer.
- `mock=True` marks fabricated demo data. Never show mock data in the pitch as real.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "0.1.0"


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, use_enum_values=True)


# --------------------------------------------------------------------------- primitives


class Localized(Contract):
    ro: str
    en: str


class Crop(StrEnum):
    MAIZE = "maize"
    WHEAT = "wheat"
    BARLEY = "barley"
    SOYBEAN = "soybean"
    SUNFLOWER = "sunflower"
    PEA = "pea"
    COVER_MUSTARD = "cover_mustard"
    COVER_PHACELIA = "cover_phacelia"
    COVER_VETCH = "cover_vetch"
    FALLOW = "fallow"


class Confidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Status(StrEnum):
    GOOD = "good"
    WATCH = "watch"
    BAD = "bad"
    NO_DATA = "no_data"


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Priority(StrEnum):
    YIELD = "yield"
    WATER = "water"
    SOIL = "soil"
    RISK = "risk"


class LatLon(Contract):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Range(Contract):
    """An estimate with its uncertainty. `low <= mid <= high`."""

    low: float
    mid: float
    high: float


class DataSource(Contract):
    dataset: str = Field(description="e.g. 'NASA POWER'")
    product: str = Field(description="e.g. 'T2M_MAX, daily'")
    resolution: str = Field(description="e.g. '0.5° x 0.625°' or '250 m'")
    period: str = Field(description="e.g. '2001-2025'")
    is_nasa: bool
    url: str | None = None


class Reason(Contract):
    """One machine-readable driver behind a status or score."""

    code: str = Field(description="stable id, e.g. 'heat_at_flowering'")
    label: Localized
    value: float | None = None
    unit: str | None = None


# --------------------------------------------------------------------------- farmer screen


class FieldRequest(Contract):
    location: LatLon
    current_rotation: list[Crop] = Field(min_length=2, max_length=4)
    priorities: dict[Priority, float] = Field(
        description="weights 0-1 per priority; normalised server-side"
    )
    irrigated: bool = False


class Location(Contract):
    point: LatLon
    label: str
    commune: str | None = None
    county: str | None = None
    siruta: str | None = Field(default=None, description="Romanian SIRUTA code of the commune")


class YearValue(Contract):
    year: int
    value: float | None


class Indicator(Contract):
    id: str = Field(description="e.g. 'jul_hot_days', 'ndvi_peak', 'smap_rootzone_jul_aug'")
    label: Localized
    description: Localized
    unit: str
    higher_is_worse: bool
    source: DataSource
    series: list[YearValue]
    baseline_mean: float | None = None


class SoilProfile(Contract):
    depth: str = "0-30cm"
    soc_g_per_kg: float | None = None
    ph_h2o: float | None = None
    clay_pct: float | None = None
    sand_pct: float | None = None
    silt_pct: float | None = None
    texture_class: Localized | None = None
    source: DataSource


class Evidence(Contract):
    text: Localized
    value: float | None = None
    unit: str | None = None
    source: str = Field(description="dataset name, must match a DataSource.dataset")


class LocalRisk(Contract):
    text: Localized
    needs_local_review: bool = True


class Explanation(Contract):
    why: Localized
    evidence: list[Evidence]
    benefits: list[Localized]
    gaps: list[Localized]
    risks: list[LocalRisk]
    generated_by: Literal["template", "llm"]


class ScoreBreakdown(Contract):
    """0-100, higher is better for the farmer."""

    total: float = Field(ge=0, le=100)
    yield_stability: float = Field(ge=0, le=100)
    water: float = Field(ge=0, le=100)
    soil_health: float = Field(ge=0, le=100)
    low_risk: float = Field(ge=0, le=100)


class SeasonOutcome(Contract):
    year: int
    crop: Crop
    status: Status
    reasons: list[Reason]
    evidence_level: Confidence = Field(
        description="lower before SMAP (2015) or with cloud-gapped vegetation data"
    )


class Strategy(Contract):
    id: str
    name: Localized
    is_current: bool
    sequence: list[Crop] = Field(min_length=2, max_length=4)
    score: ScoreBreakdown
    score_range: Range
    confidence: Confidence
    replay: list[SeasonOutcome]
    explanation: Explanation


class FieldAnalysis(Contract):
    schema_version: str = SCHEMA_VERSION
    mock: bool = False
    location: Location
    period_start: int
    period_end: int
    indicators: list[Indicator] = Field(min_length=3)
    soil: SoilProfile
    strategies: list[Strategy] = Field(min_length=3)
    caveats: list[Localized]
    sources: list[DataSource]


# --------------------------------------------------------------------------- buyer screen


class AvailabilityRisk(Contract):
    level: RiskLevel
    score: float = Field(ge=0, le=100, description="higher = riskier")
    expected_yield_anomaly_pct: Range | None = None
    drivers: list[Reason]


class QualityFlag(Contract):
    code: Literal["aflatoxin_window", "fusarium_window", "harvest_rain"]
    label: Localized
    level: RiskLevel
    days_observed: int
    days_normal: float = Field(description="multi-year mean for the same window")
    window: Localized = Field(description="e.g. 'maize flowering, ~10 Jul-10 Aug'")


class QualityRisk(Contract):
    level: RiskLevel
    flags: list[QualityFlag]


class EnvironmentalImpact(Contract):
    level: RiskLevel
    water_deficit_mm: float | None = None
    legume_share_pct: float | None = None
    winter_cover_days: int | None = None
    emissions_kg_co2e_per_t: Range | None = Field(
        default=None, description="only from published factors; leave null otherwise"
    )
    notes: list[Localized] = []


class CropOutlook(Contract):
    crop: Crop
    area_ha: float | None = None
    availability: AvailabilityRisk
    quality: QualityRisk
    impact: EnvironmentalImpact
    confidence: Confidence
    model_version: str


class Zone(Contract):
    id: str = Field(description="SIRUTA code")
    name: str
    county: str
    centroid: LatLon
    crops: list[CropOutlook]


class SourcingRecommendation(Contract):
    title: Localized
    text: Localized
    actions: list[Localized]
    confidence: Confidence
    assumptions: list[Localized]


class AdoptionScenario(Contract):
    crop: Crop
    adoption_pct: float = Field(ge=0, le=100)
    added_area_ha: Range
    added_production_t: Range
    added_protein_t: Range
    assumptions: list[Localized]


class SourcingRegion(Contract):
    schema_version: str = SCHEMA_VERSION
    mock: bool = False
    region_name: str
    season: int
    reference_crops: list[Crop]
    zones: list[Zone]
    recommendation: SourcingRecommendation
    scenario: AdoptionScenario
    caveats: list[Localized]
    sources: list[DataSource]


# --------------------------------------------------------------------------- ml -> api


class ModelPrediction(Contract):
    """One row of `ml` output (JSON Lines or Parquet), consumed by the API."""

    zone_id: str
    zone_type: Literal["field", "commune", "county"]
    crop: Crop
    season: int
    p_bad_year: float = Field(ge=0, le=1)
    yield_anomaly_pct: Range
    top_drivers: list[Reason]
    model_version: str
    cv_metric_name: str | None = Field(default=None, description="e.g. 'roc_auc_loyo'")
    cv_metric_value: float | None = None


EXPORTED: dict[str, type[Contract]] = {
    "field_request": FieldRequest,
    "field_analysis": FieldAnalysis,
    "sourcing_region": SourcingRegion,
    "model_prediction": ModelPrediction,
}
