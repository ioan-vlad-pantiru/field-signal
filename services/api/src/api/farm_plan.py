"""Farm plan: one rotation per field, staggered so the farm grows a steady mix every year.

Each field gets the best-scoring strategy from its own field analysis. Every rotation is a
cycle; the plan chooses where in that cycle each field starts, so that

1. the first planned crop differs from the field's last crop where the cycle allows it, and
2. across the farm, the area of each crop is as even as possible in every planned year.

The stagger is greedy and deterministic: largest fields first (ties by id), and each takes the
starting point that keeps the per-year spread of crop areas smallest (ties: earliest offset).

CAP rules. The checks below are simplified guidance, not a compliance test. GAEC 7 (crop
rotation / crop diversification on arable land) and the arable eco-scheme set thresholds that
depend on farm size, exemptions and the year's ministerial order. We could not read the
official texts while writing this, so no legal threshold is coded here; the farmer is asked to
verify with APIA. Official documents to verify against (2026 campaign):
- MADR, Ghidul fermierului privind condiționalitatea, ed. IV 2026 (anexa 2, OMADR 84/2026):
  https://www.madr.ro/docs/dezvoltare-rurala/agro-mediu/2026/Ghidul-fermierului-privind-conditionalitatea-ed-IV_2026.pdf
- APIA, Instrucțiuni de completare a formularului de cerere de plată 2026 (GAEC 7 checks):
  https://apia.org.ro/wp-content/uploads/2026/03/Anexa-2.pdf
"""

from __future__ import annotations

from collections import defaultdict
from statistics import pvariance

from fastapi import APIRouter

from api.analysis import run_field_analysis
from api.contracts import (
    Crop,
    CropArea,
    FarmPlan,
    FarmPlanRequest,
    FieldAnalysis,
    FieldPlan,
    FieldRequest,
    Localized,
    PlanCheck,
    PlanField,
    Strategy,
)

router = APIRouter(prefix="/v1/farm")

DEFAULT_ROTATION: tuple[Crop, ...] = (Crop.MAIZE, Crop.WHEAT)
LEGUMES = frozenset({Crop.SOYBEAN, Crop.PEA, Crop.COVER_VETCH})
# Our own rule of thumb, not a legal limit: more maize than this on the farm in one year
# raises pest pressure (e.g. western corn rootworm) and drought exposure.
MAIZE_SHARE_LIMIT = 0.5

CROP_NAMES: dict[Crop, Localized] = {
    Crop.MAIZE: Localized(ro="porumb", en="maize"),
    Crop.WHEAT: Localized(ro="grâu", en="wheat"),
    Crop.BARLEY: Localized(ro="orz", en="barley"),
    Crop.SOYBEAN: Localized(ro="soia", en="soybean"),
    Crop.SUNFLOWER: Localized(ro="floarea-soarelui", en="sunflower"),
    Crop.PEA: Localized(ro="mazăre", en="pea"),
    Crop.COVER_MUSTARD: Localized(ro="muștar (cultură de acoperire)", en="mustard (cover crop)"),
    Crop.COVER_PHACELIA: Localized(ro="facelia (cultură de acoperire)", en="phacelia (cover crop)"),
    Crop.COVER_VETCH: Localized(ro="măzăriche (cultură de acoperire)", en="vetch (cover crop)"),
    Crop.FALLOW: Localized(ro="ogor", en="fallow"),
}

AnalysisKey = tuple[float, float, tuple[Crop, ...], bool]


def _best_strategy(analysis: FieldAnalysis) -> Strategy:
    """Highest score; on a tie prefer a change over the current rotation."""
    return max(analysis.strategies, key=lambda s: (s.score.total, not s.is_current))


def _crops_for(sequence: list[Crop], offset: int, years: int) -> list[Crop]:
    return [sequence[(offset + i) % len(sequence)] for i in range(years)]


def _spread(areas: list[dict[Crop, float]], crop_set: list[Crop]) -> float:
    """Sum over years of the variance of area across the farm's crops."""
    return sum(pvariance([year.get(c, 0.0) for c in crop_set]) for year in areas)


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def _crop_list(crops: list[Crop], lang: str) -> str:
    return ", ".join(getattr(CROP_NAMES[c], lang) for c in crops)


