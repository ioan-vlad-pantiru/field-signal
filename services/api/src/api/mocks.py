"""Deterministic MOCK data for the farmer and buyer screens.

Everything here is fabricated so the web app can be built before the real pipeline lands.
Every response is marked `mock=True`. Commune coordinates are approximate and SIRUTA codes are
placeholders. Agronomic thresholds below are placeholders, not reviewed rules.
"""

from __future__ import annotations

import random
from functools import lru_cache

from api.contracts import (
    AdoptionScenario,
    AvailabilityRisk,
    Confidence,
    Crop,
    CropOutlook,
    DataSource,
    EnvironmentalImpact,
    Evidence,
    Explanation,
    FieldAnalysis,
    Indicator,
    LatLon,
    Localized,
    LocalRisk,
    Location,
    QualityFlag,
    QualityRisk,
    Range,
    Reason,
    RiskLevel,
    ScoreBreakdown,
    SeasonOutcome,
    SoilProfile,
    SourcingRecommendation,
    SourcingRegion,
    Status,
    Strategy,
    YearValue,
    Zone,
)

YEARS = list(range(2001, 2026))
SMAP_FIRST_YEAR = 2015

POWER = DataSource(
    dataset="NASA POWER",
    product="T2M_MAX, PRECTOTCORR, RH2M (daily, AG community)",
    resolution="0.5° x 0.625°",
    period="2001-2025",
    is_nasa=True,
    url="https://power.larc.nasa.gov/",
)
MODIS = DataSource(
    dataset="MODIS MOD13Q1",
    product="NDVI, 16-day composite",
    resolution="250 m",
    period="2001-2025",
    is_nasa=True,
    url="https://lpdaac.usgs.gov/products/mod13q1v061/",
)
SMAP = DataSource(
    dataset="SMAP L4",
    product="Root-zone soil moisture (SPL4SMGP)",
    resolution="9 km",
    period="2015-2025",
    is_nasa=True,
    url="https://nsidc.org/data/spl4smgp",
)
SOILGRIDS = DataSource(
    dataset="SoilGrids 2.0",
    product="soc, phh2o, clay, sand, silt",
    resolution="250 m",
    period="static",
    is_nasa=False,
    url="https://soilgrids.org/",
)
EUCROPMAP = DataSource(
    dataset="EUCROPMAP 2018",
    product="Crop type map",
    resolution="10 m",
    period="2018",
    is_nasa=False,
    url="https://data.jrc.ec.europa.eu/",
)

L = Localized


def _weather(seed: int) -> tuple[dict[int, float], dict[int, float], dict[int, float]]:
    """Fake yearly July hot days, Jun-Aug rain (mm) and peak NDVI with a warming trend."""
    rng = random.Random(seed)
    hot: dict[int, float] = {}
    rain: dict[int, float] = {}
    ndvi: dict[int, float] = {}
    for y in YEARS:
        trend = (y - 2001) * 0.25
        hot[y] = max(0.0, round(rng.gauss(6 + trend, 3.5)))
        rain[y] = float(round(max(60.0, rng.gauss(230 - trend * 3, 60))))
        ndvi[y] = round(min(0.9, max(0.45, 0.82 - 0.012 * hot[y] + (rain[y] - 220) / 3000)), 3)
    for y in (2012, 2022, 2024):  # make the well-known drought summers stand out in the mock
        hot[y], rain[y] = hot[y] + 8, float(round(rain[y] * 0.55))
        ndvi[y] = round(ndvi[y] - 0.08, 3)
    return hot, rain, ndvi


