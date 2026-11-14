"""Per-field analysis (`POST /v1/fields/analyze`) on the trained world model.

The field is the planner grid point under `request.location`. Everything that scores comes from
the trained LSTM (`api.planner.world_model`, Răzvan's model) through the planner's own scoring
(`api.planner.scoring`), so a field's analysis and the farm plan agree:

- strategies: the farmer's current rotation and the best other 3-year rotations of the planner
  crops, each scored over every past weather window (mean = score, P10/P50/P90 = range);
- replay: every season 2001-2025 of each strategy, graded by the model's yield index for that
  crop after its two previous crops, with the season's real NASA POWER drivers as reasons;
- indicators: NASA POWER July hot days and June-August rain, and the model's predicted peak NDVI
  and root-zone soil moisture at flowering for the current rotation's crop of each year;
- soil: SoilGrids 0-30 cm at the point (the model's own soil input).

Falls back to the mock (`mock=true`) only when the model's inputs are not deployed (development)
or `PLANNER_WORLD_MODEL=mock`; a point outside the planner grid raises `weather.OutsideCoverage`.
Crops the planner does not simulate (soybean, cover crops) in a current rotation are scored as
their nearest planner crop, said in the caveats.
"""

from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache

import numpy as np

from api import mocks
from api.contracts import (
    Confidence,
    Crop,
    DataSource,
    Evidence,
    Explanation,
    FieldAnalysis,
    FieldRequest,
    Indicator,
    LatLon,
    Localized,
    LocalRisk,
    Location,
    Range,
    Reason,
    RotationOutcome,
    ScoreBreakdown,
    SeasonOutcome,
    SoilProfile,
    Status,
    Strategy,
    YearValue,
)
from api.planner import candidates as cand
from api.planner import grid, models, scoring, weather
from api.planner import world_model as wm
from api.planner.crops import CROPS, LEGUMES, crop_months

L = Localized
YEARS = list(range(2001, 2026))
PLAN_YEARS = 3
ALTERNATIVES = 3
MIN_RETURN = {c: v.min_return_years for c, v in CROPS.items()}
# Crops the model does not simulate, scored as the nearest planner crop.
SCORED_AS = {
    "soybean": "pea",
    "cover_vetch": "pea",
    "cover_mustard": "barley",
    "cover_phacelia": "barley",
}
# Season grades from the model's yield index (1 = the crop's normal year at this field).
WATCH_BELOW, BAD_BELOW = 0.95, 0.85
HOT_DAYS_WATCH = 5  # days with Tmax >= 30 °C over the flowering months
DRY_SPELL_WATCH = 14  # longest run of days with rain < 1 mm in a flowering month

NAMES = {
    "maize": ("Porumb", "Maize"),
    "wheat": ("Grâu", "Wheat"),
    "barley": ("Orz", "Barley"),
    "sunflower": ("Floarea-soarelui", "Sunflower"),
    "pea": ("Mazăre", "Pea"),
    "soybean": ("Soia", "Soybean"),
    "cover_mustard": ("Muștar", "Mustard"),
    "cover_phacelia": ("Facelia", "Phacelia"),
    "cover_vetch": ("Măzăriche", "Vetch"),
}

MODEL = DataSource(
    dataset="Field Signal crop model",
    product="monthly LSTM (5 seeds) trained on NASA HLS NDVI and SMAP L4 root-zone moisture",
    resolution="250 m soil, 0.5° x 0.625° weather",
    period="trained 2016-2024, replayed on 1984-2025 weather",
    is_nasa=True,
    url=None,
)
POWER = DataSource(
    dataset="NASA POWER",
    product="T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M, WS2M, ALLSKY_SFC_SW_DWN (daily, AG)",
    resolution="0.5° x 0.625°",
    period="1984-2025",
    is_nasa=True,
    url="https://power.larc.nasa.gov/",
)
SOILGRIDS = DataSource(
    dataset="SoilGrids 2.0",
    product="clay, sand, soc, phh2o (0-30 cm)",
    resolution="250 m",
    period="static",
    is_nasa=False,
    url="https://soilgrids.org/",
)
DEM = DataSource(
    dataset="Copernicus DEM GLO-30",
    product="elevation and slope",
    resolution="30 m",
    period="static",
    is_nasa=False,
    url="https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model",
)


