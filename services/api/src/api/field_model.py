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
A current rotation may hold only the crops the model scores (maize, wheat, barley, sunflower,
pea); any other raises `UnsupportedCrop`. Never one crop in place of another.
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
    _scored([str(c) for c in request.current_rotation])  # unsupported crops: UnsupportedCrop
    weights = tuple(sorted((str(p), float(w)) for p, w in request.priorities.items()))
    return _analyze(point, lat, lon, tuple(str(c) for c in request.current_rotation), weights)


class UnsupportedCrop(ValueError):
    """The current rotation holds a crop the model does not score (the endpoint answers 422)."""


def _scored(seq: Sequence[str]) -> list[str]:
    unknown = sorted({c for c in seq if c not in CROPS})
    if unknown:
        raise UnsupportedCrop(
            f"The crop model scores {', '.join(CROPS)}; not {', '.join(unknown)}."
        )
    return list(seq)


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
    versus = None
    if strategies:  # alternatives are explained against the farmer's own rotation
        rows = _year_rows(point, scored_current)
        versus = (
            sum(s.status == Status.BAD for s in strategies[0].replay),
            float(np.mean([r.yield_rel.mid for _, _, r in rows if r.yield_rel])),
        )
    for i, r in enumerate(ranked[: ALTERNATIVES + (0 if strategies else 1)]):
        seq = r.split(">")
        strategies.append(
            _strategy(f"model-{i + 1}", _name(seq), False, seq, seq, table[r], point, versus)  # type: ignore[arg-type]
        )

    cell = weather.cell_id(lat, lon)
    caveats = [
        L(
            ro="Rezultatele vin din modelul de culturi Field Signal, antrenat pe imagini din "
            "satelit ale câmpurilor din România și Bulgaria (2016-2024). „% dintr-o recoltă "
            "obișnuită” compară cât de verde și viguroasă ar fi cultura cu un an obișnuit pentru "
            "ea, aici; nu sunt tone la hectar.",
            en="Results come from the Field Signal crop model, trained on satellite images of "
            'fields in Romania and Bulgaria (2016-2024). "% of a normal harvest" compares how '
            "green and vigorous the crop would be with a normal year for it, here; it is not "
            "tonnes per hectare.",
        ),
        L(
            ro="Vremea este cea a zonei (NASA, circa 50 km), nu exact a parcelei; solul este cel "
            "din hărțile SoilGrids (250 m).",
            en="Weather is the area's (NASA, about 50 km), not this exact field's; soil comes from "
            "the SoilGrids maps (250 m).",
        ),
        L(
            ro="Instrumentul sprijină decizia fermierului, nu o înlocuiește.",
            en="This tool supports your judgment; it does not replace it.",
        ),
    ]
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
                label=L(ro="Recolta prezisă", en="Expected harvest"),
                value=float(_pct(index)),
                unit="% of normal",
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
    versus: tuple[int, float] | None = None,
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
        explanation=_explanation(shown, seq, rows, replay, versus),
    )


def _pct(x: float) -> int:
    return round(100 * x)


