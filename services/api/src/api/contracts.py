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
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = "0.2.0"


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


Ring = Annotated[list[LatLon], Field(min_length=3, max_length=500)]
"""A closed outline without its closing point."""


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


class FieldCell(Contract):
    """One 1 ha hexagon of the field plan (`apps/web/src/lib/field-plan.ts`)."""

    id: str = Field(
        description="axial 'q,r' of a pointy-top 1 ha hexagon; '0,0' is centred on location.point"
    )
    cropland_fraction: float = Field(
        ge=0, le=1, description="share of the hexagon mapped as cropland; source in `sources`"
    )


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
    field_cells: list[FieldCell] | None = Field(
        default=None, description="per-hexagon farmland mask; null = not computed"
    )


# --------------------------------------------------------------------------- buyer screen


class AvailabilityRisk(Contract):
    level: RiskLevel
    score: float = Field(ge=0, le=100, description="higher = riskier")
    expected_yield_anomaly_pct: Range | None = None
    drivers: list[Reason]


class QualityFlag(Contract):
    code: Literal["aflatoxin_window", "fusarium_window", "harvest_rain", "soy_seed_fill_rain"]
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


class ValidationYear(Contract):
    """One past season: the risk we would have given vs what the official yields showed."""

    season: int
    crop: Crop
    risk_level: RiskLevel
    yield_anomaly_pct: float = Field(description="INS county yield vs its linear trend")
    hit: bool = Field(description="high risk with a poor yield, or low risk with a normal one")


class Validation(Contract):
    """How the supply-risk rule did against official county yields (INS AGR110A), year by year.
    Hits and misses are both published."""

    method: Localized
    hits: int = Field(ge=0)
    misses: int = Field(ge=0)
    years: list[ValidationYear]


class SourcingRegion(Contract):
    schema_version: str = SCHEMA_VERSION
    mock: bool = False
    region_name: str
    season: int
    reference_crops: list[Crop]
    zones: list[Zone]
    recommendation: SourcingRecommendation
    scenario: AdoptionScenario | None = Field(
        default=None, description="what-if for adding a crop; not shown to buyers today"
    )
    caveats: list[Localized]
    sources: list[DataSource]
    validation: Validation | None = None


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


class RotationOutcome(Contract):
    """One row of world-model output for the farm planner (handoff 2b): yearly physical summaries
    for one grid point, rotation, weather window and plan year. Each `Range` is the spread across
    ensemble members (low/mid/high = P10/P50/P90) for one weather window, not across weather
    windows. Null = not predicted; the planner drops a rotation whose scores need it. Scores are
    not part of this row: the planner owns normalisation, weights and rules. `crop` is the main
    crop of this plan year."""

    grid_point_id: str = Field(
        description="'{lat:.5f}_{lon:.5f}' of the centre of the 0.0025° (about 250 m) grid cell"
    )
    rotation: str = Field(description="crop sequence joined by '>', e.g. 'maize>wheat>pea'")
    weather_start_season: int = Field(
        description="scenario id: first harvest season of the weather window, e.g. 1987"
    )
    plan_year: int = Field(ge=1, le=5, description="year inside the plan, 1-based")
    crop: Crop
    season: int = Field(description="harvest year of the weather used: start + plan_year - 1")
    yield_rel: Range | None = Field(
        default=None, description="yield relative to the crop's local normal (1.0 = normal)"
    )
    ndvi_peak: Range | None = Field(default=None, description="peak-season NDVI")
    ndvi_offseason: Range | None = Field(
        default=None, description="mean NDVI outside the crop's season (soil cover)"
    )
    ndvi_monthly: list[float] | None = Field(
        default=None,
        min_length=12,
        max_length=12,
        description="monthly NDVI, January to December of the harvest year, ensemble P50; the "
        "planner's soil-water balance reads it",
    )
    rootzone_sm_critical: Range | None = Field(
        default=None,
        description="root-zone soil moisture in the crop's critical months; the planner does not "
        "read it (it computes soil water from ndvi_monthly and the weather); may be null",
    )
    et_season_mm: Range | None = Field(
        default=None,
        description="evapotranspiration over the crop's season; the planner does not read it; "
        "may be null",
    )
    model_version: str = Field(description="'mock-0' for the mock world model")


