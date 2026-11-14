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
    """The joined outline of parcels that touch each other."""

    boundary: list[LatLon] = Field(min_length=3, max_length=500)
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


class FarmSuggestRequest(Contract):
    parcels: list[Parcel] = Field(min_length=1, max_length=1000)


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
    "farm_suggest_request": FarmSuggestRequest,
    "farm_suggestion": FarmSuggestion,
    "farm_plan_request": FarmPlanRequest,
    "farm_plan": FarmPlan,
}