def _status(crop: Crop, hot: float, rain: float) -> tuple[Status, list[Reason]]:
    """PLACEHOLDER rules for the mock replay grid. Real rules come from the crop KB + model."""
    reasons: list[Reason] = []
    if crop in (Crop.MAIZE, Crop.SOYBEAN, Crop.SUNFLOWER):
        if hot >= 10:
            reasons.append(
                Reason(
                    code="heat_at_flowering",
                    label=L(ro="Caniculă la înflorire", en="Heat at flowering"),
                    value=hot,
                    unit="days",
                )
            )
        if rain < 170:
            reasons.append(
                Reason(
                    code="summer_dry",
                    label=L(ro="Vară secetoasă", en="Dry summer"),
                    value=rain,
                    unit="mm",
                )
            )
        tolerance = {Crop.MAIZE: 0, Crop.SOYBEAN: 0, Crop.SUNFLOWER: 1}[crop]
    else:
        if rain > 330:
            reasons.append(
                Reason(
                    code="wet_harvest",
                    label=L(ro="Ploi la recoltare", en="Rain at harvest"),
                    value=rain,
                    unit="mm",
                )
            )
        tolerance = 0
    n = len(reasons) - tolerance
    status = Status.BAD if n >= 2 else Status.WATCH if n == 1 else Status.GOOD
    return status, reasons


def _replay(seq: list[Crop], hot: dict[int, float], rain: dict[int, float]) -> list[SeasonOutcome]:
    out = []
    for i, y in enumerate(YEARS):
        crop = seq[i % len(seq)]
        status, reasons = _status(crop, hot[y], rain[y])
        out.append(
            SeasonOutcome(
                year=y,
                crop=crop,
                status=status,
                reasons=reasons,
                evidence_level=Confidence.MEDIUM if y >= SMAP_FIRST_YEAR else Confidence.LOW,
            )
        )
    return out


def _score(replay: list[SeasonOutcome], soil_bonus: float, water: float) -> ScoreBreakdown:
    bad = sum(s.status == Status.BAD for s in replay)
    watch = sum(s.status == Status.WATCH for s in replay)
    stability = max(0.0, 100 - 9 * bad - 3 * watch)
    low_risk = max(0.0, 100 - 12 * bad)
    soil = min(100.0, 45 + soil_bonus)
    total = round(0.35 * stability + 0.2 * water + 0.25 * soil + 0.2 * low_risk, 1)
    return ScoreBreakdown(
        total=total,
        yield_stability=round(stability, 1),
        water=water,
        soil_health=round(soil, 1),
        low_risk=round(low_risk, 1),
    )


def _explanation(name: str, seq: list[Crop], replay: list[SeasonOutcome]) -> Explanation:
    bad = [s.year for s in replay if s.status == Status.BAD]
    legume = any(c in (Crop.SOYBEAN, Crop.PEA, Crop.COVER_VETCH) for c in seq)
    return Explanation(
        why=L(
            ro=f"[MOCK] {name}: comparată pe 25 de sezoane cu datele NASA ale zonei.",
            en=f"[MOCK] {name}: compared over 25 seasons of NASA data for this area.",
        ),
        evidence=[
            Evidence(
                text=L(ro="Sezoane slabe în reluare", en="Poor seasons in the replay"),
                value=float(len(bad)),
                unit="seasons",
                source="NASA POWER",
            ),
            Evidence(
                text=L(ro="Ultimul sezon slab", en="Most recent poor season"),
                value=float(bad[-1]) if bad else None,
                unit="year",
                source="NASA POWER",
            ),
        ],
        benefits=[
            L(ro="Fixează azot pentru cultura următoare", en="Fixes nitrogen for the next crop")
        ]
        if legume
        else [L(ro="Rotație cunoscută, fără investiții noi", en="Familiar, no new investment")],
        gaps=[
            L(
                ro="Datele meteo descriu zona (~50 km), nu exact parcela.",
                en="Weather data describe the area (~50 km), not this exact field.",
            )
        ],
        risks=[
            LocalRisk(
                text=L(
                    ro="Verificați cu un agronom pragurile de căldură pentru hibridul folosit.",
                    en="Check heat thresholds for your hybrid with an agronomist.",
                )
            )
        ],
        generated_by="template",
    )