class FeatureRow(Contract):
    """One row of the feature table `data/cache/features/<zone_type>.parquet` (handoff 1),
    built by `data/scripts/build_features.py`. Zone values are means over the zone's cropland
    sample points. Missing = null."""

    zone_id: str = Field(description="SIRUTA, 'field:46.30,23.75' or 'county:AB'")
    zone_type: Literal["field", "commune", "county"]
    crop: Crop
    season: int = Field(description="harvest year")
    lat: float
    lon: float
    crop_area_ha: float | None = Field(
        default=None, ge=0, description="INS AGR108A (counties) or EUCROPMAP (communes, 2018+)"
    )
    hot_days_flowering: int = Field(ge=0, description="POWER T2M_MAX >= crop heat threshold")
    max_tmax_flowering_c: float
    rain_flowering_mm: float = Field(ge=0)
    rain_season_mm: float = Field(ge=0, description="sowing -> harvest")
    rh_flowering_pct: float = Field(ge=0, le=100)
    wet_days_flowering: int = Field(ge=0, description="days with rain >= 1 mm")
    rain_harvest_mm: float = Field(ge=0)
    frost_days_winter: int | None = Field(
        default=None, ge=0, description="T2M_MIN <= -15 °C, Dec-Feb; winter crops only"
    )
    et0_season_mm: float = Field(ge=0, description="FAO-56 Penman-Monteith from POWER")
    water_deficit_mm: float = Field(description="et0_season_mm - rain_season_mm")
    gwetroot_critical: float = Field(ge=0, le=1, description="POWER root-zone wetness")
    smap_rootzone_critical: float | None = Field(
        default=None, ge=0, le=1, description="SMAP L4 m³/m³; null before 2015"
    )
    smap_rootzone_anomaly: float | None = Field(default=None, description="z-score, 2015-2025")
    ndvi_peak: float | None = Field(default=None, ge=-1, le=1)
    ndvi_peak_anomaly: float | None = Field(default=None, description="z-score, same zone+crop")
    ndvi_usable_share: float | None = Field(
        default=None, ge=0, le=1, description="null when the source has no reliability layer"
    )
    soc_g_per_kg: float | None = Field(default=None, ge=0)
    ph_h2o: float | None = Field(default=None, ge=0, le=14)
    clay_pct: float | None = Field(default=None, ge=0, le=100)
    sand_pct: float | None = Field(default=None, ge=0, le=100)
    yield_t_ha: float | None = Field(default=None, ge=0, description="INS AGR110A, counties")
    yield_anomaly_pct: float | None = Field(
        default=None, description="vs linear trend of the county x crop record"
    )
    crops_yaml_version: str


# --------------------------------------------------------------------------- farm planner


class OptimizerField(Contract):
    id: str = Field(min_length=1, max_length=40, description="unique within the request")
    name: str | None = Field(default=None, max_length=80)
    boundary: list[LatLon] = Field(min_length=3, max_length=500)
    current_rotation: list[Crop] = Field(
        min_length=2,
        max_length=4,
        description="the farmer's reference cycle, as in FieldRequest; scored as the baseline",
    )
    crop_history: list[Crop] | None = Field(
        default=None,
        max_length=5,
        description="observed crops of past seasons, most recent harvest last; null = unknown, "
        "then the cycle current_rotation is read backwards (an assumption, stated in caveats)",
    )


class OptimizerRequest(Contract):
    fields: list[OptimizerField] = Field(min_length=1, max_length=10)
    priorities: dict[Priority, Annotated[float, Field(ge=0)]] = Field(
        description="non-negative weights per priority; normalised server-side, all zero = equal"
    )
    risk_aversion: float = Field(
        default=0.3, ge=0, le=1, description="0 = best average, 1 = best worst weather window"
    )
    plan_years: int = Field(default=4, ge=3, le=5)
    eco_scheme: bool = Field(
        default=False,
        description="enforce one practice of the voluntary PD-04 eco-scheme (eco_practice); "
        "false = nothing from PD-04 is enforced",
    )
    eco_practice: Literal["diversification", "legume_share"] = Field(
        default="diversification",
        description="the one PD-04 practice enforced when eco_scheme is true; ignored otherwise. "
        "The two are alternatives, never enforced together",
    )

    @model_validator(mode="after")
    def _unique_field_ids(self) -> Self:
        if len({f.id for f in self.fields}) != len(self.fields):
            raise ValueError("field ids must be unique")
        return self


class Allocation(Contract):
    """Hectares of one rotation on one field. A farm of 75 ha or more: one allocation per field,
    on the field's whole area. A smaller farm: a field of 10 ha or more may hold up to 3 (at least
    5 ha each), an area split, not a planting map (where each block lies is not decided)."""

    field_id: str
    area_ha: float = Field(ge=0)
    sequence: list[Crop] = Field(min_length=3, max_length=5, description="one crop per plan year")