def plan_farm(req: FarmPlanRequest) -> FarmPlan:
    years = [req.start_year + i for i in range(req.years)]
    analyses: dict[AnalysisKey, FieldAnalysis] = {}
    chosen: dict[str, Strategy] = {}

    for f in req.fields:
        rotation = tuple(Crop(c) for c in (f.current_rotation or DEFAULT_ROTATION))
        key = (round(f.location.lat, 3), round(f.location.lon, 3), rotation, req.irrigated)
        if key not in analyses:
            analyses[key] = run_field_analysis(
                FieldRequest(
                    location=f.location,
                    current_rotation=list(rotation),
                    priorities=req.priorities,
                    irrigated=req.irrigated,
                )
            )
        chosen[f.id] = _best_strategy(analyses[key])

    crop_set: list[Crop] = []
    for s in chosen.values():
        for c in s.sequence:
            if Crop(c) not in crop_set:
                crop_set.append(Crop(c))

    farm_areas: list[dict[Crop, float]] = [defaultdict(float) for _ in years]
    crops_by_field: dict[str, list[Crop]] = {}
    for f in sorted(req.fields, key=lambda f: (-f.area_ha, f.id)):
        sequence = [Crop(c) for c in chosen[f.id].sequence]
        offsets = list(range(len(sequence)))
        if f.last_crop is not None:
            fresh = [o for o in offsets if sequence[o] != f.last_crop]
            offsets = fresh or offsets

        def cost(offset: int, f: PlanField = f, sequence: list[Crop] = sequence) -> float:
            trial = [dict(year) for year in farm_areas]
            for i, crop in enumerate(_crops_for(sequence, offset, len(years))):
                trial[i][crop] = trial[i].get(crop, 0.0) + f.area_ha
            return _spread(trial, crop_set)

        best = min(offsets, key=lambda o: (cost(o), o))
        crops = _crops_for(sequence, best, len(years))
        for i, crop in enumerate(crops):
            farm_areas[i][crop] += f.area_ha
        crops_by_field[f.id] = crops

    field_plans = [
        FieldPlan(
            field_id=f.id,
            strategy_name=chosen[f.id].name,
            sequence=chosen[f.id].sequence,
            crops=crops_by_field[f.id],
            score=chosen[f.id].score.total,
        )
        for f in req.fields
    ]
    totals = [
        CropArea(year=year, crop=crop, area_ha=round(area, 2))
        for year, areas in zip(years, farm_areas, strict=True)
        for crop, area in sorted(areas.items(), key=lambda kv: (-kv[1], kv[0].value))
    ]
    farm_area = sum(f.area_ha for f in req.fields)
    mock = any(a.mock for a in analyses.values())
    return FarmPlan(
        mock=mock,
        years=years,
        fields=field_plans,
        totals=totals,
        checks=_checks(req.fields, crops_by_field, years, farm_areas, farm_area),
        caveats=_caveats(mock),
    )


def _checks(
    fields: list[PlanField],
    crops_by_field: dict[str, list[Crop]],
    years: list[int],
    farm_areas: list[dict[Crop, float]],
    farm_area: float,
) -> list[PlanCheck]:
    return [
        _check_repeats(fields, crops_by_field, years),
        _check_diversity(years, farm_areas, farm_area),
        _check_legumes(years, farm_areas, farm_area),
        _check_maize(years, farm_areas, farm_area),
    ]


def _check_repeats(
    fields: list[PlanField], crops_by_field: dict[str, list[Crop]], years: list[int]
) -> PlanCheck:
    repeats: list[tuple[str, int, Crop]] = []
    for f in fields:
        history = [f.last_crop, *crops_by_field[f.id]]
        for i in range(1, len(history)):
            if history[i] == history[i - 1]:
                repeats.append((f.name, years[i - 1], crops_by_field[f.id][i - 1]))
    if not repeats:
        return PlanCheck(
            id="no_repeat",
            ok=True,
            title=Localized(
                ro="Nicio cultură nu se repetă pe aceeași solă",
                en="No crop follows itself on the same field",
            ),
            detail=Localized(
                ro="Pe fiecare solă, cultura principală se schimbă în fiecare an, inclusiv față "
                "de ultima cultură cunoscută. Aceasta este baza rotației cerute prin GAEC 7; "
                "vă rugăm să verificați regulile exacte cu APIA.",
                en="On every field the main crop changes each year, including from the last "
                "known crop. This is the basis of the rotation GAEC 7 asks for; please check "
                "the exact rules with APIA.",
            ),
        )
    ro = "; ".join(f"{name}: {CROP_NAMES[c].ro} din nou în {y}" for name, y, c in repeats)
    en = "; ".join(f"{name}: {CROP_NAMES[c].en} again in {y}" for name, y, c in repeats)
    return PlanCheck(
        id="no_repeat",
        ok=False,
        title=Localized(
            ro="Aceeași cultură revine pe aceeași solă",
            en="The same crop comes back on the same field",
        ),
        detail=Localized(
            ro=f"{ro}. Cultura repetată pe aceeași solă crește bolile și dăunătorii și poate "
            "încălca regula de rotație (GAEC 7). Vă rugăm să verificați cu APIA ce excepții "
            "se aplică fermei dumneavoastră.",
            en=f"{en}. Growing the same crop again builds up disease and pests and may break "
            "the rotation rule (GAEC 7). Please check with APIA which exceptions apply to "
            "your farm.",
        ),
    )


