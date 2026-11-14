// GENERATED from contracts/*.schema.json. Do not edit by hand.
// Regenerate from the repo root:
//   uv run --package api python -m api.export_contracts
//   NODE_PATH=/tmp/jstt/node_modules node scripts/gen-contract-types.cjs

export type Crop =
  | "maize"
  | "wheat"
  | "barley"
  | "soybean"
  | "sunflower"
  | "pea"
  | "cover_mustard"
  | "cover_phacelia"
  | "cover_vetch"
  | "fallow";

export interface FieldRequest {
  location: LatLon;
  /**
   * @minItems 2
   * @maxItems 4
   */
  current_rotation: [Crop, Crop] | [Crop, Crop, Crop] | [Crop, Crop, Crop, Crop];
  /**
   * weights 0-1 per priority; normalised server-side
   */
  priorities: {
    [k: string]: number;
  };
  irrigated?: boolean;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export type Confidence = "high" | "medium" | "low";

export type Status = "good" | "watch" | "bad" | "no_data";
/**
 * lower before SMAP (2015) or with cloud-gapped vegetation data
 */

export type Confidence1 = "high" | "medium" | "low";

export interface FieldAnalysis {
  schema_version?: string;
  mock?: boolean;
  location: Location;
  period_start: number;
  period_end: number;
  /**
   * @minItems 3
   */
  indicators: [Indicator, Indicator, Indicator, ...Indicator[]];
  soil: SoilProfile;
  /**
   * @minItems 3
   */
  strategies: [Strategy, Strategy, Strategy, ...Strategy[]];
  caveats: Localized[];
  sources: DataSource[];
  /**
   * per-hexagon farmland mask; null = not computed
   */
  field_cells?: FieldCell[] | null;
}

export interface Location {
  point: LatLon;
  label: string;
  commune?: string | null;
  county?: string | null;
  /**
   * Romanian SIRUTA code of the commune
   */
  siruta?: string | null;
}

export interface Indicator {
  /**
   * e.g. 'jul_hot_days', 'ndvi_peak', 'smap_rootzone_jul_aug'
   */
  id: string;
  label: Localized;
  description: Localized;
  unit: string;
  higher_is_worse: boolean;
  source: DataSource;
  series: YearValue[];
  baseline_mean?: number | null;
}

export interface Localized {
  ro: string;
  en: string;
}

export interface DataSource {
  /**
   * e.g. 'NASA POWER'
   */
  dataset: string;
  /**
   * e.g. 'T2M_MAX, daily'
   */
  product: string;
  /**
   * e.g. '0.5° x 0.625°' or '250 m'
   */
  resolution: string;
  /**
   * e.g. '2001-2025'
   */
  period: string;
  is_nasa: boolean;
  url?: string | null;
}

export interface YearValue {
  year: number;
  value: number | null;
}

export interface SoilProfile {
  depth?: string;
  soc_g_per_kg?: number | null;
  ph_h2o?: number | null;
  clay_pct?: number | null;
  sand_pct?: number | null;
  silt_pct?: number | null;
  texture_class?: Localized | null;
  source: DataSource;
}

export interface Strategy {
  id: string;
  name: Localized;
  is_current: boolean;
  /**
   * @minItems 2
   * @maxItems 4
   */
  sequence: [Crop, Crop] | [Crop, Crop, Crop] | [Crop, Crop, Crop, Crop];
  score: ScoreBreakdown;
  score_range: Range;
  confidence: Confidence;
  replay: SeasonOutcome[];
  explanation: Explanation;
}
/**
 * 0-100, higher is better for the farmer.
 */

export interface ScoreBreakdown {
  total: number;
  yield_stability: number;
  water: number;
  soil_health: number;
  low_risk: number;
}
/**
 * An estimate with its uncertainty. `low <= mid <= high`.
 */

export interface Range {
  low: number;
  mid: number;
  high: number;
}

export interface SeasonOutcome {
  year: number;
  crop: Crop;
  status: Status;
  reasons: Reason[];
  evidence_level: Confidence1;
}
/**
 * One machine-readable driver behind a status or score.
 */

export interface Reason {
  /**
   * stable id, e.g. 'heat_at_flowering'
   */
  code: string;
  label: Localized;
  value?: number | null;
  unit?: string | null;
}

export interface Explanation {
  why: Localized;
  evidence: Evidence[];
  benefits: Localized[];
  gaps: Localized[];
  risks: LocalRisk[];
  generated_by: "template" | "llm";
}

export interface Evidence {
  text: Localized;
  value?: number | null;
  unit?: string | null;
  /**
   * dataset name, must match a DataSource.dataset
   */
  source: string;
}

export interface LocalRisk {
  text: Localized;
  needs_local_review?: boolean;
}
/**
 * One 1 ha hexagon of the field plan (`apps/web/src/lib/field-plan.ts`).
 */

export interface FieldCell {
  /**
   * axial 'q,r' of a pointy-top 1 ha hexagon; '0,0' is centred on location.point
   */
  id: string;
  /**
   * share of the hexagon mapped as cropland; source in `sources`
   */
  cropland_fraction: number;
}

export type RiskLevel = "low" | "medium" | "high";

export interface SourcingRegion {
  schema_version?: string;
  mock?: boolean;
  region_name: string;
  season: number;
  reference_crops: Crop[];
  zones: Zone[];
  recommendation: SourcingRecommendation;
  scenario: AdoptionScenario;
  caveats: Localized[];
  sources: DataSource[];
}

export interface Zone {
  /**
   * SIRUTA code
   */
  id: string;
  name: string;
  county: string;
  centroid: LatLon;
  crops: CropOutlook[];
}

export interface CropOutlook {
  crop: Crop;
  area_ha?: number | null;
  availability: AvailabilityRisk;
  quality: QualityRisk;
  impact: EnvironmentalImpact;
  confidence: Confidence;
  model_version: string;
}

export interface AvailabilityRisk {
  level: RiskLevel;
  /**
   * higher = riskier
   */
  score: number;
  expected_yield_anomaly_pct?: Range | null;
  drivers: Reason[];
}
/**
 * An estimate with its uncertainty. `low <= mid <= high`.
 */

export interface QualityRisk {
  level: RiskLevel;
  flags: QualityFlag[];
}

export interface QualityFlag {
  code: "aflatoxin_window" | "fusarium_window" | "harvest_rain";
  label: Localized;
  level: RiskLevel;
  days_observed: number;
  /**
   * multi-year mean for the same window
   */
  days_normal: number;
  window: Localized1;
}
/**
 * e.g. 'maize flowering, ~10 Jul-10 Aug'
 */

export interface Localized1 {
  ro: string;
  en: string;
}

export interface EnvironmentalImpact {
  level: RiskLevel;
  water_deficit_mm?: number | null;
  legume_share_pct?: number | null;
  winter_cover_days?: number | null;
  /**
   * only from published factors; leave null otherwise
   */
  emissions_kg_co2e_per_t?: Range | null;
  notes?: Localized[];
}

export interface SourcingRecommendation {
  title: Localized;
  text: Localized;
  actions: Localized[];
  confidence: Confidence;
  assumptions: Localized[];
}

export interface AdoptionScenario {
  crop: Crop;
  adoption_pct: number;
  added_area_ha: Range;
  added_production_t: Range;
  added_protein_t: Range;
  assumptions: Localized[];
}

export interface ModelPrediction {
  zone_id: string;
  zone_type: "field" | "commune" | "county";
  crop: Crop;
  season: number;
  p_bad_year: number;
  yield_anomaly_pct: Range;
  top_drivers: Reason[];
  model_version: string;
  /**
   * e.g. 'roc_auc_loyo'
   */
  cv_metric_name?: string | null;
  cv_metric_value?: number | null;
}
/**
 * An estimate with its uncertainty. `low <= mid <= high`.
 */

export interface SignUp {
  email: string;
  password: string;
  name?: string | null;
}

export interface SignIn {
  email: string;
  password: string;
}

export interface Account {
  id: string;
  email: string;
  name?: string | null;
  /**
   * ISO 8601, UTC
   */
  created_at: string;
}

export interface SavedFieldInput {
  name: string;
  request: FieldRequest;
  /**
   * @minItems 3
   * @maxItems 500
   */
  boundary: [LatLon, LatLon, LatLon, ...LatLon[]];
  /**
   * nearest commune name
   */
  near?: string | null;
}

export interface SavedField {
  name: string;
  request: FieldRequest;
  /**
   * @minItems 3
   * @maxItems 500
   */
  boundary: [LatLon, LatLon, LatLon, ...LatLon[]];
  /**
   * nearest commune name
   */
  near?: string | null;
  id: string;
  /**
   * ISO 8601, UTC
   */
  created_at: string;
  /**
   * ISO 8601, UTC
   */
  updated_at: string;
}

export interface FarmPlanRequest {
  /**
   * @minItems 1
   * @maxItems 10
   */
  fields:
    | [FarmField]
    | [FarmField, FarmField]
    | [FarmField, FarmField, FarmField]
    | [FarmField, FarmField, FarmField, FarmField]
    | [FarmField, FarmField, FarmField, FarmField, FarmField]
    | [FarmField, FarmField, FarmField, FarmField, FarmField, FarmField]
    | [FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField]
    | [FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField]
    | [FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField]
    | [FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField, FarmField];
  /**
   * non-negative weights per priority; normalised server-side, all zero = equal
   */
  priorities: {
    [k: string]: number;
  };
  /**
   * 0 = best average, 1 = best worst weather window
   */
  risk_aversion?: number;
  plan_years?: number;
  /**
   * enforce the optional legume share (eco-scheme) every plan year
   */
  legume_rule?: boolean;
}

export interface FarmField {
  /**
   * unique within the request
   */
  id: string;
  name?: string | null;
  /**
   * @minItems 3
   * @maxItems 500
   */
  boundary: [LatLon, LatLon, LatLon, ...LatLon[]];
  /**
   * a cycle, as in FieldRequest; the last two entries are taken as the field's last two crops
   *
   * @minItems 2
   * @maxItems 4
   */
  current_rotation: [Crop, Crop] | [Crop, Crop, Crop] | [Crop, Crop, Crop, Crop];
}

export interface FarmPlanResponse {
  schema_version?: string;
  mock?: boolean;
  /**
   * world model behind the scores; 'mock-0' for the mock
   */
  model_version: string;
  plan_years: number;
  total_area_ha: number;
  /**
   * number of weather windows scored
   */
  scenario_count: number;
  /**
   * start season of the first weather window
   */
  scenario_first: number;
  /**
   * start season of the last weather window
   */
  scenario_last: number;
  /**
   * best first; empty if none is feasible
   *
   * @maxItems 3
   */
  plans: [] | [FarmPlan] | [FarmPlan, FarmPlan] | [FarmPlan, FarmPlan, FarmPlan];
  /**
   * the farmer's current rotation; null when it cannot be scored
   */
  current?: FarmPlan | null;
  caveats: Localized[];
  sources: DataSource[];
}
/**
 * One farm plan. `score`: mean over weather windows, area-weighted. `score_range`: low =
 * worst weather window, mid = median, high = best (0-100). `confidence`: always 'low' on the mock
 * world model; the rule for the real model is still open.
 */

export interface FarmPlan {
  /**
   * 1 = best; 0 = the farmer's current rotation (baseline)
   */
  rank: number;
  allocations: Allocation[];
  score: ScoreBreakdown;
  score_range: Range;
  worst: ScenarioScore;
  best: ScenarioScore;
  yearly_areas: YearAreas[];
  rules: RuleCheck[];
  confidence: Confidence;
  /**
   * true only when CP-SAT proved the plan optimal; false for the baseline
   */
  proven_optimal: boolean;
}
/**
 * Hectares of one rotation on one field.
 */

export interface Allocation {
  field_id: string;
  area_ha: number;
  /**
   * one crop per plan year
   *
   * @minItems 3
   * @maxItems 4
   */
  sequence: [Crop, Crop, Crop] | [Crop, Crop, Crop, Crop];
}
/**
 * 0-100, higher is better for the farmer.
 */

export interface ScenarioScore {
  /**
   * first harvest season of the weather window
   */
  start_season: number;
  /**
   * last harvest season of the weather window
   */
  end_season: number;
  total: number;
}

export interface YearAreas {
  plan_year: number;
  areas: CropArea[];
}

export interface CropArea {
  crop: Crop;
  area_ha: number;
  /**
   * share of the whole farm area
   */
  share_pct: number;
}
/**
 * A farm-level crop rule (payment conditions, simplified; not verified against the 2026
 * APIA guide). `max_*` rules are upper limits; `summer_cover` and `legume_share` are lower
 * limits.
 */

export interface RuleCheck {
  id: "max_crop_share" | "max_two_crops_share" | "summer_cover" | "legume_share";
  limit_pct: number;
  /**
   * worst plan year
   */
  value_pct: number;
  /**
   * false when the farm is too small or the rule is off
   */
  applies: boolean;
  /**
   * value_pct meets limit_pct; computed even when not applied
   */
  passed: boolean;
}

export interface RotationOutcome {
  /**
   * '{lat:.5f}_{lon:.5f}' of the centre of the 0.0025° (about 250 m) grid cell
   */
  grid_point_id: string;
  /**
   * crop sequence joined by '>', e.g. 'maize>wheat>pea'
   */
  rotation: string;
  /**
   * scenario id: first harvest season of the weather window, e.g. 1987
   */
  weather_start_season: number;
  /**
   * year inside the plan, 1-based
   */
  plan_year: number;
  crop: Crop;
  /**
   * harvest year of the weather used: start + plan_year - 1
   */
  season: number;
  /**
   * yield relative to the crop's local normal (1.0 = normal)
   */
  yield_rel?: Range | null;
  /**
   * peak-season NDVI
   */
  ndvi_peak?: Range | null;
  /**
   * mean NDVI outside the crop's season (soil cover)
   */
  ndvi_offseason?: Range | null;
  /**
   * root-zone soil moisture in the crop's critical months
   */
  rootzone_sm_critical?: Range | null;
  /**
   * evapotranspiration over the crop's season
   */
  et_season_mm?: Range | null;
  /**
   * 'mock-0' for the mock world model
   */
  model_version: string;
}
/**
 * An estimate with its uncertainty. `low <= mid <= high`.
 */