def run(request: FieldRequest) -> FieldAnalysis:
    lat, lon = request.location.lat, request.location.lon
    if not wm.available() or models.is_mock():
        return mocks.field_analysis(round(lat, 2), round(lon, 2))
    # Outside the model's grid: weather.OutsideCoverage propagates (the endpoint answers 422).
    point = grid.grid_point(lat, lon)
    weather.cell_id(lat, lon)
    weights = tuple(sorted((str(p), float(w)) for p, w in request.priorities.items()))
    return _analyze(point, lat, lon, tuple(str(c) for c in request.current_rotation), weights)


def _scored(seq: Sequence[str]) -> list[str]:
    return [SCORED_AS.get(c, c) for c in seq]


def _name(seq: Sequence[str]) -> Localized:
    return L(ro=" → ".join(NAMES[c][0] for c in seq), en=" → ".join(NAMES[c][1] for c in seq))


@lru_cache(maxsize=256)
def _analyze(
    point: str,
    lat: float,
    lon: float,
    current: tuple[str, ...],
    weights: tuple[tuple[str, float], ...],
) -> FieldAnalysis:
    from api.contracts import Priority

    w = scoring.weight_vector({Priority(k): v for k, v in weights})
    scored_current = _scored(current)
    history = cand.history_from_cycle(scored_current)
    last_two = (history[-2], history[-1])
    baseline = cand.rotation_id(cand.cycle(scored_current, PLAN_YEARS))
    options = cand.candidates(list(CROPS), PLAN_YEARS, MIN_RETURN, history)
    rotations = list(dict.fromkeys([baseline, *options]))

    # Every model run this analysis needs, across the CPUs, before scoring reads them.
    wm.prefetch(
        [(point, last_two, r.split(">")) for r in rotations]
        + [(point, ("", ""), [c]) for c in CROPS]
        + [(point, tuple(history[-2:]), _cycle_years(scored_current, len(YEARS)))]
    )
    table = {r: scoring._rotation_scores(point, last_two, r, w) for r in rotations}
    ranked = sorted(
        (r for r in options if r != baseline and table[r] is not None),
        key=lambda r: float(table[r][:, 0].mean()),  # type: ignore[index]
        reverse=True,
    )

    strategies = []
    base_scores = table[baseline]
    if base_scores is not None:
        current_name = L(ro="Rotația actuală", en="Current rotation")
        strategies.append(
            _strategy(
                "current", current_name, True, list(current), scored_current, base_scores, point
            )
        )
    for i, r in enumerate(ranked[: ALTERNATIVES + (0 if strategies else 1)]):
        seq = r.split(">")
        strategies.append(
            _strategy(f"model-{i + 1}", _name(seq), False, seq, seq, table[r], point)  # type: ignore[arg-type]
        )

    cell = weather.cell_id(lat, lon)
    caveats = [
        L(
            ro="Scorurile și reluarea sezoanelor vin din modelul antrenat (o rețea LSTM antrenată "
            "pe NDVI din satelit și umiditatea solului 2016-2024): indicele de recoltă este un "
            "indicator din NDVI (1 = un an obișnuit pentru cultură aici), nu tone la hectar.",
            en="Scores and the season replay come from the trained model (an LSTM trained on "
            "2016-2024 satellite NDVI and soil moisture): the yield index is an NDVI proxy (1 = "
            "a normal year for the crop here), not tonnes per hectare.",
        ),
        L(
            ro="Vremea descrie zona (celula NASA POWER, circa 50 km), nu exact parcela; solul este "
            "cel din SoilGrids la 250 m.",
            en="Weather describes the area (NASA POWER cell, about 50 km), not this exact field; "
            "soil is SoilGrids at 250 m.",
        ),
        L(
            ro="Instrumentul sprijină decizia fermierului, nu o înlocuiește.",
            en="This tool supports the farmer's judgment; it does not replace it.",
        ),
    ]
    if scored_current != list(current):
        caveats.insert(
            1,
            L(
                ro="Modelul nu simulează soia și culturile de acoperire: în rotația actuală sunt "
                "evaluate ca mazăre (leguminoase) sau orz.",
                en="The model does not simulate soybean or cover crops: in the current rotation "
                "they are scored as pea (legumes) or barley.",
            ),
        )
    return FieldAnalysis(
        mock=False,
        location=Location(point=LatLon(lat=lat, lon=lon), label=f"{lat:.4f}, {lon:.4f}"),
        period_start=YEARS[0],
        period_end=YEARS[-1],
        indicators=_indicators(point, cell, scored_current),
        soil=_soil(point),
        strategies=strategies,
        caveats=caveats,
        sources=[MODEL, POWER, SOILGRIDS, DEM],
    )