def _check_diversity(
    years: list[int], farm_areas: list[dict[Crop, float]], farm_area: float
) -> PlanCheck:
    lines_ro, lines_en = [], []
    ok = True
    for year, areas in zip(years, farm_areas, strict=True):
        grown = [c for c, a in areas.items() if a > 0]
        top = max(grown, key=lambda c: areas[c])
        share = areas[top] / farm_area
        ok = ok and len(grown) >= 2
        lines_ro.append(
            f"{year}: {len(grown)} culturi, cea mai mare {CROP_NAMES[top].ro} {_pct(share)}"
        )
        lines_en.append(f"{year}: {len(grown)} crops, largest {CROP_NAMES[top].en} {_pct(share)}")
    return PlanCheck(
        id="diversity",
        ok=ok,
        title=Localized(
            ro="Mai multe culturi în fiecare an" if ok else "Un an cu o singură cultură",
            en="Several crops every year" if ok else "A year with a single crop",
        ),
        detail=Localized(
            ro="; ".join(lines_ro) + ". Regulile de diversificare (GAEC 7) cer un număr minim "
            "de culturi și o pondere maximă a culturii principale, în funcție de suprafața "
            "arabilă. Vă rugăm să verificați pragurile exacte pentru ferma dumneavoastră cu APIA.",
            en="; ".join(lines_en) + ". The diversification rules (GAEC 7) set a minimum "
            "number of crops and a maximum share for the main crop, depending on the arable "
            "area. Please check the exact thresholds for your farm with APIA.",
        ),
    )


def _check_legumes(
    years: list[int], farm_areas: list[dict[Crop, float]], farm_area: float
) -> PlanCheck:
    shares = [sum(a for c, a in areas.items() if c in LEGUMES) / farm_area for areas in farm_areas]
    ok = all(s > 0 for s in shares)
    per_year = "; ".join(f"{y}: {_pct(s)}" for y, s in zip(years, shares, strict=True))
    return PlanCheck(
        id="legumes",
        ok=ok,
        title=Localized(
            ro="Leguminoase în fiecare an" if ok else "Ani fără leguminoase",
            en="Legumes every year" if ok else "Years without legumes",
        ),
        detail=Localized(
            ro=f"Suprafața cu soia, mazăre sau măzăriche: {per_year}. Leguminoasele fixează "
            "azot în sol și reduc nevoia de îngrășământ. Ele pot conta și pentru eco-schema "
            "pentru teren arabil; vă rugăm să verificați condițiile cu APIA.",
            en=f"Area under soybean, pea or vetch: {per_year}. Legumes fix nitrogen in the soil "
            "and cut fertiliser needs. They may also count towards the arable eco-scheme; "
            "please check the conditions with APIA.",
        ),
    )


def _check_maize(
    years: list[int], farm_areas: list[dict[Crop, float]], farm_area: float
) -> PlanCheck:
    shares = [areas.get(Crop.MAIZE, 0.0) / farm_area for areas in farm_areas]
    ok = max(shares) <= MAIZE_SHARE_LIMIT
    per_year = "; ".join(f"{y}: {_pct(s)}" for y, s in zip(years, shares, strict=True))
    limit = _pct(MAIZE_SHARE_LIMIT)
    return PlanCheck(
        id="maize_share",
        ok=ok,
        title=Localized(
            ro="Porumbul nu domină ferma" if ok else "Mult porumb într-un an",
            en="Maize does not dominate the farm" if ok else "A lot of maize in one year",
        ),
        detail=Localized(
            ro=f"Porumb din suprafața fermei: {per_year}. Recomandarea noastră (nu o regulă "
            f"legală) este să nu depășiți {limit}: mult porumb înseamnă mai mult risc de "
            "secetă și de viermele rădăcinilor de porumb.",
            en=f"Maize share of the farm: {per_year}. Our advice (not a legal rule) is to stay "
            f"at or under {limit}: a lot of maize means more drought risk and more western "
            "corn rootworm.",
        ),
    )


def _caveats(mock: bool) -> list[Localized]:
    caveats = [
        Localized(
            ro="Planul echilibrează suprafețele pe culturi de la an la an. Nu cunoaște "
            "prețurile, utilajele sau contractele dumneavoastră; ajustați-l după acestea.",
            en="The plan balances crop areas from year to year. It does not know your prices, "
            "machinery or contracts; adjust it for them.",
        ),
        Localized(
            ro="Verificările privind regulile PAC sunt simplificate. Vă rugăm să confirmați "
            "cu APIA regulile de rotație și diversificare (GAEC 7) și eco-schema pentru "
            "anul dumneavoastră.",
            en="The CAP checks are simplified. Please confirm the rotation and diversification "
            "rules (GAEC 7) and the eco-scheme for your year with APIA.",
        ),
    ]
    if mock:
        caveats.insert(
            0,
            Localized(
                ro="Planul se bazează pe analize demonstrative ale solelor, nu pe date reale.",
                en="The plan builds on demonstration field analyses, not real data.",
            ),
        )
    return caveats


@router.post("/plan", tags=["farmer"])
def farm_plan(request: FarmPlanRequest) -> FarmPlan:
    """A rotation per field, staggered across the farm. Built on MOCK analyses while mock=true."""
    return plan_farm(request)