class OptimizerCropArea(Contract):
    crop: Crop
    area_ha: float = Field(ge=0)
    share_pct: float = Field(ge=0, le=100, description="share of the whole farm area")


class YearAreas(Contract):
    plan_year: int = Field(ge=1, le=5)
    areas: list[OptimizerCropArea]


class RuleCheck(Contract):
    """A provisional farm-level crop rule check (payment conditions, simplified): not a statement
    of GAEC 7 or PD-04 compliance. `max_*` rules are upper limits; `legume_share` is a lower
    limit."""

    id: Literal["max_crop_share", "max_two_crops_share", "legume_share"]
    source: str = Field(description="rule profile and year, e.g. 'GAEC 7 2026', 'PD-04 2026'")
    limit_pct: float = Field(ge=0, le=100)
    value_pct: float = Field(ge=0, le=100, description="worst plan year")
    applies: bool = Field(description="true only for the practice enforced in this request")
    passed: bool = Field(description="value_pct meets limit_pct; computed even when not applied")
    verified: bool = Field(
        description="the limit was read in the official document; false = unverified"
    )


class ScenarioScore(Contract):
    start_season: int = Field(description="first harvest season of the weather window")
    end_season: int = Field(description="last harvest season of the weather window")
    total: float = Field(ge=0, le=100, description="0-100 decision metric, not a probability")


class OptimizerPlan(Contract):
    """One farm plan. Scores are 0-100 decision metrics (higher is better), not probabilities.
    `score_range` is the spread across weather windows, not a confidence interval."""

    rank: int = Field(
        ge=0,
        description="1 = best solution found (optimal for the model only when proven_optimal); "
        "2-3 = alternatives that drop at least two (field, rotation) choices of every better "
        "plan (the only one if it has one), not the next-best "
        "solutions; 0 = the farmer's current rotation",
    )
    allocations: list[Allocation] = Field(
        description="one entry per field on a farm of 75 ha or more; one or more per field "
        "(up to 3) on a smaller farm"
    )
    score: ScoreBreakdown = Field(
        description="mean over weather windows, area-weighted; 0-100, not a probability"
    )
    score_range: Range = Field(
        description="spread across weather windows: low = worst, mid = median, high = best"
    )
    worst: ScenarioScore
    best: ScenarioScore
    yearly_areas: list[YearAreas]
    rules: list[RuleCheck] = Field(
        description="provisional rule checks, not a statement of GAEC 7 or PD-04 compliance"
    )
    confidence: Confidence = Field(
        description="how far the model behind the numbers has been validated; 'low' on the mock "
        "world model, the rule for the real model is still open"
    )
    proven_optimal: bool = Field(
        description="true only when the solver proved the plan optimal for the model (no "
        "candidate pruned); otherwise the plan is the best solution found; false for the baseline"
    )


class OptimizerResponse(Contract):
    schema_version: str = SCHEMA_VERSION
    mock: bool = False
    model_version: str = Field(description="world model behind the scores; 'mock-0' for the mock")
    plan_years: int = Field(ge=3, le=5)
    total_area_ha: float = Field(ge=0)
    scenario_count: int = Field(ge=0, description="number of weather windows scored")
    scenario_first: int = Field(description="start season of the first weather window")
    scenario_last: int = Field(description="start season of the last weather window")
    plans: list[OptimizerPlan] = Field(
        max_length=3,
        description="plans[0] is the best solution found (optimal for the model only when "
        "proven_optimal), the others are alternatives; empty if none is feasible",
    )
    current: OptimizerPlan | None = Field(
        default=None, description="the farmer's current rotation; null when it cannot be scored"
    )
    caveats: list[Localized]
    sources: list[DataSource]


class OptimizerJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    REJECTED = "rejected"  # the fields cannot be planned (the synchronous endpoint's 422)
    FAILED = "failed"


class OptimizerJob(Contract):
    """A farm plan computed in the background: `POST /v1/farm/optimize/jobs` returns it queued,
    `GET /v1/farm/optimize/jobs/{id}` until `status` is done, rejected or failed. Jobs live in the
    API's memory for 15 minutes; an unknown id is a 404 (expired, or the API restarted)."""

    id: str
    status: OptimizerJobStatus
    elapsed_s: float = Field(ge=0, description="seconds since the job was submitted")
    result: OptimizerResponse | None = Field(default=None, description="set when status is done")
    detail: str | None = Field(default=None, description="why, when rejected or failed")


