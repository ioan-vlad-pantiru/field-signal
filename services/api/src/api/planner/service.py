"""Farm plan service (plan §3.9): OptimizerRequest -> OptimizerResponse.

fields -> pieces -> candidates -> world-model outcomes and scores -> CP-SAT optimizer -> response.
Mode (plan §10, decided by `optimizer.splits`): a farm under 75 ha may divide a field of 10 ha or
more between up to 3 rotations; at 75 ha or more a drawn field is a parcel with exactly one
rotation. The service only words the caveats for the mode; farm rules span the fields.
Scoring calls the world model itself (`models.active()`: the trained LSTM or the mock, cached per
grid point, crop and last two crops), so outcomes and scores are timed as one stage. Every stage
time is logged at INFO.

    plan_farm(request, max_time_s=3.0) -> OptimizerResponse   # raises PlanRejected (-> 422)
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
    DataSource,
    Localized,
    OptimizerCropArea,
    OptimizerPlan,
    OptimizerRequest,
    OptimizerResponse,
    Range,
    RuleCheck,
    ScenarioScore,
    ScoreBreakdown,
    YearAreas,
)
from api.planner import candidates as cand
from api.planner import cpus, grid, models, optimizer, scoring, weather
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


def _pieces(request: OptimizerRequest) -> list[grid.Piece]:
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
) -> OptimizerPlan:
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

    return OptimizerPlan(
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
                    OptimizerCropArea(crop=c, area_ha=a / 10, share_pct=round(100 * a / total, 1))
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
        # low on both: the mock is no model, the LSTM is not yet checked against yields
        confidence=Confidence.LOW,
        proven_optimal=proven_optimal,
    )


def plan_farm(request: OptimizerRequest, max_time_s: float = 3.0) -> OptimizerResponse:
    t = time.perf_counter()
    pieces = _pieces(request)
    # Unrounded: the mode is decided on this (plan §10.10); boundaries were checked by _pieces.
    farm_ha = sum(grid.area_ha([(p.lat, p.lon) for p in f.boundary]) for f in request.fields)
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
        num_workers=cpus.solver_workers(),  # CP-SAT's default (0) uses every host core it sees
        farm_ha=farm_ha,
    )
    for i, s in enumerate(solve.times_s):
        log.info("farm plan stage solve %d: %.3f s (%s)", i + 1, s, solve.status)
    t = _stage("optimizer", t)

    wm = models.active()
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
    response = OptimizerResponse(
        mock=models.is_mock(),
        model_version=wm.MODEL_VERSION,
        plan_years=request.plan_years,
        total_area_ha=sum(p.area_tenths_ha for p in pieces) / 10,
        scenario_count=len(scen),
        scenario_first=scen[0],
        scenario_last=scen[-1],
        plans=plans,
        current=current,
        caveats=_caveats(
            request,
            solve,
            scen,
            assumed,
            current is None,
            optimizer.splits(farm_ha),
            farm_ha,
            plans,
        ),
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


def _model_caveat() -> Localized:
    if models.is_mock():
        return _l(
            "Scorurile vin dintr-un model MOCK al lumii (mock-0), nu dintr-un model antrenat: "
            "sunt valori provizorii, nu predicții.",
            "Scores come from a MOCK world model (mock-0), not a trained model: they are "
            "placeholders, not predictions.",
        )
    return _l(
        "Scorurile vin din modelul antrenat al lumii (o rețea LSTM antrenată pe NDVI din satelit "
        "și umiditatea solului 2016-2024 în România și Bulgaria): prezice NDVI și apa din sol "
        "lună de lună pentru vremea fiecărui an, cultură, culturile anterioare și sol. "
        "Randamentul este un indicator din NDVI, nu tone la hectar, și nu a fost încă verificat "
        "pe recolte.",
        "Scores come from the trained world model (an LSTM trained on 2016-2024 satellite NDVI "
        "and soil moisture in Romania and Bulgaria): it predicts NDVI and soil water month by "
        "month for each year's weather, the crop, the previous crops and the soil. Yield is an "
        "NDVI proxy, not tonnes per hectare, and is not yet checked against harvests.",
    )


def _caveats(
    request: OptimizerRequest,
    solve: optimizer.FarmSolve,
    scen: Sequence[int],
    assumed: Sequence[str],
    no_current: bool,
    split: bool,
    area_ha: float,
    plans: Sequence[OptimizerPlan],
) -> list[Localized]:
    first, last = scen[0], scen[-1] + request.plan_years - 1
    out = [
        _model_caveat(),
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
            "Apa din sol din scorul de apă este un bilanț lunar modelat al ploii și al consumului "
            "de apă al culturii (din NDVI și temperatură), cu același sol presupus pentru fiecare "
            "câmp și presupus a fi reumplut în fiecare iarnă; nu este o măsurătoare.",
            "Soil water in the water score is a modelled monthly balance of rain and crop water "
            "use (from NDVI and temperature), with the same soil assumed for every field and "
            "assumed refilled each winter; it is not a measurement.",
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
        _eco_caveat(request, solve, split),
        _l(
            "Locul 1 este cea mai bună soluție găsită; este afișată ca optimă doar când solverul "
            "o dovedește.",
            "Rank 1 is the best solution found; it is shown as optimal only when the solver "
            "proves it.",
        ),
        _l(
            "Locurile 2 și 3 sunt alternative: fiecare renunță la cel puțin două dintre rotațiile "
            "pe care un plan mai bun le pune pe câmpuri (la singura, când acel plan are una), nu "
            "următoarele cele mai bune soluții.",
            "Ranks 2 and 3 are alternatives: each drops at least two of the field rotations of "
            "every better plan (the only one when that plan has one), not the next-best "
            "solutions.",
        ),
        *_mode_caveats(split, area_ha),
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
    gaec7_fails = any(
        r.source.startswith("GAEC 7") and not r.passed for p in plans for r in p.rules
    )
    if not split and (solve.eco_dropped or gaec7_fails):
        out.append(
            _l(
                "La 75 ha sau mai mult, pentru a cultiva mai multe culturi în fiecare an, desenați "
                "un câmp mare ca mai multe parcele.",
                "At 75 ha or more, draw a large field as several parcels to grow more crops each "
                "year.",
            )
        )
    if solve.floor:
        out.append(
            _l(
                "În aceste planuri fiecare câmp rămâne întreg: în limita de timp, căutarea care "
                "poate împărți câmpurile nu a găsit planuri cu un scor cel puțin la fel de mare.",
                "Every field is kept whole in these plans: within the time limit, the search that "
                "may split fields found no plans scoring at least as high.",
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


def _mode_caveats(split: bool, area_ha: float) -> list[Localized]:
    limit = f"{optimizer.SPLIT_BELOW_HA:g}"
    ha = f"{area_ha:.2f}"
    rules = _l(
        "Ponderile din reguli se calculează doar pe câmpurile selectate, nu pe întreaga "
        "exploatație a fermierului.",
        "Rule shares are computed over the selected fields only, not the farmer's whole holding.",
    )
    if not split:
        return [
            _l(
                f"Câmpurile selectate însumează {ha} ha, adică {limit} ha sau mai mult (prag ales "
                "de produs, fără sursă în reglementări): fiecare câmp are o singură rotație, o "
                f"cultură pe an pe toată suprafața sa; la {limit} ha sau mai mult câmpurile nu se "
                "împart.",
                f"The selected fields total {ha} ha, which is {limit} ha or more (a product "
                "threshold, not a regulatory one): each field carries one rotation, one crop per "
                f"year on its whole area; fields are not split at {limit} ha or more.",
            ),
            rules,
        ]
    return [
        _l(
            f"Câmpurile selectate însumează {ha} ha, sub {limit} ha (prag ales de produs, fără "
            "sursă în reglementări): un câmp de 10 ha sau mai mult poate fi împărțit între cel "
            "mult 3 rotații de cel puțin 5 ha fiecare, iar un câmp sub 10 ha rămâne întreg. "
            "Împărțirea este permisă, nu impusă. Alocările sunt rotunjite la 0,1 ha.",
            f"The selected fields total {ha} ha, under {limit} ha (a product threshold, not a "
            "regulatory one): a field of 10 ha or more may be divided between up to 3 rotations "
            "of at least 5 ha each, and a field under 10 ha stays whole. Splitting is allowed, "
            "never required. Allocations are rounded to 0.1 ha.",
        ),
        _l(
            "Suprafețele sunt hectare, nu limite desenate: unde se află fiecare bloc în câmp "
            "este alegerea fermierului.",
            "Areas are hectares, not drawn boundaries: where each block sits in the field is the "
            "farmer's choice.",
        ),
        rules,
    ]


def _eco_caveat(request: OptimizerRequest, solve: optimizer.FarmSolve, split: bool) -> Localized:
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
        n = CROPS["pea"].min_return_years
        one, two = (r for r in optimizer.RULES_2026 if r.practice == "diversification")
        limit = f"{optimizer.SPLIT_BELOW_HA:g}"
        if split:
            ro += (
                " Un câmp sub 10 ha rămâne întreg, iar unul mai mare are cel mult 3 rotații de cel "
                "puțin 5 ha fiecare; aceste blocuri pot fi prea puține sau prea inegale pentru "
                "această practică."
            )
            en += (
                " A field under 10 ha stays whole and a larger one carries at most 3 rotations of "
                "at least 5 ha each; these blocks can be too few or too uneven for this practice."
            )
            if request.eco_practice == "legume_share":
                ro += f" Mazăre în fiecare an cere cel puțin {n} rotații cu mazăre în ani diferiți."
                en += f" Pea every year needs at least {n} rotations with pea in different years."
            return _l(ro, en)
        if request.eco_practice == "legume_share":
            ro += (
                f" La {limit} ha sau mai mult fiecare câmp are o singură rotație, o cultură pe an, "
                f"iar mazărea revine pe același câmp abia după {n} ani, deci ferma are nevoie de "
                f"cel puțin {n} câmpuri ca să cultive mazăre în fiecare an."
            )
            en += (
                f" At {limit} ha or more each field carries one rotation, one crop a year, and pea "
                f"returns to a field only after {n} years, so the farm needs at least {n} fields "
                "to grow pea every year."
            )
        else:
            ro += (
                f" La {limit} ha sau mai mult fiecare câmp are o singură rotație, o cultură pe an, "
                "deci cea mai mare cultură a anului ocupă cel puțin cel mai mare câmp: niciun "
                f"câmp nu poate depăși {one.limit_pct} % din fermă, iar peste {two.above // 10} ha "
                f"cele mai mari două culturi trebuie să rămână sub {two.limit_pct} %, ceea ce cere "
                "cel puțin trei câmpuri."
            )
            en += (
                f" At {limit} ha or more each field carries one rotation, one crop a year, so the "
                "largest crop of a year covers at least the largest field: no field may exceed "
                f"{one.limit_pct} % of the farm, and above {two.above // 10} ha the two largest "
                f"crops must stay under {two.limit_pct} %, which needs at least three fields."
            )
        ro += f" Împărțirea unui câmp nu este disponibilă la {limit} ha sau mai mult."
        en += f" Splitting a field is not available at {limit} ha or more."
        return _l(ro, en)
    return _l(
        f"A fost impusă o singură practică PD-04: {name.ro}; cealaltă este doar raportată.",
        f"One PD-04 practice was enforced: {name.en}; the other is reported only.",
    )
