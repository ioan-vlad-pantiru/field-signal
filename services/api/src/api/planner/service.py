"""Farm plan service (plan §3.9): FarmPlanRequest -> FarmPlanResponse.

fields -> pieces -> candidates -> mock outcomes and scores -> CP-SAT optimizer -> response.
Scoring calls the mock world model itself (cached per grid point, crop and last two crops), so
outcomes and scores are timed as one stage. Every stage time is logged at INFO.

    plan_farm(request, max_time_s=3.0) -> FarmPlanResponse   # raises PlanRejected (-> 422)
"""

from __future__ import annotations

import logging
import statistics
import time
from collections import defaultdict
from collections.abc import Mapping, Sequence

import numpy as np

from api.contracts import (
    Allocation,
    Confidence,
    CropArea,
    DataSource,
    FarmPlan,
    FarmPlanRequest,
    FarmPlanResponse,
    Localized,
    Range,
    RuleCheck,
    ScenarioScore,
    ScoreBreakdown,
    YearAreas,
)
from api.planner import candidates as cand
from api.planner import grid, optimizer, scoring, weather
from api.planner import mock_world_model as wm
from api.planner.crops import CROPS, LEGUMES, RULE_LEGUMES

log = logging.getLogger(__name__)

MIN_RETURN = {c: v.min_return_years for c, v in CROPS.items()}
PRACTICE_NAME = {
    "diversification": Localized(ro="diversificarea culturilor", en="crop diversification"),
    "legume_share": Localized(ro="ponderea leguminoaselor", en="legume share"),
}


class PlanRejected(ValueError):
    """The request cannot be planned (outside coverage, degenerate polygon, too many pieces)."""


def _l(ro: str, en: str) -> Localized:
    return Localized(ro=ro, en=en)


def _stage(name: str, t0: float) -> float:
    now = time.perf_counter()
    log.info("farm plan stage %s: %.3f s", name, now - t0)
    return now


def _pieces(request: FarmPlanRequest) -> list[grid.Piece]:
    out: list[grid.Piece] = []
    for f in request.fields:
        try:
            ps = grid.pieces(f.id, [(p.lat, p.lon) for p in f.boundary])
            for p in ps:  # the mock world model needs a NASA POWER cell for every piece
                weather.cell_id(*map(float, p.grid_point_id.split("_")))
        except weather.OutsideCoverage as e:
            raise PlanRejected(f"Field {f.id}: {e}") from e
        except ValueError as e:
            raise PlanRejected(f"Field {f.id}: {e}.") from e  # grid.py states the reason
        out += ps
    if len(out) > optimizer.MAX_PIECES:
        raise PlanRejected(
            f"The farm covers {len(out)} grid pieces; at most {optimizer.MAX_PIECES} (roughly "
            "800 ha) are planned. Send fewer or smaller fields."
        )
    return out


def _plan(
    rank: int,
    allocation: Mapping[tuple[str, str], int],
    table: Mapping[tuple[str, str], np.ndarray],
    field_of: Mapping[str, str],
    scenarios: Sequence[int],
    plan_years: int,
    eco_practice: str | None,
    proven_optimal: bool,
) -> FarmPlan:
    total = sum(allocation.values())
    per_field: dict[tuple[str, str], int] = defaultdict(int)
    for (pid, rid), a in allocation.items():
        per_field[field_of[pid], rid] += a
    means = optimizer.area_mean(allocation, {k: table[k].mean(0).tolist() for k in allocation})
    per_scen = optimizer.area_mean(allocation, {k: table[k][:, 0].tolist() for k in allocation})
    lo, hi = int(np.argmin(per_scen)), int(np.argmax(per_scen))

    def window(i: int) -> ScenarioScore:
        s = scenarios[i]
        return ScenarioScore(
            start_season=s, end_season=s + plan_years - 1, total=round(per_scen[i], 1)
        )

    return FarmPlan(
        rank=rank,
        allocations=[
            Allocation(field_id=f, area_ha=a / 10, sequence=cand.crops_of(r))
            for (f, r), a in sorted(per_field.items(), key=lambda x: (x[0][0], -x[1]))
        ],
        score=ScoreBreakdown(
            **{c: round(v, 1) for c, v in zip(scoring.COLUMNS, means, strict=True)}
        ),
        score_range=Range(
            low=round(per_scen[lo], 1),
            mid=round(statistics.median(per_scen), 1),
            high=round(per_scen[hi], 1),
        ),
        worst=window(lo),
        best=window(hi),
        yearly_areas=[
            YearAreas(
                plan_year=y + 1,
                areas=[
                    CropArea(crop=c, area_ha=a / 10, share_pct=round(100 * a / total, 1))
                    for c, a in sorted(year.items(), key=lambda x: -x[1])
                ],
            )
            for y, year in enumerate(optimizer.yearly_areas(allocation))
        ],
        rules=[
            RuleCheck(
                id=r.id,
                source=r.source,
                limit_pct=r.limit_pct,
                value_pct=r.value_pct,
                applies=r.applies,
                passed=r.passed,
                verified=r.verified,
            )
            for r in optimizer.rule_checks(allocation, RULE_LEGUMES, eco_practice)
        ],
        confidence=Confidence.LOW,  # mock world model
        proven_optimal=proven_optimal,
    )