# --------------------------------------------------------------------------- farmer accounts


class SignUp(Contract):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=200)
    name: str | None = Field(default=None, max_length=80)


class SignIn(Contract):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class Account(Contract):
    id: str
    email: str
    name: str | None = None
    created_at: str = Field(description="ISO 8601, UTC")


class AccountUpdate(Contract):
    """Profile changes; only the display name for now."""

    name: str | None = Field(default=None, max_length=80)


class PasswordChange(Contract):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class AccountDeletion(Contract):
    """Deleting an account needs the password again."""

    password: str = Field(min_length=1, max_length=200)


class SavedFieldInput(Contract):
    """A field a farmer keeps in their account: the drawn boundary plus the last analysis inputs."""

    name: str = Field(min_length=1, max_length=80)
    request: FieldRequest
    boundary: list[LatLon] = Field(min_length=3, max_length=500)
    parts: list[Ring] = Field(
        default_factory=list,
        max_length=40,
        description="further pieces of the same field (parcels that do not touch the boundary)",
    )
    near: str | None = Field(default=None, max_length=120, description="nearest commune name")


class SavedField(SavedFieldInput):
    id: str
    created_at: str = Field(description="ISO 8601, UTC")
    updated_at: str = Field(description="ISO 8601, UTC")


# --------------------------------------------------------------------------- assistant


class ChatTurn(Contract):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AssistantField(Contract):
    """A field the farmer is looking at, so the assistant can analyse it by name."""

    name: str = Field(min_length=1, max_length=80)
    request: FieldRequest
    near: str | None = Field(default=None, max_length=120)
    area_ha: float | None = Field(default=None, ge=0)


class AssistantRequest(Contract):
    messages: list[ChatTurn] = Field(min_length=1, max_length=24)
    lang: Literal["ro", "en"] = "ro"
    fields: list[AssistantField] = Field(default_factory=list, max_length=10)
    page: str | None = Field(default=None, max_length=40, description="where the farmer asks from")
    think: bool = Field(default=False, description="let the model reason before answering")


class AssistantReply(Contract):
    reply: str
    tools_used: list[str]
    demo_data: bool = Field(description="the answer used demonstration (mock) data")


# --------------------------------------------------------------------------- APIA parcels


class ParcelCrop(Contract):
    """The crop mapped on a parcel in one year (JRC EUCROPMAP, 10 m; 2022 map ~79% accurate)."""

    year: int
    crop: str | None = Field(
        description="EUCROPMAP class name (e.g. maize, common_wheat, grassland); null = not mapped"
    )
    share: float = Field(ge=0, le=1, description="share of the parcel's pixels in that class")


class ParcelSoil(Contract):
    """SoilGrids 2.0 topsoil 0-30 cm averaged over the parcel (250 m model, not a measurement)."""

    soc_g_per_kg: float | None = None
    ph_h2o: float | None = None
    clay_pct: float | None = None
    sand_pct: float | None = None


class Parcel(Contract):
    """A parcel declared to APIA (open LPIS data, CC BY 4.0), offered so a farmer can tap it."""

    id: int
    boundary: list[LatLon] = Field(min_length=3, max_length=500)
    area_ha: float = Field(ge=0, description="area declared to APIA")
    land_use: str | None = Field(default=None, description="APIA land-use code, e.g. TA (arable)")
    crop_history: list[ParcelCrop] = Field(
        default_factory=list, description="mapped crop per year, oldest first; empty = not computed"
    )
    soil: ParcelSoil | None = None


class ParcelMergeRequest(Contract):
    """Parcels a farmer tapped, to be joined into one field."""

    ids: list[int] = Field(min_length=1, max_length=40)


class MergedParcels(Contract):
    """Tapped parcels joined into one field: touching parcels become one outline. When they do
    not all touch, `boundary` is the largest piece and `parts` the others."""

    boundary: list[LatLon] = Field(min_length=3, max_length=500)
    parts: list[Ring] = Field(default_factory=list, max_length=40)
    area_ha: float = Field(ge=0, description="sum of the areas declared to APIA")
    parcel_ids: list[int]


class ParcelCollection(Contract):
    parcels: list[Parcel]
    truncated: bool = Field(description="more parcels lie in the area than were returned")
    source: str = Field(description="dataset credit to show with the outlines")


# --------------------------------------------------------------------------- farm


class FarmField(Contract):
    """Parcels farmed together with the same crops: one rotation for all of them.
    The parcels need not touch."""

    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    parcel_ids: list[int] = Field(min_length=1, max_length=400)
    current_rotation: list[Crop] | None = Field(
        default=None, min_length=2, max_length=4, description="what the farmer grows now, if known"
    )