def _indicators(
    hot: dict[int, float], rain: dict[int, float], ndvi: dict[int, float], seed: int
) -> list[Indicator]:
    rng = random.Random(seed + 1)
    smap = {
        y: round(max(0.12, 0.30 - (230 - rain[y]) / 2000 + rng.gauss(0, 0.01)), 3)
        if y >= SMAP_FIRST_YEAR
        else None
        for y in YEARS
    }

    def series(d: dict[int, float | None]) -> list[YearValue]:
        return [YearValue(year=y, value=d[y]) for y in YEARS]

    def mean(d: dict[int, float | None]) -> float:
        vals = [v for v in d.values() if v is not None]
        return round(sum(vals) / len(vals), 3)

    hot_o: dict[int, float | None] = dict(hot)
    rain_o: dict[int, float | None] = dict(rain)
    ndvi_o: dict[int, float | None] = dict(ndvi)
    smap_o: dict[int, float | None] = dict(smap)
    return [
        Indicator(
            id="jul_hot_days",
            label=L(ro="Zile caniculare în iulie", en="Hot days in July"),
            description=L(
                ro="Zile cu maxima ≥ 30 °C în iulie, când înflorește porumbul.",
                en="Days with max ≥ 30 °C in July, when maize flowers.",
            ),
            unit="days",
            higher_is_worse=True,
            source=POWER,
            series=series(hot_o),
            baseline_mean=mean(hot_o),
        ),
        Indicator(
            id="jja_rain_mm",
            label=L(ro="Ploaie iunie-august", en="Rain June-August"),
            description=L(ro="Precipitații totale vara.", en="Total summer rainfall."),
            unit="mm",
            higher_is_worse=False,
            source=POWER,
            series=series(rain_o),
            baseline_mean=mean(rain_o),
        ),
        Indicator(
            id="ndvi_peak",
            label=L(ro="Vigoarea vegetației (NDVI maxim)", en="Peak vegetation (NDVI)"),
            description=L(
                ro="Cât de verde a fost câmpul în vârful sezonului.",
                en="How green the field was at the peak of the season.",
            ),
            unit="NDVI",
            higher_is_worse=False,
            source=MODIS,
            series=series(ndvi_o),
            baseline_mean=mean(ndvi_o),
        ),
        Indicator(
            id="smap_rootzone_jul_aug",
            label=L(ro="Umiditatea solului (rădăcini)", en="Root-zone soil moisture"),
            description=L(
                ro="Apa din sol la 0-1 m în iulie-august.",
                en="Water in the top 1 m of soil in July-August.",
            ),
            unit="m³/m³",
            higher_is_worse=False,
            source=SMAP,
            series=series(smap_o),
            baseline_mean=mean(smap_o),
        ),
    ]