def plan_farm(request: FarmPlanRequest, max_time_s: float = 3.0) -> FarmPlanResponse:
    t = time.perf_counter()
    pieces = _pieces(request)
    field_of = {p.piece_id: p.field_id for p in pieces}
    t = _stage("pieces", t)

    histories: dict[str, list[str]] = {}
    assumed: list[str] = []
    rotations: dict[str, list[str]] = {}
    baseline: dict[str, str] = {}
    for f in request.fields:
        if f.crop_history is not None:
            histories[f.id] = list(f.crop_history)
        else:
            histories[f.id] = cand.history_from_cycle(f.current_rotation)
            assumed.append(f.id)
        rotations[f.id] = cand.candidates(
            list(CROPS), request.plan_years, MIN_RETURN, histories[f.id]
        )
        baseline[f.id] = cand.rotation_id(cand.cycle(f.current_rotation, request.plan_years))
    t = _stage("candidates", t)

    scored = {f: [*dict.fromkeys([*rs, baseline[f]])] for f, rs in rotations.items()}
    table = scoring.farm_scores(pieces, histories, scored, request.priorities)
    valid = {f: set(rs) for f, rs in rotations.items()}
    totals = {k: v for k, v in scoring.totals(table).items() if k[1] in valid[field_of[k[0]]]}
    t = _stage("outcomes+scores", t)

    practice = request.eco_practice if request.eco_scheme else None
    solve = optimizer.solve_farm(
        [(p.piece_id, p.field_id, p.area_tenths_ha) for p in pieces],
        totals,
        LEGUMES,
        practice,
        request.risk_aversion,
        max_time_s=max_time_s,
    )
    for i, s in enumerate(solve.times_s):
        log.info("farm plan stage solve %d: %.3f s (%s)", i + 1, s, solve.status)
    t = _stage("optimizer", t)

    scen = wm.scenarios(request.plan_years)
    plans = [
        _plan(
            i + 1,
            p.allocation,
            table,
            field_of,
            scen,
            request.plan_years,
            solve.eco_practice,
            p.proven_optimal,
        )
        for i, p in enumerate(solve.plans)
    ]
    base_alloc = {(p.piece_id, baseline[p.field_id]): p.area_tenths_ha for p in pieces}
    current = (
        _plan(0, base_alloc, table, field_of, scen, request.plan_years, None, False)
        if all(k in table for k in base_alloc)
        else None
    )
    response = FarmPlanResponse(
        mock=True,
        model_version=wm.MODEL_VERSION,
        plan_years=request.plan_years,
        total_area_ha=sum(p.area_tenths_ha for p in pieces) / 10,
        scenario_count=len(scen),
        scenario_first=scen[0],
        scenario_last=scen[-1],
        plans=plans,
        current=current,
        caveats=_caveats(request, solve, scen, assumed, current is None),
        sources=SOURCES,
    )
    _stage("response", t)
    return response


