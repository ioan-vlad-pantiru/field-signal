"""CP-SAT farm rotation optimizer (plan §3.7): an area split per field over candidate rotations.

Plain data in and out; imports no FastAPI, contracts, weather or mock (plan §5a). Areas are
integers in 0.1 ha, scores integers 0-1000 (the 0-100 total x 10), one value per weather scenario
in one fixed order. The result is an area split, not a planting map: contiguity is not modelled.

Signatures (T5 builds on these):

    solve_farm(
        pieces: Sequence[tuple[str, str, int]],         # (piece_id, field_id, area_tenths_ha)
        scores: Mapping[tuple[str, str], Sequence[int]],  # (piece_id, rotation_id) -> per scen.
        legumes: Collection[str],
        eco_practice: str | None = None,   # None (default) | "diversification" | "legume_share"
        risk_aversion: float = 0.3,        # 0-1; lambda = round(100 * risk_aversion)
        *, top: int = 3, max_time_s: float = 3.0, num_workers: int = 0,
        prune_above: int = PRUNE_ABOVE,
    ) -> FarmSolve
    yearly_areas(allocation: Mapping[tuple[str, str], int]) -> list[dict[str, int]]
    rule_checks(allocation: Mapping[tuple[str, str], int], legumes: Collection[str],
                eco_practice: str | None) -> list[RuleResult]
    area_mean(allocation: Mapping[tuple[str, str], int],
              values: Mapping[tuple[str, str], Sequence[float]]) -> list[float]

`scores` holds, per piece, the candidates valid for its field (crop history applied). Above
`prune_above` (piece, rotation) pairs, `solve_farm` keeps `MAX_CANDIDATES` per piece itself.
An allocation is `{(piece_id, rotation_id): area_tenths_ha}`; the helpers work for any
allocation, including the farmer's current rotation (call `rule_checks` with
`eco_practice=None`: nothing applies). `area_mean(allocation, scores)` gives the farm score per
scenario on the 0-1000 scale; divide by 10 for 0-100.

Rule rows are a provisional rule check, never a statement of compliance. GAEC 7 figures are
reported with `applies = False` and never enforced; PD-04 enforces exactly one practice, and only
when the caller selects it. Soil cover (GAEC 6, PD-04 cover) and eligibility are not modelled.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from itertools import chain, combinations

from ortools.sat.python import cp_model

from api.planner.candidates import crops_of

Key = tuple[str, str]  # (piece_id, rotation_id)

MIN_BLOCK = 50  # 0.1 ha: a rotation takes 0 or at least 5 ha of a field (placeholder)
MAX_ROTATIONS = 3  # rotations per field (placeholder)
WHOLE_FIELD_BELOW = 100  # 0.1 ha: a field under 10 ha carries one rotation (placeholder)
# Pruning threshold in (piece, rotation) pairs, measured 14 Nov 2026 (15-core Mac, 3 s per
# solve, structured test scores): the 7-piece demo farm at 4 years (1638 pairs) solves to OPTIMAL
# unpruned at the default risk; at 5 years (5145 pairs) unpruned solves stop FEASIBLE with gaps
# of 2-5 % at risk 1, while the pruned model reaches the same or better objectives.
# ponytail: pruning by pair count; aggregate identical pieces if large farms need proofs.
PRUNE_ABOVE = 2000
MAX_CANDIDATES = 40  # per piece when pruned
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


# Figures from secondary sources, NOT read in the official 2026 documents: every row unverified.
# To verify: the MADR eco-scheme guide (sector vegetal, campania 2026) and "Ghidul fermierului
# privind condiționalitatea", ed. IV 2026, both on madr.ro; neither PDF could be fetched on
# 14 Nov 2026 (web firewall / TLS error), so no URL or page is recorded.
RULES_2026 = (
    Rule("max_crop_share", "GAEC 7 2026", None, 75, 100),
    Rule("max_two_crops_share", "GAEC 7 2026", None, 95, 300),
    Rule("max_crop_share", "PD-04 2026", "diversification", 70, 100),
    Rule("max_two_crops_share", "PD-04 2026", "diversification", 90, 300),
    Rule("legume_share", "PD-04 2026", "legume_share", 2, 0),
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
    allocation: dict[Key, int]
    scenario_totals: list[int]  # sum of score x area per scenario
    objective: int
    status: str  # CP-SAT status name of the solve that found it
    proven_optimal: bool


@dataclass(frozen=True)
class FarmSolve:
    plans: list[Plan]  # best objective first; plans[1:] are alternatives, not runners-up
    status: str  # status of the solve that ended the ranking: INFEASIBLE / UNKNOWN when it stopped
    eco_practice: str | None  # practice enforced in `plans` (None if none or dropped)
    eco_dropped: bool  # the requested practice made the model infeasible and was dropped
    pruned: bool
    times_s: list[float] = field(default_factory=list)  # wall time per solve


def is_proven_optimal(status: cp_model.CpSolverStatus, pruned: bool, first_solve: bool) -> bool:
    """Optimal for this model only: OPTIMAL, nothing pruned, and found before any ranking cut."""
    return status == cp_model.OPTIMAL and not pruned and first_solve


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
) -> FarmSolve:
    if eco_practice is not None and eco_practice not in ECO_PRACTICES:
        raise ValueError(f"unknown eco practice {eco_practice!r}")
    if len(pieces) > MAX_PIECES:
        raise ValueError(f"{len(pieces)} pieces; at most {MAX_PIECES} are planned")
    pruned = len(scores) > prune_above
    kept = _prune(pieces, scores) if pruned else scores
    lam = round(100 * risk_aversion)
    times: list[float] = []
    for practice in dict.fromkeys((eco_practice, None)):  # retry once without the practice
        plans, status, t = _rank(
            pieces, kept, legumes, practice, lam, top, max_time_s, num_workers, pruned
        )
        times += t
        if plans or status != "INFEASIBLE":
            break
    plans.sort(key=lambda p: -p.objective)  # a time-limited solve can find them out of order
    return FarmSolve(plans, status, practice, practice != eco_practice, pruned, times)


def _rank(
    pieces: Sequence[tuple[str, str, int]],
    scores: Mapping[Key, Sequence[int]],
    legumes: Collection[str],
    practice: str | None,
    lam: int,
    top: int,
    max_time_s: float,
    num_workers: int,
    pruned: bool,
) -> tuple[list[Plan], str, list[float]]:
    m = cp_model.CpModel()
    area = {p: a for p, _, a in pieces}
    total = sum(area.values())
    field_area: dict[str, int] = defaultdict(int)
    for _, f, a in pieces:
        field_area[f] += a

    keys = [k for k in scores if k[0] in area]
    ha = {k: m.new_int_var(0, area[k[0]], f"ha_{k[0]}_{k[1]}") for k in keys}
    per_piece: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    for (p, _), v in ha.items():
        per_piece[p].append(v)
    for p, a in area.items():
        m.add(cp_model.LinearExpr.sum(per_piece[p]) == a)

    # Blocks: a rotation takes 0 or >= MIN_BLOCK of a field; few rotations per field.
    field_of = {p: f for p, f, _ in pieces}
    blocks: dict[tuple[str, str], list[cp_model.IntVar]] = defaultdict(list)
    for (p, r), v in ha.items():
        blocks[field_of[p], r].append(v)
    use: dict[tuple[str, str], cp_model.IntVar] = {}
    per_field: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    for (f, r), vs in blocks.items():
        u = use[f, r] = m.new_bool_var(f"use_{f}_{r}")
        per_field[f].append(u)
        block = cp_model.LinearExpr.sum(vs)
        m.add(block >= min(MIN_BLOCK, field_area[f]) * u)
        m.add(block <= field_area[f] * u)
    for f, us in per_field.items():
        cap = 1 if field_area[f] < WHOLE_FIELD_BELOW else MAX_ROTATIONS
        m.add(cp_model.LinearExpr.sum(us) <= cap)

    # The one eco practice selected: every plan year, on the whole farm area, as integers.
    for rule in RULES_2026:
        if practice is None or rule.practice != practice or total <= rule.above:
            continue
        for grown in _grown_per_year(ha):
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
    n_scen = len(next(iter(scores.values()))) if scores else 0
    hv = list(ha.values())
    worst = m.new_int_var(0, 1000 * total, "worst")
    for k in range(n_scen):
        m.add(worst <= cp_model.LinearExpr.weighted_sum(hv, [scores[key][k] for key in keys]))
    coefs = [(100 - lam) * sum(scores[key]) for key in keys]
    m.maximize(cp_model.LinearExpr.weighted_sum([*hv, worst], [*coefs, lam * n_scen]))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time_s
    solver.parameters.num_workers = num_workers
    # Probing and the linear-overlap presolve took 2.5 of 3 s on a 150-piece farm (no solution).
    solver.parameters.cp_model_probing_level = 0
    solver.parameters.find_big_linear_overlap = False
    plans: list[Plan] = []
    times: list[float] = []
    status_name = "INFEASIBLE"
    for i in range(top):
        status = solver.solve(m)
        times.append(solver.wall_time)
        status_name = solver.status_name(status)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break  # INFEASIBLE: no further alternative (or no plan); UNKNOWN: out of time
        alloc = {k: a for k, v in ha.items() if (a := solver.value(v))}
        totals = [sum(scores[k][s] * a for k, a in alloc.items()) for s in range(n_scen)]
        proven = is_proven_optimal(status, pruned, i == 0)
        plans.append(Plan(alloc, totals, round(solver.objective_value), status_name, proven))
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


def _prune(
    pieces: Sequence[tuple[str, str, int]], scores: Mapping[Key, Sequence[int]]
) -> dict[Key, Sequence[int]]:
    """Keep MAX_CANDIDATES rotation IDs per piece: first the best ID by mean for every (year,
    crop), so the share rules stay reachable, then alternately the best by mean and by worst
    scenario, so risk-averse choices survive. The pieces of a field that must stay whole share one
    set, ranked on the field's area-weighted scores, so one rotation can still cover them all."""
    field_area: dict[str, int] = defaultdict(int)
    for _, f, a in pieces:
        field_area[f] += a
    area = {p: a for p, _, a in pieces}
    group = {p: f if field_area[f] < WHOLE_FIELD_BELOW else p for p, f, _ in pieces}
    agg: dict[str, dict[str, list[int]]] = defaultdict(dict)
    for (p, r), s in scores.items():
        acc = agg[group[p]].setdefault(r, [0] * len(s))
        for k, x in enumerate(s):
            acc[k] += x * area[p]
    keep: dict[str, set[str]] = {}
    for g, rs in agg.items():
        by_mean = sorted(rs, key=lambda r: -sum(rs[r]))
        by_worst = sorted(rs, key=lambda r: -min(rs[r]))
        seeds: dict[tuple[int, str], str] = {}
        for r in by_mean:
            for t, c in enumerate(crops_of(r)):
                seeds.setdefault((t, c), r)
        order = dict.fromkeys(
            chain(seeds.values(), chain.from_iterable(zip(by_mean, by_worst, strict=True)))
        )
        keep[g] = set(list(order)[:MAX_CANDIDATES])
    return {k: s for k, s in scores.items() if k[1] in keep[group[k[0]]]}


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
        if rule.id == "max_crop_share":
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


def area_mean(allocation: Mapping[Key, int], values: Mapping[Key, Sequence[float]]) -> list[float]:
    """Area-weighted mean of a per-(piece, rotation) vector over the allocation, e.g. the four
    score terms or the per-scenario totals."""
    total = sum(allocation.values())
    n = len(values[next(iter(allocation))])
    return [sum(values[k][i] * a for k, a in allocation.items()) / total for i in range(n)]