def _cycle_years(seq: Sequence[str], n: int) -> list[str]:
    return [seq[i % len(seq)] for i in range(n)]


def _year_rows(point: str, seq: Sequence[str]) -> list[tuple[int, str, RotationOutcome]]:
    """(year, crop, model row) for 2001-2025, the rotation cycled from 2001 with its own previous
    crops (the first two years after the cycle read backwards)."""
    line = [*cand.history_from_cycle(seq)[-2:], *_cycle_years(seq, len(YEARS))]
    out = []
    for i, y in enumerate(YEARS):
        crop, p2, p1 = line[i + 2], line[i], line[i + 1]
        out.append((y, crop, wm.outcomes(point, (p2, p1), (crop,), y)[0]))
    return out


def _flowering_weather(cell: str, year: int, crop: str) -> tuple[int, int]:
    """(hot days with Tmax >= 30 °C, longest dry spell) over the crop's flowering months."""
    months = weather.season_months(cell, year)[crop_months(crop)[2]]
    return sum(m.hot_days for m in months), max(m.longest_dry_spell_days for m in months)


def _season(cell: str, year: int, crop: str, row: RotationOutcome, shown: str) -> SeasonOutcome:
    index = row.yield_rel.mid if row.yield_rel else 1.0
    status = (
        Status.BAD if index < BAD_BELOW else Status.WATCH if index < WATCH_BELOW else Status.GOOD
    )
    reasons = []
    if status != Status.GOOD:
        reasons.append(
            Reason(
                code="model_yield_index",
                label=L(ro="Indice de recoltă prezis (model)", en="Predicted yield index (model)"),
                value=round(index, 2),
                unit="x normal",
            )
        )
    hot, dry = _flowering_weather(cell, year, crop)
    if hot >= HOT_DAYS_WATCH:
        reasons.append(
            Reason(
                code="heat_at_flowering",
                label=L(ro="Caniculă la înflorire", en="Heat at flowering"),
                value=float(hot),
                unit="days",
            )
        )
    if dry >= DRY_SPELL_WATCH:
        reasons.append(
            Reason(
                code="dry_spell_at_flowering",
                label=L(ro="Secetă la înflorire", en="Dry spell at flowering"),
                value=float(dry),
                unit="days",
            )
        )
    return SeasonOutcome(
        year=year,
        crop=Crop(shown),
        status=status,
        reasons=reasons,
        # Every season is the same model on the same NASA POWER record: one evidence level.
        evidence_level=Confidence.MEDIUM,
    )