SEASONS = weather.seasons()
SOURCES = [
    DataSource(
        dataset="NASA POWER",
        product="T2M_MAX, T2M_MIN, PRECTOTCORR, GWETROOT (daily, regional grid; monthly summaries)",
        resolution="0.5° x 0.625°",
        period=f"{SEASONS.start - 1}-{SEASONS.stop - 1}",
        is_nasa=True,
        url="https://power.larc.nasa.gov/",
    ),
    DataSource(
        dataset="Field Signal crop table",
        product="data/crops.toml: return intervals, legumes, crop calendar (draft, not reviewed "
        "by an agronomist)",
        resolution="per crop",
        period="static",
        is_nasa=False,
    ),
]


def _caveats(
    request: FarmPlanRequest,
    solve: optimizer.FarmSolve,
    scen: Sequence[int],
    assumed: Sequence[str],
    no_current: bool,
) -> list[Localized]:
    first, last = scen[0], scen[-1] + request.plan_years - 1
    out = [
        _l(
            "Scorurile vin dintr-un model MOCK al lumii (mock-0), nu dintr-un model antrenat: "
            "sunt valori provizorii, nu predicții.",
            "Scores come from a MOCK world model (mock-0), not a trained model: they are "
            "placeholders, not predictions.",
        ),
        _l(
            "Câmpurile sunt tăiate pe o grilă grosieră de 0,0025° (celule de circa 280 m x 190 m); "
            "fiecare bucată primește valorile celulei sale.",
            "Fields are cut by a coarse 0.0025° grid (cells of about 280 m x 190 m); each piece "
            "takes the values of its cell.",
        ),
        _l(
            "Fiecare câmp primește vremea celulei sale NASA POWER (circa 50 km), comună tuturor "
            "câmpurilor din aceeași celulă; umiditatea din zona rădăcinilor este o valoare de "
            "model MERRA-2, nu o măsurătoare în câmp.",
            "Each field takes the weather of its NASA POWER cell (about 50 km), shared by every "
            "field in that cell; root-zone wetness is a MERRA-2 model value, not a field "
            "measurement.",
        ),
        _l(
            "Acoperirea este grila NASA POWER peste România: un câmp aflat chiar dincolo de "
            "graniță, într-o celulă acoperită, este planificat cu aceleași date.",
            "Coverage is the NASA POWER grid over Romania: a field just across the border that "
            "falls in a covered cell is planned with the same data.",
        ),
        _l(
            f"Scenariile sunt un test de stres pe istoric ({first}-{last}), nu o prognoză; cel mai "
            "rău caz este cea mai rea fereastră înregistrată, nu o limită inferioară.",
            f"Scenarios are a historical stress test ({first}-{last}), not a forecast; the worst "
            "case is the worst window on record, not a floor.",
        ),
        _l(
            "Verificările regulilor sunt provizorii, simplificate și neverificate: limitele vin "
            "din surse secundare, necitite încă în documentele oficiale 2026, iar pragurile de "
            "10 ha / 30 ha se aplică suprafeței totale desenate. Numerele regulilor sunt "
            "neverificate.",
            "Rule checks are provisional, simplified and unverified: the limits come from "
            "secondary sources not yet read in the official 2026 documents, and the 10 ha / 30 ha "
            "thresholds are applied to the total drawn area. The rule numbers are unverified.",
        ),
        _l(
            "Citirea GAEC 7 este provizorie: regula la nivel de parcelă (ce este o parcelă, "
            "culturi secundare, perioada de referință, excepții) nu este modelată.",
            "The GAEC 7 reading is provisional: the parcel-level rule (what counts as a parcel, "
            "secondary crops, the reference period, exemptions) is not modelled.",
        ),
        _l(
            "Acoperirea solului (GAEC 6 și PD-04, 15 iunie-15 octombrie) nu este verificată "
            "(neverificat).",
            "Soil cover (GAEC 6 and PD-04, 15 June-15 October) is not checked (unverified).",
        ),
        _l(
            "Eligibilitatea și excepțiile nu sunt verificate (neverificat).",
            "Eligibility and exemptions are not checked (unverified).",
        ),
        _eco_caveat(request, solve),
        _l(
            "Locul 1 este cea mai bună soluție găsită; este afișată ca optimă doar când solverul "
            "o dovedește.",
            "Rank 1 is the best solution found; it is shown as optimal only when the solver "
            "proves it.",
        ),
        _l(
            "Locurile 2 și 3 sunt alternative care diferă prin cel puțin două alegeri de rotație, "
            "nu următoarele cele mai bune soluții.",
            "Ranks 2 and 3 are alternatives that differ in at least two rotation choices, not the "
            "next-best solutions.",
        ),
        _l(
            "Rezultatul este o împărțire a suprafeței pe câmp, nu o hartă de semănat: nu se "
            "decide ce parte a câmpului primește fiecare rotație.",
            "The result is an area split per field, not a planting map: which part of a field "
            "gets each rotation is not decided.",
        ),
        _l(
            "Intervalele de revenire sunt verificate în plan și față de istoricul culturilor, nu "
            "peste sfârșitul planului: planul nu se presupune repetat.",
            "Return intervals are checked inside the plan and against the crop history, not "
            "across the end of the plan: the plan is not assumed to repeat.",
        ),
        _l(
            "Scorurile sunt indicatori agronomici și de mediu, nu profit.",
            "Scores are agronomic and environmental proxies, not profit.",
        ),
    ]
    if assumed:
        ids = ", ".join(assumed)
        out.append(
            _l(
                f"Istoricul culturilor este presupus din rotația curentă citită invers ({ids}).",
                f"Crop history is assumed from the current rotation read backwards ({ids}).",
            )
        )
    if no_current:
        out.append(
            _l(
                "Rotația curentă nu este evaluată: conține o cultură în afara celor cinci "
                "(porumb, grâu, orz, floarea-soarelui, mazăre).",
                "The current rotation is not scored: it holds a crop outside the five (maize, "
                "wheat, barley, sunflower, pea).",
            )
        )
    if solve.status == "UNKNOWN":
        out.append(
            _l(
                "Solverul a atins limita de timp; sunt afișate doar planurile găsite până atunci.",
                "The solver hit its time limit; only the plans found until then are shown.",
            )
        )
    elif not solve.plans:
        out.append(
            _l(
                "Nu s-a găsit niciun plan care să respecte constrângerile.",
                "No plan satisfies the constraints.",
            )
        )
    return out