@lru_cache
def field_analysis(lat: float = 46.30, lon: float = 23.75) -> FieldAnalysis:
    seed = int(lat * 1000) ^ int(lon * 1000)
    hot, rain, ndvi = _weather(seed)
    plans: list[tuple[str, Localized, bool, list[Crop], float, float]] = [
        (
            "current",
            L(ro="Rotația actuală", en="Current rotation"),
            True,
            [Crop.MAIZE, Crop.WHEAT, Crop.MAIZE],
            5.0,
            55.0,
        ),
        (
            "soy-break",
            L(ro="Cu soia", en="With soybean"),
            False,
            [Crop.MAIZE, Crop.SOYBEAN, Crop.WHEAT],
            25.0,
            62.0,
        ),
        (
            "dry-safe",
            L(ro="Rezistentă la secetă", en="Drought-safe"),
            False,
            [Crop.SUNFLOWER, Crop.PEA, Crop.WHEAT, Crop.COVER_VETCH],
            30.0,
            74.0,
        ),
    ]
    strategies = []
    for sid, name, current, seq, soil_bonus, water in plans:
        replay = _replay(seq, hot, rain)
        score = _score(replay, soil_bonus, water)
        strategies.append(
            Strategy(
                id=sid,
                name=name,
                is_current=current,
                sequence=seq,
                score=score,
                score_range=Range(
                    low=round(score.total - 8, 1), mid=score.total, high=round(score.total + 6, 1)
                ),
                confidence=Confidence.MEDIUM,
                replay=replay,
                explanation=_explanation(name.en, seq, replay),
            )
        )
    return FieldAnalysis(
        mock=True,
        location=Location(
            point=LatLon(lat=lat, lon=lon), label="Aiud (mock)", commune="Aiud", county="Alba"
        ),
        period_start=YEARS[0],
        period_end=YEARS[-1],
        indicators=_indicators(hot, rain, ndvi, seed),
        soil=SoilProfile(
            soc_g_per_kg=14.2,
            ph_h2o=6.9,
            clay_pct=31.0,
            sand_pct=24.0,
            silt_pct=45.0,
            texture_class=L(ro="Lut argilos", en="Clay loam"),
            source=SOILGRIDS,
        ),
        strategies=strategies,
        caveats=[
            L(ro="DATE DEMONSTRATIVE (mock).", en="DEMO DATA (mock)."),
            L(
                ro="Înainte de 2015 nu există date SMAP: dovezile sunt mai slabe.",
                en="No SMAP data before 2015: evidence is weaker for those years.",
            ),
            L(
                ro="Instrumentul sprijină decizia fermierului, nu o înlocuiește.",
                en="This tool supports the farmer's judgment; it does not replace it.",
            ),
        ],
        sources=[POWER, MODIS, SMAP, SOILGRIDS],
    )


# --------------------------------------------------------------------------- buyer


_ZONES: list[tuple[str, float, float]] = [  # approximate centroids, mock only
    ("Aiud", 46.31, 23.72),
    ("Sântimbru", 46.14, 23.64),
    ("Teiuș", 46.20, 23.68),
    ("Mirăslău", 46.37, 23.71),
    ("Lopadea Nouă", 46.28, 23.82),
    ("Rădești", 46.26, 23.73),
    ("Unirea", 46.40, 23.80),
    ("Mihalț", 46.15, 23.73),
    ("Ciugud", 46.06, 23.62),
    ("Galda de Jos", 46.17, 23.62),
]


def _r(low: float, mid: float, high: float) -> Range:
    return Range(low=round(low), mid=round(mid), high=round(high))


def _level(score: float) -> RiskLevel:
    return RiskLevel.HIGH if score >= 66 else RiskLevel.MEDIUM if score >= 33 else RiskLevel.LOW


def _outlook(crop: Crop, rng: random.Random) -> CropOutlook:
    score = round(rng.uniform(10, 90), 1)
    anomaly = round(-score / 4 + rng.gauss(5, 3), 1)
    flags: list[QualityFlag] = []
    if crop == Crop.MAIZE:
        days = rng.randint(2, 16)
        flags.append(
            QualityFlag(
                code="aflatoxin_window",
                label=L(ro="Risc aflatoxine", en="Aflatoxin risk"),
                level=_level(days * 6),
                days_observed=days,
                days_normal=6.5,
                window=L(ro="înflorirea porumbului (iulie)", en="maize flowering (July)"),
            )
        )
    if crop == Crop.WHEAT:
        days = rng.randint(1, 12)
        flags.append(
            QualityFlag(
                code="fusarium_window",
                label=L(ro="Risc fuzarioză", en="Fusarium risk"),
                level=_level(days * 7),
                days_observed=days,
                days_normal=4.0,
                window=L(ro="înflorirea grâului (sf. mai)", en="wheat flowering (late May)"),
            )
        )
    q_level = max((f.level for f in flags), key=["low", "medium", "high"].index, default="low")
    return CropOutlook(
        crop=crop,
        area_ha=round(rng.uniform(300, 2500), 0),
        availability=AvailabilityRisk(
            level=_level(score),
            score=score,
            expected_yield_anomaly_pct=Range(low=anomaly - 8, mid=anomaly, high=anomaly + 6),
            drivers=[
                Reason(
                    code="ndvi_below_normal",
                    label=L(ro="Vegetație sub normal", en="Vegetation below normal"),
                    value=round(-score / 400, 3),
                    unit="NDVI",
                )
            ],
        ),
        quality=QualityRisk(level=RiskLevel(q_level), flags=flags),
        impact=EnvironmentalImpact(
            level=_level(rng.uniform(10, 80)),
            water_deficit_mm=round(rng.uniform(40, 220), 0),
            legume_share_pct=round(rng.uniform(2, 15), 1),
            winter_cover_days=rng.randint(40, 160),
        ),
        confidence=Confidence.MEDIUM,
        model_version="mock-0",
    )