def _explanation(
    shown: Sequence[str],
    seq: Sequence[str],
    rows: list[tuple[int, str, RotationOutcome]],
    replay: list[SeasonOutcome],
    versus: tuple[int, float] | None,
) -> Explanation:
    """Every line from this field's replay. `versus`: the current rotation's (poor seasons, mean
    harvest index), to compare an alternative against; None for the current rotation itself."""
    index = [r.yield_rel.mid for _, _, r in rows if r.yield_rel]
    mean = float(np.mean(index))
    bad = [s.year for s in replay if s.status == Status.BAD]
    worst_year, worst = min(
        ((y, r.yield_rel.mid) for y, _, r in rows if r.yield_rel), key=lambda t: t[1]
    )
    worst_reasons = next(s.reasons for s in replay if s.year == worst_year)
    drivers = [r.label for r in worst_reasons if r.code != "model_yield_index"]
    n = len(replay)
    poor_ro = "an slab" if len(bad) == 1 else "ani slabi"
    poor_en = "poor year" if len(bad) == 1 else "poor years"

    benefits: list[Localized] = []
    if versus is not None:
        fewer = versus[0] - len(bad)
        gain = _pct(mean) - _pct(versus[1])
        if fewer > 0:
            benefits.append(
                L(
                    ro=f"Cu {fewer} {'an slab' if fewer == 1 else 'ani slabi'} mai puțin decât "
                    "rotația actuală.",
                    en=f"{fewer} {'poor year' if fewer == 1 else 'poor years'} fewer than your "
                    "rotation now.",
                )
            )
        if gain >= 2:
            benefits.append(
                L(
                    ro=f"Recolte cu circa {gain}% mai bune în medie decât rotația actuală.",
                    en=f"Harvests about {gain}% better on average than your rotation now.",
                )
            )
    if any(c in LEGUMES for c in seq):
        benefits.append(
            L(
                ro="Mazărea lasă azot în sol pentru cultura următoare.",
                en="Pea leaves nitrogen in the soil for the next crop.",
            )
        )

    hardest_ro = f"Cel mai greu an: {worst_year}, {_pct(worst)}% dintr-o recoltă obișnuită"
    hardest_en = f"Hardest year: {worst_year}, {_pct(worst)}% of a normal harvest"
    if drivers:
        hardest_ro += f" ({', '.join(d.ro.lower() for d in drivers)})"
        hardest_en += f" ({', '.join(d.en.lower() for d in drivers)})"
    poor_count_ro = f"{len(bad)} {poor_ro}" if bad else "niciun an slab"
    poor_count_en = f"{len(bad)} {poor_en}" if bad else "no poor years"
    return Explanation(
        why=L(
            ro=f"Pe vremea reală din {YEARS[0]}-{YEARS[-1]}, rotația ar fi avut {poor_count_ro} "
            f"din {n}. Un an mediu ar fi dat {_pct(mean)}% dintr-o recoltă obișnuită pentru "
            "culturile ei, aici.",
            en=f"On the real weather of {YEARS[0]}-{YEARS[-1]}, this rotation would have had "
            f"{poor_count_en} out of {n}. An average year would have given {_pct(mean)}% of a "
            "normal harvest for its crops, here.",
        ),
        evidence=[
            Evidence(
                text=L(ro="Ani slabi din 25", en="Poor years out of 25"),
                value=float(len(bad)),
                unit="",
                source=MODEL.dataset,
            ),
            Evidence(
                text=L(ro="Recolta într-un an mediu", en="Harvest in an average year"),
                value=float(_pct(mean)),
                unit="% of normal",
                source=MODEL.dataset,
            ),
            Evidence(
                text=L(
                    ro=f"Recolta în {worst_year}, cel mai greu an",
                    en=f"Harvest in {worst_year}, the hardest year",
                ),
                value=float(_pct(worst)),
                unit="% of normal",
                source=MODEL.dataset,
            ),
        ],
        benefits=benefits,
        gaps=[
            L(
                ro="Vremea este cea a zonei (circa 50 km), nu exact a parcelei.",
                en="The weather is the area's (about 50 km), not this exact field's.",
            )
        ],
        risks=[
            LocalRisk(text=L(ro=hardest_ro + ".", en=hardest_en + "."), needs_local_review=False)
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
        y: (round(100 * r.rootzone_sm_critical.mid, 1) if r.rootzone_sm_critical else None)
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
            label=L(ro="Cât de verde ar fi cultura", en="How green the crop would be"),
            description=L(
                ro="Verdele maxim din satelit (NDVI, 0-1) prezis pentru cultura din rotația "
                "dumneavoastră în fiecare an; mai mult înseamnă o cultură mai viguroasă.",
                en="Peak satellite greenness (NDVI, 0-1) predicted for your rotation's crop each "
                "year; higher means a more vigorous crop.",
            ),
            unit="NDVI",
            higher_is_worse=False,
            source=MODEL,
            series=series(ndvi),
            baseline_mean=mean(ndvi),
        ),
        Indicator(
            id="model_rootzone_flowering",
            label=L(ro="Apă în sol la înflorire", en="Water in the soil at flowering"),
            description=L(
                ro="Apa din primul metru de sol când înflorește cultura, prezisă de model "
                "(% din volumul solului).",
                en="Water in the top metre of soil when the crop flowers, predicted by the model "
                "(% of the soil's volume).",
            ),
            unit="%",
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