def _eco_caveat(request: FarmPlanRequest, solve: optimizer.FarmSolve) -> Localized:
    if not request.eco_scheme:
        return _l(
            "Nu a fost impusă nicio regulă a eco-schemei PD-04; rândurile PD-04 sunt doar "
            "informative.",
            "No eco-scheme (PD-04) rule was enforced; the PD-04 rows are for information only.",
        )
    name = PRACTICE_NAME[request.eco_practice]
    if solve.eco_dropped:
        ro = (
            f"Nu s-a găsit în limita de timp niciun plan care respectă practica PD-04 aleasă "
            f"({name.ro}), sau practica nu se potrivește acestei ferme; a fost abandonată, iar "
            "planurile nu impun nicio regulă PD-04."
        )
        en = (
            f"No plan meeting the selected PD-04 practice ({name.en}) was found within the time "
            "limit, or the practice does not fit this farm; it was dropped and the plans enforce "
            "no PD-04 rule."
        )
        if request.eco_practice == "legume_share":
            n, back = optimizer.MAX_ROTATIONS, CROPS["pea"].min_return_years
            ro += (
                f" Un câmp are cel mult {n} rotații, iar mazărea revine pe același câmp abia după "
                f"{back} ani, deci o fermă cu un singur câmp nu poate cultiva mazăre în fiecare an."
            )
            en += (
                f" A field carries at most {n} rotations and pea returns to a field only after "
                f"{back} years, so a one-field farm cannot grow pea every year."
            )
        return _l(ro, en)
    return _l(
        f"A fost impusă o singură practică PD-04: {name.ro}; cealaltă este doar raportată.",
        f"One PD-04 practice was enforced: {name.en}; the other is reported only.",
    )