class SuggestedField(FarmField):
    reason: Localized = Field(description="why these parcels were grouped")


class Farm(Contract):
    """A farmer's whole holding: the parcels (outlines kept, so they survive a new APIA layer)
    and how they are grouped into fields."""

    name: str = Field(min_length=1, max_length=80)
    parcels: list[Parcel] = Field(min_length=1, max_length=1000)
    fields: list[FarmField] = Field(default_factory=list, max_length=200)


class FarmImport(Contract):
    """An uploaded parcel file (e.g. an AGI Online export) matched to the APIA layer."""

    parcels: list[Parcel] = Field(description="APIA parcels the file's outlines overlap")
    unmatched: int = Field(ge=0, description="outlines in the file with no APIA parcel under them")
    source_crs: str = Field(description="coordinate system read from the file, e.g. EPSG:3844")
    file_crops: dict[int, str] = Field(
        default_factory=dict,
        description="crop declared in the file per matched APIA parcel id, when the file has one",
    )


class FarmRematch(Contract):
    """Saved parcels matched to the current APIA layer by outline."""

    parcels: list[Parcel] = Field(description="current APIA parcels the saved ones overlap")
    mapping: dict[int, list[int]] = Field(
        description="saved parcel id -> current parcel ids; missing = no parcel under it now"
    )


class FarmSuggestRequest(Contract):
    parcels: list[Parcel] = Field(min_length=1, max_length=1000)
    declared_crops: dict[int, str] = Field(
        default_factory=dict, description="crop declared per parcel id (e.g. from an imported file)"
    )


class FarmSuggestion(Contract):
    fields: list[SuggestedField]


class PlanField(Contract):
    """One field going into the farm plan."""

    id: str
    name: str
    area_ha: float = Field(gt=0)
    location: LatLon = Field(description="centroid of the field's parcels")
    current_rotation: list[Crop] | None = Field(default=None, min_length=2, max_length=4)
    last_crop: Crop | None = Field(
        default=None, description="most recent crop known (mapped or declared)"
    )


class FarmPlanRequest(Contract):
    fields: list[PlanField] = Field(min_length=1, max_length=200)
    priorities: dict[Priority, float]
    irrigated: bool = False
    start_year: int = Field(ge=2020, le=2100, description="first season planned")
    years: int = Field(default=4, ge=2, le=8)


class FieldPlan(Contract):
    field_id: str
    strategy_name: Localized
    sequence: list[Crop] = Field(min_length=2, max_length=4, description="the rotation chosen")
    crops: list[Crop] = Field(description="crop per planned year, aligned with FarmPlan.years")
    score: float = Field(ge=0, le=100)


class CropArea(Contract):
    year: int
    crop: Crop
    area_ha: float = Field(ge=0)


class PlanCheck(Contract):
    id: str
    ok: bool
    title: Localized
    detail: Localized


class FarmPlan(Contract):
    mock: bool = Field(description="built on demonstration (mock) field analyses")
    years: list[int]
    fields: list[FieldPlan]
    totals: list[CropArea] = Field(description="area per crop per year across the farm")
    checks: list[PlanCheck]
    caveats: list[Localized]


EXPORTED: dict[str, type[Contract]] = {
    "field_request": FieldRequest,
    "field_analysis": FieldAnalysis,
    "sourcing_region": SourcingRegion,
    "model_prediction": ModelPrediction,
    "feature_row": FeatureRow,
    "sign_up": SignUp,
    "sign_in": SignIn,
    "account": Account,
    "account_update": AccountUpdate,
    "password_change": PasswordChange,
    "account_deletion": AccountDeletion,
    "saved_field_input": SavedFieldInput,
    "saved_field": SavedField,
    "assistant_request": AssistantRequest,
    "assistant_reply": AssistantReply,
    "parcel_collection": ParcelCollection,
    "parcel_merge_request": ParcelMergeRequest,
    "merged_parcels": MergedParcels,
    "farm": Farm,
    "farm_import": FarmImport,
    "farm_rematch": FarmRematch,
    "farm_suggest_request": FarmSuggestRequest,
    "farm_suggestion": FarmSuggestion,
    "farm_plan_request": FarmPlanRequest,
    "farm_plan": FarmPlan,
    "rotation_outcome": RotationOutcome,
    "optimizer_request": OptimizerRequest,
    "optimizer_response": OptimizerResponse,
    "optimizer_job": OptimizerJob,
}
