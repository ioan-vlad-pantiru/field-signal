"""CP-SAT farm rotation optimizer (plan §3.7, §9, §10): candidate rotations per field.

Plain data in and out; imports no FastAPI, contracts, weather or mock (plan §5a). Areas are
integers in 0.1 ha, scores integers 0-1000 (the 0-100 total x 10), one value per weather scenario
in one fixed order. A drawn field is a parcel. `splits(farm_ha, eco_practice)` picks the mode,
once, on the farm's unrounded area (the caller's `farm_ha`; by default the pieces' sum):
- parcel mode (the default): every field carries exactly one rotation on its whole area, one crop
  per year. Every candidate rotation changes the crop each year, which is how a farm meets the EU
  crop rotation standard (GAEC 7, rotation route), so no field ever needs dividing for it;
- split mode, only when the farmer enforces the PD-04 eco-scheme's crop diversification on a farm
  above 10 ha (the rule's threshold): a field of 10 ha or more may be divided between up to 2
  rotations, or up to 3 on a farm above 30 ha (the rule asks for 3 crops only there), each on at
  least 5 ha. Splitting is permitted, never forced, and the result is an area split, not a
  planting map: where each block lies is not modelled.

Rules (RULES_2026), read in the official APIA guides for 2026: GAEC 7 is met by rotation OR by
diversification (farm's choice). Diversification: arable land up to 10 ha exempt; above 10 ha up
to 30 ha at least 2 crops, main crop at most 75 %; above 30 ha at least 3 crops, main crop at most
75 %, two main crops at most 95 %. PD-04 option A: same bands with 70 % and 90 %; option C:
legumes at least 2 % of the arable land. A crop is a botanical genus (wheat, barley, maize,
sunflower and pea are five crops). The thresholds are applied to the total drawn area.

Signatures (T5 builds on these):

    solve_farm(
        pieces: Sequence[tuple[str, str, int]],         # (piece_id, field_id, area_tenths_ha)
        scores: Mapping[tuple[str, str], Sequence[int]],  # (piece_id, rotation_id) -> per scen.
        legumes: Collection[str],
        eco_practice: str | None = None,   # None (default) | "diversification" | "legume_share"
        risk_aversion: float = 0.3,        # 0-1; lambda = round(100 * risk_aversion)
        *, top: int = 3, max_time_s: float = 3.0, num_workers: int = 0,
        prune_above: int = PRUNE_ABOVE, split_prune_above: int = SPLIT_PRUNE_ABOVE,
        farm_ha: float | None = None,     # unrounded farm area; None: the pieces' sum
    ) -> FarmSolve
    splits(farm_ha: float, eco_practice: str | None = None) -> bool  # split mode, see above
    yearly_areas(allocation: Mapping[tuple[str, str], int]) -> list[dict[str, int]]
    rule_checks(allocation: Mapping[tuple[str, str], int], legumes: Collection[str],
                eco_practice: str | None) -> list[RuleResult]
    area_mean(allocation: Mapping[tuple[str, str], int],
              values: Mapping[tuple[str, str], Sequence[float]]) -> list[float]

`scores` holds, per piece, the candidates valid for its field (crop history applied). A field's
score for a rotation is the sum of its pieces' score x area; only rotations every piece of the
field has are offered. Above `prune_above` (field, rotation) pairs in parcel mode, or
`split_prune_above` (piece, rotation) pairs in split mode, `solve_farm` keeps `MAX_CANDIDATES`
per field itself; `FarmSolve.pruned` is true only when that removed a pair. Split mode has a floor
(plan §10.11): parcel mode's plans for the same request are solved first, join the split model
and hint it; they are returned (`FarmSolve.floor`) when the split search finds fewer plans or a
lower best objective. An allocation is `{(piece_id, rotation_id): area_tenths_ha}`; in parcel
mode every piece is on its full area under its field's rotation. The helpers work for any
allocation, including the farmer's current rotation (call `rule_checks` with `eco_practice=None`:
nothing applies). `area_mean(allocation, scores)` gives the farm score per scenario on the 0-1000
scale; divide by 10 for 0-100.

Rule rows are a provisional rule check, never a statement of compliance. GAEC 7 figures are
reported with `applies = False` and never enforced; PD-04 enforces exactly one practice, and only
when the caller selects it. Soil cover (GAEC 6, PD-04 cover) and eligibility are not modelled.

Every solve logs one INFO line (logger `api.planner.optimizer`). A model CP-SAT rejects
(MODEL_INVALID) raises RuntimeError, a 500 at the API, never "no plan" and never the retry.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
from itertools import chain, combinations

from ortools.sat.python import cp_model

from api.planner.candidates import crops_of

Key = tuple[str, str]  # (piece_id or field_id, rotation_id)
log = logging.getLogger(__name__)  # one INFO line per solve; an invalid model is logged, raised

# Diversification thresholds (APIA, Ghidul fermierului privind condiționalitatea 2026, GAEC 7,
# p. 61-62; eco-scheme guide 2026, PD-04, p. 14): above 10 ha at least 2 crops, above 30 ha 3.
DIVERSIFY_ABOVE_HA: float = 10
THREE_CROPS_ABOVE_HA: float = 30
MIN_BLOCK = 50  # 0.1 ha: in split mode a rotation takes 0 or at least 5 ha of a field
MAX_ROTATIONS = 3  # rotations per field in split mode, on a farm above THREE_CROPS_ABOVE_HA
WHOLE_FIELD_BELOW = 100  # 0.1 ha: in split mode a field under 10 ha carries one rotation
# Split-mode solver settings, measured 14 Nov 2026 on the service's mock-world-model scores
# (15-core Mac, 3 s per solve). On defaults the unpruned split model (45 ha demo or one 74.99 ha
# field, 4 years, about 3000 piece pairs) spends its time in single-threaded presolve (probing and
# the big-linear-overlap passes, about 1 s each) and stops after presolve with no plan (UNKNOWN);
# without them the same farms reach OPTIMAL in about 0.55 s per solve, and every 3- and 5-year
# split case measured gets faster with the same objectives. Parcel mode keeps the defaults.
SPLIT_PRESOLVE = {"cp_model_probing_level": 0, "find_big_linear_overlap": False}

# Pruning threshold in (field, rotation) pairs, measured 14 Nov 2026 (15-core Mac, 3 s per solve,
# structured test scores, top 3): 468 pairs (2 fields, 4 years) solve to OPTIMAL unpruned in
# 0.5-0.9 s per solve; 1470 pairs (5 years) take up to 3 s and can stop FEASIBLE at risk 1, and
# 2940 pairs (4 fields, 5 years) stop FEASIBLE, while the pruned models reach OPTIMAL with the same
# objectives in under 1 s. CP-SAT's default presolve is kept: turning probing off sped up the
# unpruned models but left a pruned 10-field farm FEASIBLE where the default proves it OPTIMAL.
# Both modes keep pruning (re-measured on the service's scores with SPLIT_PRESOLVE): unpruned,
# parcel mode stopped UNKNOWN on a 74 ha 5-year farm with diversification and split mode stopped
# UNKNOWN or FEASIBLE on most farms above the threshold, where the pruned solves reach a plan.
PRUNE_ABOVE = 500
# Split mode prunes on its own model size, in (piece, rotation) pairs, measured 14 Nov 2026 in
# Docker at 0.5 CPU (service scores, 3 s per solve): unpruned, the 4-year models (about 3000 pairs)
# stopped UNKNOWN with no plan and the 3-year demo (952) took 6.7-9.1 s per request (median 8.4 s,
# 5 runs); pruned to 680-720 pairs they reach split plans, the 3-year demo in 4.7-9.2 s (median
# 6.2 s).
SPLIT_PRUNE_ABOVE = 700
MAX_CANDIDATES = 40  # per field when pruned
# ponytail: ceiling of roughly 800 ha; merge cells into coarser pieces when larger farms matter.
MAX_PIECES = 150  # more pieces: ValueError here, 422 at the API


@dataclass(frozen=True)
class Rule:
    """One row of the provisional rule table. `practice` is the eco-scheme practice that enforces
    it; None = reported only, never enforced. `above` = the rule binds only on a farm larger than
    this (0.1 ha); the thresholds are applied to the total drawn area (unverified simplification).
    """

    id: str  # "max_crop_share" | "max_two_crops_share" | "legume_share" (lower limit)
    source: str  # profile and year
    practice: str | None
    limit_pct: int
    above: int
    verified: bool = False  # True only when read in the official document (url + page below)
    url: str = ""
    page: str = ""


# Read in the official 2026 documents (APIA). `above` is in 0.1 ha: the rule binds above it.
_GAEC = "https://apia.org.ro/wp-content/uploads/2026/03/Ghid-conditionalitate-ed-IV-2026fixed.pdf"
_PD04 = (
    "https://apia.org.ro/wp-content/uploads/2026/03/"
    "Ghid-informativ-privind-aplicarea-eco-schemelor-din-sectorul-vegetal-Campania-2026.pdf"
)
RULES_2026 = (
    # GAEC 7, rotation route: the crop changes at least once a year on each parcel.
    Rule("crop_change", "GAEC 7 2026", None, 0, 100, True, _GAEC, "p. 61"),
    # GAEC 7, diversification route (the alternative): reported, never enforced.
    Rule("max_crop_share", "GAEC 7 2026", None, 75, 100, True, _GAEC, "p. 62"),
    Rule("max_two_crops_share", "GAEC 7 2026", None, 95, 300, True, _GAEC, "p. 62"),
    # PD-04 (voluntary eco-scheme, arable land from 10.01 ha): option A, or option C.
    Rule("max_crop_share", "PD-04 2026", "diversification", 70, 100, True, _PD04, "p. 14"),
    Rule("max_two_crops_share", "PD-04 2026", "diversification", 90, 300, True, _PD04, "p. 14"),
    Rule("legume_share", "PD-04 2026", "legume_share", 2, 100, True, _PD04, "p. 15"),
)
ECO_PRACTICES = ("diversification", "legume_share")


@dataclass(frozen=True)
class RuleResult:
    """Field names match the `RuleCheck` contract."""

    id: str
    source: str
    limit_pct: float
    value_pct: float  # worst plan year
    applies: bool
    passed: bool
    verified: bool


@dataclass(frozen=True)
class Plan:
    allocation: dict[Key, int]  # (piece, rotation) -> 0.1 ha; each piece's areas sum to its area
    scenario_totals: list[int]  # sum of score x area per scenario
    objective: int
    status: str  # CP-SAT status name of the solve that found it
    proven_optimal: bool


@dataclass(frozen=True)
class FarmSolve:
    plans: list[Plan]  # best objective first; plans[1:] are alternatives, not runners-up
    status: str  # status of the solve that ended the ranking: INFEASIBLE / UNKNOWN when it stopped
    eco_practice: str | None  # practice enforced in `plans` (None if none or dropped)
    eco_dropped: bool  # the requested practice was not applied: its solve found no plan
    # (INFEASIBLE, or UNKNOWN when out of time), so the plans come from one retry without it
    pruned: bool
    times_s: list[float] = field(default_factory=list)  # wall time per solve
    # Split mode only: `plans` are parcel mode's (each field whole), not proven optimal, because the
    # split search found fewer plans in time, or plans that score lower (plan §10.11).
    floor: bool = False


def is_proven_optimal(status: cp_model.CpSolverStatus, pruned: bool, first_solve: bool) -> bool:
    """Optimal for this model only: OPTIMAL, nothing pruned, and found before any ranking cut."""
    return status == cp_model.OPTIMAL and not pruned and first_solve


def splits(farm_ha: float, eco_practice: str | None = None) -> bool:
    """Split mode: only to meet the PD-04 crop diversification the farmer enforces, on a farm whose
    unrounded area is above DIVERSIFY_ABOVE_HA (smaller farms are exempt). The only mode
    comparison; `solve_farm` decides with it."""
    return eco_practice == "diversification" and farm_ha > DIVERSIFY_ABOVE_HA


def solve_farm(
    pieces: Sequence[tuple[str, str, int]],
    scores: Mapping[Key, Sequence[int]],
    legumes: Collection[str],
    eco_practice: str | None = None,
    risk_aversion: float = 0.3,
    *,
    top: int = 3,
    max_time_s: float = 3.0,
    num_workers: int = 0,
    prune_above: int = PRUNE_ABOVE,
    split_prune_above: int = SPLIT_PRUNE_ABOVE,
    farm_ha: float | None = None,
) -> FarmSolve:
    if eco_practice is not None and eco_practice not in ECO_PRACTICES:
        raise ValueError(f"unknown eco practice {eco_practice!r}")
    if len(pieces) > MAX_PIECES:
        raise ValueError(f"{len(pieces)} pieces; at most {MAX_PIECES} are planned")
    by_field = _field_scores(pieces, scores)
    whole = _prune(by_field) if len(by_field) > prune_above else by_field  # parcel mode's model
    whole_pruned = len(whole) < len(by_field)
    kept, pruned = whole, whole_pruned
    split = splits(sum(a for _, _, a in pieces) / 10 if farm_ha is None else farm_ha, eco_practice)
    if split:  # per piece, on its field's rotations; pruned on its own size, in piece pairs
        field_of = {p: f for p, f, _ in pieces}
        kept = {k: list(s) for k, s in scores.items() if (field_of.get(k[0]), k[1]) in by_field}
        narrow = _prune(by_field) if len(kept) > split_prune_above else by_field
        kept = {k: s for k, s in kept.items() if (field_of[k[0]], k[1]) in narrow}
        pruned = len(narrow) < len(by_field)
    lam = round(100 * risk_aversion)
    times: list[float] = []
    for practice in dict.fromkeys((eco_practice, None)):  # no plan: retry once without it
        args = (legumes, practice, lam, top, max_time_s, num_workers)
        # Split mode's floor (plan §10.11): parcel mode's plans for the same request, solved first.
        floor, floor_status, t = (
            _rank(pieces, whole, *args, whole_pruned, False, len(by_field))
            if split
            else ([], "", [])
        )
        times += t
        floor.sort(key=lambda p: -p.objective)
        hint = floor[0].allocation if floor else None
        # The floor's rotations join the split model: its best plan is a feasible split answer.
        model = {**kept, **{k: list(scores[k]) for q in floor for k in q.allocation}}
        plans, status, t = _rank(pieces, model, *args, pruned, split, len(by_field), hint)
        times += t
        plans.sort(key=lambda p: -p.objective)  # a time-limited solve can find them out of order
        # Split plans only when as many as the floor's and the best scores at least the floor's.
        on_floor = bool(floor) and (
            len(plans) < len(floor) or plans[0].objective < floor[0].objective
        )
        if on_floor:
            plans, status = [replace(p, proven_optimal=False) for p in floor], floor_status
            pruned = whole_pruned  # the floor's own model
        if plans:
            break
    return FarmSolve(plans, status, practice, practice != eco_practice, pruned, times, on_floor)


def _rank(
    pieces: Sequence[tuple[str, str, int]],
    scores: Mapping[Key, Sequence[int]],  # per scenario; split: per piece, parcel: per field
    legumes: Collection[str],
    practice: str | None,
    lam: int,
    top: int,
    max_time_s: float,
    num_workers: int,
    pruned: bool,
    split: bool,
    candidates: int,  # (field, rotation) pairs before pruning, for the log
    hint: Mapping[Key, int] | None = None,
) -> tuple[list[Plan], str, list[float]]:
    m = cp_model.CpModel()
    field_area: dict[str, int] = defaultdict(int)
    of_field: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for p, f, a in pieces:
        field_area[f] += a
        of_field[f].append((p, a))
    total = sum(field_area.values())

    # x: the objective's variables, keyed as `scores`; use[f, r]: field f carries rotation r;
    # areas: the 0.1 ha each key grows, for the rules. No candidate left for a field: INFEASIBLE.
    x: dict[Key, cp_model.IntVar]
    use: dict[Key, cp_model.IntVar]
    areas: Mapping[Key, cp_model.LinearExprT]
    if split:  # 0.1 ha of a piece per rotation; few rotations per field, each 0 or >= MIN_BLOCK
        area = {p: a for p, _, a in pieces}
        field_of = {p: f for p, f, _ in pieces}
        x = {k: m.new_int_var(0, area[k[0]], f"ha_{k[0]}_{k[1]}") for k in scores}
        areas = x
        per_piece: dict[str, list[cp_model.IntVar]] = defaultdict(list)
        blocks: dict[Key, list[cp_model.IntVar]] = defaultdict(list)
        for (p, r), v in x.items():
            per_piece[p].append(v)
            blocks[field_of[p], r].append(v)
        for p, a in area.items():
            m.add(cp_model.LinearExpr.sum(per_piece[p]) == a)
        use = {}
        per_field: dict[str, list[cp_model.IntVar]] = defaultdict(list)
        for (f, r), vs in blocks.items():
            u = use[f, r] = m.new_bool_var(f"use_{f}_{r}")
            per_field[f].append(u)
            block = cp_model.LinearExpr.sum(vs)
            m.add(block >= min(MIN_BLOCK, field_area[f]) * u)
            m.add(block <= field_area[f] * u)
        for f, us in per_field.items():
            # As many rotations as the farm needs crops: 2, or 3 above THREE_CROPS_ABOVE_HA.
            need = MAX_ROTATIONS if total > 10 * THREE_CROPS_ABOVE_HA else 2
            cap = 1 if field_area[f] < WHOLE_FIELD_BELOW else need
            m.add(cp_model.LinearExpr.sum(us) <= cap)
        if hint:  # the floor's best plan; at 0.5 CPU it led to more OPTIMAL split solves
            on_hint = {(field_of[p], r) for p, r in hint}
            for key, v in x.items():
                m.add_hint(v, hint.get(key, 0))
            for key, u in use.items():
                m.add_hint(u, key in on_hint)
    else:  # one rotation per field, on its whole area
        x = use = {k: m.new_bool_var(f"x_{k[0]}_{k[1]}") for k in scores}
        for f in field_area:
            m.add_exactly_one(v for (g, _), v in x.items() if g == f)
        areas = {k: field_area[k[0]] * v for k, v in x.items()}

    # The one eco practice selected: every plan year, on the whole farm area, as integers.
    for rule in RULES_2026:
        if practice is None or rule.practice != practice or total <= rule.above:
            continue
        for grown in _grown_per_year(areas):
            g = {c: cp_model.LinearExpr.sum(vs) for c, vs in grown.items()}
            if rule.id == "max_crop_share":
                for e in g.values():
                    m.add(100 * e <= rule.limit_pct * total)
            elif rule.id == "max_two_crops_share":
                for e1, e2 in combinations(g.values(), 2):
                    m.add(100 * (e1 + e2) <= rule.limit_pct * total)
            else:
                leg = [v for c, vs in grown.items() if c in legumes for v in vs]
                m.add(100 * cp_model.LinearExpr.sum(leg) >= rule.limit_pct * total)

    # Objective: (100 - lam) * sum_k total_k + lam * K * worst, worst <= total_k.
    keys = list(x)
    xs = list(x.values())
    n_scen = len(next(iter(scores.values()))) if scores else 0
    worst = m.new_int_var(0, 1000 * total, "worst")
    for k in range(n_scen):
        m.add(worst <= cp_model.LinearExpr.weighted_sum(xs, [scores[key][k] for key in keys]))
    coefs = [(100 - lam) * sum(scores[key]) for key in keys]
    m.maximize(cp_model.LinearExpr.weighted_sum([*xs, worst], [*coefs, lam * n_scen]))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time_s
    solver.parameters.num_workers = num_workers
    if split:  # see SPLIT_PRESOLVE
        for name, value in SPLIT_PRESOLVE.items():
            setattr(solver.parameters, name, value)
    plans: list[Plan] = []
    times: list[float] = []
    status_name = "INFEASIBLE"
    for i in range(top):
        status = solver.solve(m)
        if status == cp_model.MODEL_INVALID:  # a bug in this model: never "no plan", no retry
            why = m.validate()
            log.error("farm solve: CP-SAT rejected the model: %s", why)
            raise RuntimeError(f"CP-SAT rejected the farm model: {why}")
        times.append(solver.wall_time)
        status_name = solver.status_name(status)
        found = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        obj, bound = solver.objective_value, solver.best_objective_bound
        log.info(
            "farm solve %d: mode=%s practice=%s status=%s objective=%s bound=%.0f gap=%s "
            "wall=%.2fs candidates=%d/%d fields=%d pieces=%d",
            i + 1,
            "split" if split else "parcel",
            practice,
            status_name,
            f"{obj:.0f}" if found else "-",
            bound,
            f"{abs(bound - obj) / max(1.0, abs(obj)):.4%}" if found else "-",
            solver.wall_time,
            candidates,
            len(use),
            len(field_area),
            len(pieces),
        )
        if not found:
            break  # INFEASIBLE: no further alternative (or no plan); UNKNOWN: out of time
        vals = {k: n for k, v in x.items() if (n := solver.value(v))}
        alloc = vals if split else {(p, r): a for f, r in vals for p, a in of_field[f]}
        totals = [sum(scores[k][s] * n for k, n in vals.items()) for s in range(n_scen)]
        proven = is_proven_optimal(status, pruned, i == 0)
        plans.append(Plan(alloc, totals, round(solver.objective_value), status_name, proven))
        # The next plan drops at least two (field, rotation) choices (the only one if one).
        on = [u for u in use.values() if solver.value(u)]
        m.add(cp_model.LinearExpr.sum(on) <= len(on) - min(2, len(on)))
    return plans, status_name, times


def _grown_per_year[T](alloc: Mapping[Key, T]) -> list[dict[str, list[T]]]:
    """Per plan year, crop -> the allocation values (variables or areas) growing it."""
    years: list[dict[str, list[T]]] = []
    for (_, r), v in alloc.items():
        for t, c in enumerate(crops_of(r)):
            if t == len(years):
                years.append(defaultdict(list))
            years[t][c].append(v)
    return years


def _field_scores(
    pieces: Sequence[tuple[str, str, int]], scores: Mapping[Key, Sequence[int]]
) -> dict[Key, list[int]]:
    """(field_id, rotation_id) -> per scenario, the sum of score x area over the field's pieces,
    for the rotations every piece of the field has."""
    field_of = {p: (f, a) for p, f, a in pieces}
    n_pieces = Counter(f for _, f, _ in pieces)
    acc: dict[Key, list[int]] = {}
    seen: Counter[Key] = Counter()
    for (p, r), s in scores.items():
        if p not in field_of:
            continue
        f, a = field_of[p]
        row = acc.setdefault((f, r), [0] * len(s))
        for k, v in enumerate(s):
            row[k] += v * a
        seen[f, r] += 1
    return {k: row for k, row in acc.items() if seen[k] == n_pieces[k[0]]}


def _prune(scores: Mapping[Key, list[int]]) -> dict[Key, list[int]]:
    """Keep MAX_CANDIDATES rotation IDs per field: first the best ID by mean for every (year,
    crop), so the share rules stay reachable, then alternately the best by mean and by worst
    scenario, so risk-averse choices survive."""
    rows: dict[str, dict[str, list[int]]] = defaultdict(dict)
    for (f, r), s in scores.items():
        rows[f][r] = s
    keep: set[Key] = set()
    for f, rs in rows.items():
        by_mean = sorted(rs, key=lambda r: -sum(rs[r]))
        by_worst = sorted(rs, key=lambda r: -min(rs[r]))
        seeds: dict[tuple[int, str], str] = {}
        for r in by_mean:
            for t, c in enumerate(crops_of(r)):
                seeds.setdefault((t, c), r)
        order = dict.fromkeys(
            chain(seeds.values(), chain.from_iterable(zip(by_mean, by_worst, strict=True)))
        )
        keep.update((f, r) for r in list(order)[:MAX_CANDIDATES])
    return {k: s for k, s in scores.items() if k in keep}


def yearly_areas(allocation: Mapping[Key, int]) -> list[dict[str, int]]:
    """Per plan year, crop -> area (0.1 ha)."""
    return [{c: sum(vs) for c, vs in grown.items()} for grown in _grown_per_year(allocation)]


def rule_checks(
    allocation: Mapping[Key, int], legumes: Collection[str], eco_practice: str | None
) -> list[RuleResult]:
    """Every row of RULES_2026 for this allocation, worst plan year; `applies` only for the
    practice enforced (pass None for the current rotation). A rule whose farm-size threshold is
    not reached passes."""
    total = sum(allocation.values())
    years = yearly_areas(allocation)
    out = []
    for rule in RULES_2026:
        if rule.id == "crop_change":  # area with the same crop as the year before, worst year
            worst = max(
                (
                    sum(a for (_, r), a in allocation.items() if _repeats(r, t))
                    for t in range(1, len(years))
                ),
                default=0,
            )
        elif rule.id == "max_crop_share":
            worst = max(max(y.values()) for y in years)
        elif rule.id == "max_two_crops_share":
            worst = max(sum(sorted(y.values())[-2:]) for y in years)
        else:
            worst = min(sum(a for c, a in y.items() if c in legumes) for y in years)
        lower = rule.id == "legume_share"
        meets = (
            100 * worst >= rule.limit_pct * total
            if lower
            else 100 * worst <= rule.limit_pct * total
        )
        out.append(
            RuleResult(
                id=rule.id,
                source=rule.source,
                limit_pct=rule.limit_pct,
                value_pct=round(100 * worst / total, 1),
                applies=rule.practice is not None and rule.practice == eco_practice,
                passed=meets or total <= rule.above,
                verified=rule.verified,
            )
        )
    return out


def _repeats(rotation: str, year: int) -> bool:
    crops = crops_of(rotation)
    return crops[year] == crops[year - 1]


def area_mean(allocation: Mapping[Key, int], values: Mapping[Key, Sequence[float]]) -> list[float]:
    """Area-weighted mean of a per-(piece, rotation) vector over the allocation, e.g. the four
    score terms or the per-scenario totals."""
    total = sum(allocation.values())
    n = len(values[next(iter(allocation))])
    return [sum(values[k][i] * a for k, a in allocation.items()) / total for i in range(n)]