def _strategy(
    sid: str,
    name: Localized,
    is_current: bool,
    shown: list[str],
    seq: list[str],
    scores: np.ndarray,
    point: str,
) -> Strategy:
    cell = weather.cell_id(*map(float, point.split("_")))
    rows = _year_rows(point, seq)
    shown_line = _cycle_years(shown, len(YEARS))
    replay = [_season(cell, y, crop, row, shown_line[i]) for i, (y, crop, row) in enumerate(rows)]
    mean = scores.mean(0)
    total = scores[:, 0]
    score = ScoreBreakdown(
        **{k: round(float(v), 1) for k, v in zip(scoring.COLUMNS, mean.tolist(), strict=True)}
    )
    lo, mid, hi = (round(float(v), 1) for v in np.percentile(total, (10, 50, 90)))
    return Strategy(
        id=sid,
        name=name,
        is_current=is_current,
        sequence=[Crop(c) for c in shown],
        score=score,
        score_range=Range(low=lo, mid=mid, high=hi),
        confidence=Confidence.LOW,
        replay=replay,
        explanation=_explanation(shown, seq, rows, replay),
    )


def _explanation(
    shown: Sequence[str],
    seq: Sequence[str],
    rows: list[tuple[int, str, RotationOutcome]],
    replay: list[SeasonOutcome],
) -> Explanation:
    index = [r.yield_rel.mid for _, _, r in rows if r.yield_rel]
    bad = [s.year for s in replay if s.status == Status.BAD]
    worst_year, worst = min(
        ((y, r.yield_rel.mid) for y, _, r in rows if r.yield_rel), key=lambda t: t[1]
    )
    legume = any(c in LEGUMES for c in seq)
    n = len(replay)
    return Explanation(
        why=L(
            ro=f"Modelul a rejucat {_name(shown).ro} pe vremea reală din {YEARS[0]}-{YEARS[-1]}: "
            f"{len(bad)} {'sezon slab' if len(bad) == 1 else 'sezoane slabe'} din {n}, "
            f"indice mediu de recoltă {np.mean(index):.2f}.",
            en=f"The model replayed {_name(shown).en} on the real {YEARS[0]}-{YEARS[-1]} weather: "
            f"{len(bad)} poor {'season' if len(bad) == 1 else 'seasons'} out of {n}, "
            f"average yield index {np.mean(index):.2f}.",
        ),
        evidence=[
            Evidence(
                text=L(ro="Sezoane slabe în reluare", en="Poor seasons in the replay"),
                value=float(len(bad)),
                unit="seasons",
                source=MODEL.dataset,
            ),
            Evidence(
                text=L(ro=f"Cel mai slab an ({worst_year})", en=f"Weakest year ({worst_year})"),
                value=round(float(worst), 2),
                unit="x normal",
                source=MODEL.dataset,
            ),
        ],
        benefits=[
            L(
                ro="Leguminoasa fixează azot pentru cultura următoare",
                en="The legume fixes nitrogen for the next crop",
            )
        ]
        if legume
        else [L(ro="Rotație cunoscută, fără investiții noi", en="Familiar, no new investment")],
        gaps=[
            L(
                ro="Vremea descrie zona (~50 km), nu exact parcela.",
                en="Weather describes the area (~50 km), not this exact field.",
            )
        ],
        risks=[
            LocalRisk(
                text=L(
                    ro="Verificați cu un agronom soiurile și pragurile pentru parcela dvs.",
                    en="Check varieties and thresholds for your field with an agronomist.",
                )
            )
        ],
        generated_by="template",
    )