@lru_cache
def sourcing_region(season: int = 2025) -> SourcingRegion:
    rng = random.Random(season)
    crops = [Crop.MAIZE, Crop.WHEAT, Crop.SOYBEAN]
    zones = [
        Zone(
            id=f"mock-{i:02d}",
            name=name,
            county="Alba",
            centroid=LatLon(lat=lat, lon=lon),
            crops=[_outlook(c, rng) for c in crops],
        )
        for i, (name, lat, lon) in enumerate(_ZONES)
    ]
    maize_area = sum(z.crops[0].area_ha or 0 for z in zones)
    adoption = 25.0
    # one soybean year in a 3-year rotation on the adopting share of maize land
    area = maize_area * adoption / 100 / 3
    yld = Range(low=1.7, mid=2.1, high=2.5)  # t/ha, RO 2024 avg ~2.0 (data/crops.toml)
    protein = Range(low=0.33, mid=0.34, high=0.35)  # as harvested, ~13% moisture
    return SourcingRegion(
        mock=True,
        region_name="Sântimbru-Aiud (mock)",
        season=season,
        reference_crops=crops,
        zones=zones,
        recommendation=SourcingRecommendation(
            title=L(ro="Împărțiți achiziția de porumb", en="Split the maize purchase"),
            text=L(
                ro="[MOCK] Zonele din nord au risc mare la porumb; cumpărați mai mult din sud.",
                en="[MOCK] Northern zones carry high maize risk; buy more from the south.",
            ),
            actions=[
                L(ro="Contracte cu fermieri care introduc soia", en="Contract soy adopters"),
                L(ro="Testați loturile pentru aflatoxine", en="Test lots for aflatoxins"),
            ],
            confidence=Confidence.LOW,
            assumptions=[L(ro="Date demonstrative.", en="Demo data.")],
        ),
        scenario=AdoptionScenario(
            crop=Crop.SOYBEAN,
            adoption_pct=adoption,
            added_area_ha=_r(area * 0.8, area, area * 1.1),
            added_production_t=_r(area * 0.8 * yld.low, area * yld.mid, area * 1.1 * yld.high),
            added_protein_t=_r(
                area * 0.8 * yld.low * protein.low,
                area * yld.mid * protein.mid,
                area * 1.1 * yld.high * protein.high,
            ),
            assumptions=[
                L(
                    ro="Soia o dată la 3 ani pe terenul fermierilor care adoptă rotația.",
                    en="Soybean once every 3 years on adopting farmers' land.",
                ),
                L(
                    ro="Randament 1,7-2,5 t/ha; proteină 33-35% la recoltare (de verificat).",
                    en="Yield 1.7-2.5 t/ha; protein 33-35% as harvested (to verify).",
                ),
            ],
        ),
        caveats=[L(ro="DATE DEMONSTRATIVE (mock).", en="DEMO DATA (mock).")],
        sources=[POWER, MODIS, SMAP, EUCROPMAP],
    )