def _indicators(point: str, cell: str, current: Sequence[str]) -> list[Indicator]:
    rows = _year_rows(point, current)
    hot: dict[int, float | None] = {}
    rain: dict[int, float | None] = {}
    for y in YEARS:
        months = weather.season_months(cell, y)
        hot[y] = float(months[6].hot_days)
        rain[y] = round(sum(m.rain_mm for m in months[5:8]), 1)
    ndvi = {y: (round(r.ndvi_peak.mid, 3) if r.ndvi_peak else None) for y, _, r in rows}
    sm = {
        y: (round(r.rootzone_sm_critical.mid, 3) if r.rootzone_sm_critical else None)
        for y, _, r in rows
    }

    def series(d: dict[int, float | None]) -> list[YearValue]:
        return [YearValue(year=y, value=d[y]) for y in YEARS]

    def mean(d: dict[int, float | None]) -> float:
        vals = [v for v in d.values() if v is not None]
        return round(sum(vals) / len(vals), 3)

    return [
        Indicator(
            id="jul_hot_days",
            label=L(ro="Zile caniculare în iulie", en="Hot days in July"),
            description=L(
                ro="Zile cu maxima ≥ 30 °C în iulie (NASA POWER).",
                en="Days with max ≥ 30 °C in July (NASA POWER).",
            ),
            unit="days",
            higher_is_worse=True,
            source=POWER,
            series=series(hot),
            baseline_mean=mean(hot),
        ),
        Indicator(
            id="jja_rain_mm",
            label=L(ro="Ploaie iunie-august", en="Rain June-August"),
            description=L(
                ro="Precipitații totale vara (NASA POWER).",
                en="Total summer rainfall (NASA POWER).",
            ),
            unit="mm",
            higher_is_worse=False,
            source=POWER,
            series=series(rain),
            baseline_mean=mean(rain),
        ),
        Indicator(
            id="model_ndvi_peak",
            label=L(ro="Vigoarea prezisă (NDVI maxim)", en="Predicted peak greenness (NDVI)"),
            description=L(
                ro="NDVI maxim prezis de model pentru cultura din rotația actuală a fiecărui an.",
                en="Peak NDVI the model predicts for each year's crop of the current rotation.",
            ),
            unit="NDVI",
            higher_is_worse=False,
            source=MODEL,
            series=series(ndvi),
            baseline_mean=mean(ndvi),
        ),
        Indicator(
            id="model_rootzone_flowering",
            label=L(ro="Apa din sol la înflorire (model)", en="Soil water at flowering (model)"),
            description=L(
                ro="Umiditatea solului în zona rădăcinilor prezisă de model la înflorire.",
                en="Root-zone soil moisture the model predicts at flowering.",
            ),
            unit="m³/m³",
            higher_is_worse=False,
            source=MODEL,
            series=series(sm),
            baseline_mean=mean(sm),
        ),
    ]


def _texture(clay: float, sand: float, silt: float) -> Localized:
    """Rough USDA texture class from the 0-30 cm fractions."""
    if clay >= 40:
        return L(ro="Argilos", en="Clay")
    if clay >= 27:
        return (
            L(ro="Lut argilos prăfos", en="Silty clay loam")
            if sand < 20
            else L(ro="Lut argilos", en="Clay loam")
        )
    if silt >= 50:
        return L(ro="Lut prăfos", en="Silt loam")
    if sand >= 52:
        return L(ro="Lut nisipos", en="Sandy loam")
    return L(ro="Lut", en="Loam")


def _soil(point: str) -> SoilProfile:
    lat, lon = map(float, point.split("_"))
    row, col = grid._cell(lat, lon)
    g = wm._static_grid()
    v = {c: int(g[c][row, col]) for c in ("clay", "sand", "soc", "ph")}
    if any(x == -32768 for x in v.values()):
        return SoilProfile(source=SOILGRIDS)
    clay, sand = v["clay"] / 10, v["sand"] / 10
    silt = round(max(0.0, 100 - clay - sand), 1)
    return SoilProfile(
        soc_g_per_kg=v["soc"] / 10,
        ph_h2o=v["ph"] / 100,
        clay_pct=clay,
        sand_pct=sand,
        silt_pct=silt,
        texture_class=_texture(clay, sand, silt),
        source=SOILGRIDS,
    )
