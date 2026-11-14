"""Optimizer tests (plan §5 T4). Inline tables and deterministic stand-in scores; one regression
test builds the service's scores (grid, mock world model, scoring). Timing tests print their
figures (run with `-s` to see them)."""

import logging
import random
import time
from dataclasses import replace
from itertools import pairwise
from typing import Any

import pytest
from ortools.sat.python import cp_model

import api.planner.optimizer as optimizer
from api.contracts import Priority
from api.planner import grid, scoring
from api.planner.candidates import (
    candidates,
    crops_of,
    cycle,
    history_from_cycle,
    is_valid,
    rotation_id,
)
from api.planner.crops import CROPS as TRAITS
from api.planner.crops import LEGUMES as CROP_LEGUMES
from api.planner.optimizer import (
    MAX_PIECES,
    RULES_2026,
    FarmSolve,
    Plan,
    area_mean,
    is_proven_optimal,
    rule_checks,
    solve_farm,
    splits,
    yearly_areas,
)

# As planner/crops.py on 14 Nov 2026 (draft return intervals).
MIN_RETURN = {"maize": 1, "wheat": 2, "barley": 2, "sunflower": 5, "pea": 4}
CROPS = list(MIN_RETURN)
LEGUMES = {"pea"}
VALUE = {"maize": 60, "wheat": 50, "barley": 45, "sunflower": 55, "pea": 35}
MAIZE_FIRST = {"maize": 90, "wheat": 60, "barley": 50, "sunflower": 50, "pea": 10}
DEMO = {"A": [62] * 6, "B": [80]}  # 37.2 ha in six pieces and an 8 ha field: split mode
LARGE = {"A": [124] * 6, "B": [160]}  # DEMO at twice the area, 90.4 ha: parcel mode
FOUR_FIELDS = {f: [100, 100] for f in "WXYZ"}  # 80 ha, four 20 ha parcels: parcel mode
AIUD = {  # the API tests' demo farm, about 37 ha and 8 ha (split mode)
    "f1": [(46.3000, 23.7460), (46.3003, 23.7538), (46.2953, 23.7546), (46.2948, 23.7457)],
    "f2": [(46.3022, 23.7560), (46.3024, 23.7607), (46.3004, 23.7609), (46.3002, 23.7558)],
}
_MX, _MY = grid.metres_per_degree(46.297)  # one 74.99 ha field, 0.006° tall, as the API tests
_EAST = 23.74 + 74.99e4 / (_MX * _MY * 0.006)
ONE_74_99 = {"f1": [(46.3, 23.74), (46.3, _EAST), (46.294, _EAST), (46.294, 23.74)]}
SCENARIOS = {3: 42, 4: 41, 5: 40}  # windows inside 1982-2025
SLOW = 30.0  # time limit where a test needs OPTIMAL; these solve in about 1 s here

Pieces = list[tuple[str, str, int]]
Scores = dict[tuple[str, str], list[int]]


def farm(
    fields: dict[str, list[int]],
    years: int,
    n_scen: int,
    value: dict[str, int] = VALUE,
    weather: int = 25,
    seed: int = 0,
) -> tuple[Pieces, Scores]:
    """Stand-in world model: crop value plus a per-scenario weather effect per year and crop, a
    bonus for wheat after pea and a small per-piece offset; 0-1000."""
    rng = random.Random(seed)
    w = [
        [{c: rng.randint(-weather, weather) for c in CROPS} for _ in range(years)]
        for _ in range(n_scen)
    ]
    rids = candidates(CROPS, years, MIN_RETURN)
    pieces: Pieces = []
    scores: Scores = {}
    for f, cells in fields.items():
        for i, area in enumerate(cells):
            p = f"{f}{i}"
            pieces.append((p, f, area))
            off = rng.randint(-5, 5)
            for r in rids:
                cs = crops_of(r)
                bonus = 8 * sum(x == "pea" and y == "wheat" for x, y in pairwise(cs))
                scores[p, r] = [
                    min(
                        1000,
                        max(
                            0,
                            200
                            + 10
                            * (
                                sum(value[c] + w[k][t][c] for t, c in enumerate(cs)) // years
                                + bonus
                                + off
                            ),
                        ),
                    )
                    for k in range(n_scen)
                ]
    return pieces, scores


def shares(plan: Plan) -> list[dict[str, float]]:
    areas = yearly_areas(plan.allocation)
    total = sum(plan.allocation.values())
    return [{c: 100 * a / total for c, a in year.items()} for year in areas]


def choices(plan: Plan, pieces: Pieces) -> set[tuple[str, str]]:
    field_of = {p: f for p, f, _ in pieces}
    return {(field_of[p], r) for p, r in plan.allocation}


def check_parcels(result: FarmSolve, pieces: Pieces) -> None:
    """Every piece once on its full area; one rotation per field."""
    area = {p: a for p, _, a in pieces}
    for plan in result.plans:
        assert sorted(p for p, _ in plan.allocation) == sorted(area)
        assert all(a == area[p] for (p, _), a in plan.allocation.items())
        assert len(choices(plan, pieces)) == len({f for _, f, _ in pieces})


def check_blocks(result: FarmSolve, pieces: Pieces) -> None:
    """Split mode: every piece's areas sum to its area; per field at most 3 rotations, one under
    10 ha, each on at least 5 ha."""
    area = {p: a for p, _, a in pieces}
    field_of = {p: f for p, f, _ in pieces}
    field_area: dict[str, int] = {}
    for _, f, a in pieces:
        field_area[f] = field_area.get(f, 0) + a
    for plan in result.plans:
        for p, a in area.items():
            assert sum(v for (q, _), v in plan.allocation.items() if q == p) == a
        blocks: dict[tuple[str, str], int] = {}
        for (p, r), v in plan.allocation.items():
            blocks[field_of[p], r] = blocks.get((field_of[p], r), 0) + v
        for f, af in field_area.items():
            used = [v for (g, _), v in blocks.items() if g == f]
            assert len(used) <= (1 if af < 100 else 3) and min(used) >= min(50, af)


def service_farm(fields: dict[str, list[tuple[float, float]]], years: int) -> tuple[Pieces, Scores]:
    """Pieces and scores built as the service builds them (grid pieces, mock world model,
    scoring) for fields last cropped maize-wheat-maize."""
    ps = [p for f, b in fields.items() for p in grid.pieces(f, b)]
    hist = history_from_cycle(["maize", "wheat", "maize"])
    min_return = {c: v.min_return_years for c, v in TRAITS.items()}
    rids = candidates(list(TRAITS), years, min_return, hist)
    base = rotation_id(cycle(["maize", "wheat", "maize"], years))
    table = scoring.farm_scores(
        ps,
        {f: hist for f in fields},
        {f: [*dict.fromkeys([*rids, base])] for f in fields},
        {Priority.YIELD: 0.5, Priority.WATER: 0.8, Priority.SOIL: 0.6, Priority.RISK: 0.4},
    )
    scores = {k: v for k, v in scoring.totals(table).items() if k[1] in set(rids)}
    return [(p.piece_id, p.field_id, p.area_tenths_ha) for p in ps], scores


def one_field(tenths: int, n: int = 5) -> dict[str, list[int]]:
    """One field of exactly `tenths` 0.1 ha in n integer pieces."""
    return {"F": [tenths // n] * (n - 1) + [tenths - (n - 1) * (tenths // n)]}


def stub_out_of_time(monkeypatch: pytest.MonkeyPatch) -> None:
    """The solve with a practice ends UNKNOWN with no plan; the retry without it is real."""
    real = optimizer._rank

    def out_of_time(*args: Any) -> tuple[list[Plan], str, list[float]]:
        return ([], "UNKNOWN", [3.0]) if args[3] is not None else real(*args)

    monkeypatch.setattr(optimizer, "_rank", out_of_time)


# --- candidates ---------------------------------------------------------------------------


def test_candidate_counts_and_no_crop_two_years_running() -> None:
    for years, n in ((3, 72), (4, 234), (5, 735)):
        rids = candidates(CROPS, years, MIN_RETURN)
        assert len(rids) == n
        for r in rids:
            cs = crops_of(r)
            assert all(a != b for a, b in pairwise(cs))


def test_sunflower_three_years_back_blocks_sunflower_in_year_one() -> None:
    history = ["sunflower", "wheat", "maize"]  # most recent harvest last
    assert any(r.startswith("sunflower") for r in candidates(CROPS, 4, MIN_RETURN))
    assert not any(r.startswith("sunflower") for r in candidates(CROPS, 4, MIN_RETURN, history))
    assert not is_valid(["wheat", "sunflower", "maize"], MIN_RETURN, history)  # distance 4 < 5
    assert is_valid(["wheat", "barley", "sunflower"], MIN_RETURN, history)  # distance 5
    assert is_valid(["maize", "wheat", "maize"], MIN_RETURN, ["soybean"])  # unknown crop ignored


def test_baseline_cycle_and_assumed_history() -> None:
    current = ["maize", "wheat", "maize"]
    assert cycle(current, 4) == ["maize", "wheat", "maize", "maize"]
    assert history_from_cycle(current) == ["maize", "maize", "wheat", "maize"]
    # Plan year 1 repeats last year's maize: the baseline is scored but not proposed.
    assert not is_valid(cycle(current, 3), MIN_RETURN, history_from_cycle(current))
    assert rotation_id(cycle(current, 3)) == "maize>wheat>maize"


# --- model --------------------------------------------------------------------------------


@pytest.mark.parametrize("fields", [DEMO, LARGE])
def test_allocations_keep_the_mode_limits(fields: dict[str, list[int]]) -> None:
    """45.2 ha, split mode: blocks of at least 5 ha, at most 3 per field, field B (8 ha) whole.
    90.4 ha, parcel mode: field A (74.4 ha, six pieces whose scores differ) is not split."""
    pieces, scores = farm(fields, 3, 5)
    result = solve_farm(pieces, scores, LEGUMES)
    assert len(result.plans) == 3
    (check_blocks if fields is DEMO else check_parcels)(result, pieces)
    total = sum(a for _, _, a in pieces)
    for plan in result.plans:
        mean = area_mean(plan.allocation, scores)  # 0-1000 farm score per scenario
        assert [round(x * total) for x in mean] == plan.scenario_totals


@pytest.mark.parametrize(("farm_ha", "split"), [(74.99, True), (75.0, False), (75.01, False)])
def test_mode_follows_the_unrounded_farm_area(farm_ha: float, split: bool) -> None:
    """§10.6: identical pieces (one field, 75.0 ha in 0.1 ha); only `farm_ha` differs. Under
    75 ha the field splits to meet diversification; at 75 ha or more it keeps one rotation and
    the practice is dropped."""
    pieces, scores = farm(one_field(750), 3, 2)
    assert splits(farm_ha) is split
    result = solve_farm(pieces, scores, LEGUMES, "diversification", farm_ha=farm_ha)
    assert result.plans and result.eco_dropped is not split
    if split:
        check_blocks(result, pieces)
        assert all(len(choices(plan, pieces)) == 3 for plan in result.plans)
    else:
        check_parcels(result, pieces)


@pytest.mark.parametrize(("tenths", "split"), [(400, True), (749, True), (750, False)])
def test_without_farm_ha_the_pieces_sum_decides(tenths: int, split: bool) -> None:
    """farm_ha=None: one field of 40.0 or 74.9 ha splits to meet diversification; 75.0 does not."""
    pieces, scores = farm(one_field(tenths), 3, 2)
    result = solve_farm(pieces, scores, LEGUMES, "diversification")
    assert result.plans and result.eco_dropped is not split
    (check_blocks if split else check_parcels)(result, pieces)


@pytest.mark.parametrize("split_finds", ["nothing", "less"])
def test_split_mode_falls_back_to_the_floor(
    monkeypatch: pytest.MonkeyPatch, split_finds: str
) -> None:
    """§10.11: the split solve (stubbed) finds no plan in time, or scores below the floor; parcel
    mode's plans come back, flagged and not proven optimal."""
    pieces, scores = farm(DEMO, 3, 5)
    parcel = solve_farm(pieces, scores, LEGUMES, top=1, max_time_s=SLOW, farm_ha=75)
    real = optimizer._rank

    def stub(*args: Any) -> tuple[list[Plan], str, list[float]]:
        plans, status, t = real(*args)
        if not args[9]:  # the floor's parcel solve
            return plans, status, t
        if split_finds == "nothing":
            return [], "UNKNOWN", t
        return [replace(p, objective=parcel.plans[0].objective - 1) for p in plans], status, t

    monkeypatch.setattr(optimizer, "_rank", stub)
    result = solve_farm(pieces, scores, LEGUMES, top=1, max_time_s=SLOW)
    assert result.floor and result.status == "OPTIMAL" and not result.eco_dropped
    assert [p.objective for p in result.plans] == [p.objective for p in parcel.plans]
    assert parcel.plans[0].proven_optimal and not result.plans[0].proven_optimal
    check_parcels(result, pieces)


def test_too_many_pieces_is_refused() -> None:
    pieces: Pieces = [(f"P{i}", "F", 10) for i in range(MAX_PIECES + 1)]
    with pytest.raises(ValueError):
        solve_farm(pieces, {}, LEGUMES)


def test_default_profile_enforces_no_share_rule() -> None:
    """(a) No eco practice: a farm whose best plan puts over 70 % in one crop keeps it."""
    pieces, scores = farm(FOUR_FIELDS, 3, 2, MAIZE_FIRST, weather=0)
    result = solve_farm(pieces, scores, LEGUMES)
    assert result.eco_practice is None and not result.eco_dropped
    best = result.plans[0]
    assert max(max(y.values()) for y in shares(best)) > 70
    rows = rule_checks(best.allocation, LEGUMES, result.eco_practice)
    assert len(rows) == len(RULES_2026)
    assert not any(row.applies for row in rows)
    gaec = [row for row in rows if row.source.startswith("GAEC 7") and row.id == "max_crop_share"]
    assert gaec[0].value_pct > 75 and not gaec[0].passed  # reported, never enforced


def test_diversification_caps_shares_and_forces_no_legume() -> None:
    """(b) 70 % / 90 % every year, no legume forced."""
    pieces, scores = farm(FOUR_FIELDS, 3, 2, MAIZE_FIRST, weather=0)
    result = solve_farm(pieces, scores, LEGUMES, "diversification")
    assert result.eco_practice == "diversification" and not result.eco_dropped
    check_parcels(result, pieces)
    for plan in result.plans:
        for year in shares(plan):
            top = sorted(year.values())
            assert top[-1] <= 70 and sum(top[-2:]) <= 90
        assert min(sum(v for c, v in y.items() if c in LEGUMES) for y in shares(plan)) < 2
    rows = rule_checks(result.plans[0].allocation, LEGUMES, result.eco_practice)
    assert all(row.passed for row in rows if row.applies)


def test_legume_share_holds_and_caps_no_crop() -> None:
    """(c) Legumes >= 2 % every year, main crop not capped."""
    pieces, scores = farm(FOUR_FIELDS, 3, 2, MAIZE_FIRST, weather=0)
    result = solve_farm(pieces, scores, LEGUMES, "legume_share", top=1, max_time_s=SLOW)
    assert result.eco_practice == "legume_share" and not result.eco_dropped
    best = result.plans[0]
    for year in shares(best):
        assert sum(v for c, v in year.items() if c in LEGUMES) >= 2
    assert max(max(y.values()) for y in shares(best)) > 70


def test_the_two_practices_are_never_both_enforced() -> None:
    """(d) `applies` marks only the rows of the practice enforced; one practice per call."""
    pieces, scores = farm(FOUR_FIELDS, 3, 2, MAIZE_FIRST, weather=0)
    for practice in ("diversification", "legume_share"):
        result = solve_farm(pieces, scores, LEGUMES, practice, top=1)
        rows = rule_checks(result.plans[0].allocation, LEGUMES, result.eco_practice)
        assert [row.applies for row in rows] == [rule.practice == practice for rule in RULES_2026]
    with pytest.raises(ValueError):
        solve_farm(pieces, scores, LEGUMES, "both")


def test_infeasible_practice_is_dropped_once_and_flagged() -> None:
    """(e) Only maize>wheat>maize on offer: neither practice can hold."""
    pieces, scores = farm(FOUR_FIELDS, 3, 2, MAIZE_FIRST, weather=0)
    only = {k: v for k, v in scores.items() if k[1] == "maize>wheat>maize"}
    for practice in ("diversification", "legume_share"):
        result = solve_farm(pieces, only, LEGUMES, practice)
        assert result.eco_dropped and result.eco_practice is None
        assert result.plans and result.plans[0].status == "OPTIMAL"
        rows = rule_checks(result.plans[0].allocation, LEGUMES, result.eco_practice)
        assert not any(row.applies for row in rows)


def test_practice_without_a_plan_in_time_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    """A2: the solve with the practice ends UNKNOWN with no plan (stubbed); one retry without it."""
    stub_out_of_time(monkeypatch)
    pieces, scores = farm(FOUR_FIELDS, 3, 2)
    result = solve_farm(pieces, scores, LEGUMES, "diversification")
    assert result.eco_dropped and result.eco_practice is None and result.plans
    assert result.times_s[0] == 3.0  # the stubbed solve was counted


def test_infeasible_farm_returns_no_plan() -> None:
    # The two pieces of field S share no candidate rotation.
    pieces: Pieces = [("S0", "S", 40), ("S1", "S", 40)]
    scores: Scores = {("S0", "maize>wheat>maize"): [500], ("S1", "wheat>maize>wheat"): [500]}
    for practice in (None, "diversification"):
        result = solve_farm(pieces, scores, LEGUMES, practice)
        assert result.plans == [] and result.status == "INFEASIBLE"


def test_rule_rows_are_unverified_and_gaec7_never_applies() -> None:
    for rule in RULES_2026:
        assert rule.verified == bool(rule.url and rule.page)
        assert not rule.verified  # nothing was read in the official PDFs yet
        if rule.source.startswith("GAEC 7"):
            assert rule.practice is None


def test_proven_optimal_only_for_unpruned_optimal_first_solve() -> None:
    assert is_proven_optimal(cp_model.OPTIMAL, pruned=False, first_solve=True)
    assert not is_proven_optimal(cp_model.FEASIBLE, pruned=False, first_solve=True)
    assert not is_proven_optimal(cp_model.OPTIMAL, pruned=True, first_solve=True)
    assert not is_proven_optimal(cp_model.OPTIMAL, pruned=False, first_solve=False)
    pieces, scores = farm(FOUR_FIELDS, 3, 2, MAIZE_FIRST, weather=0)
    full = solve_farm(pieces, scores, LEGUMES, max_time_s=SLOW)
    assert not full.pruned and full.plans[0].status == "OPTIMAL" and full.plans[0].proven_optimal
    assert not any(p.proven_optimal for p in full.plans[1:])
    pruned = solve_farm(pieces, scores, LEGUMES, prune_above=0)
    assert pruned.pruned and pruned.plans and not any(p.proven_optimal for p in pruned.plans)


def test_pruned_only_when_a_pair_is_removed() -> None:
    """A3: above the threshold, but a field has no more than MAX_CANDIDATES rotations."""
    pieces, scores = farm(FOUR_FIELDS, 3, 2, MAIZE_FIRST, weather=0)
    few = set(candidates(CROPS, 3, MIN_RETURN)[::3])  # 24 rotations
    some = {k: v for k, v in scores.items() if k[1] in few}
    result = solve_farm(pieces, some, LEGUMES, prune_above=0, max_time_s=SLOW)
    assert not result.pruned and result.plans[0].proven_optimal


def test_one_field_farm_of_80_ha_drops_either_practice(monkeypatch: pytest.MonkeyPatch) -> None:
    """§10.8: one 80 ha parcel in 16 pieces, scores drawn per piece and rotation, pruned: 100 %
    one crop each year, so neither practice can hold; the rule rows show it. The field keeps one
    rotation whether the solve with the practice ends INFEASIBLE or (stubbed) UNKNOWN."""
    rng = random.Random(1)
    pieces: Pieces = [(f"F{i}", "F", 50) for i in range(16)]
    rids = candidates(CROPS, 5, MIN_RETURN)
    scores: Scores = {(p, r): [rng.randint(300, 700)] * 3 for p, _, _ in pieces for r in rids}
    for stub in (False, True):
        if stub:
            stub_out_of_time(monkeypatch)
        for practice in ("diversification", "legume_share"):
            result = solve_farm(pieces, scores, LEGUMES, practice, top=1)
            assert result.pruned and result.eco_dropped and result.eco_practice is None
            check_parcels(result, pieces)
            rows = rule_checks(result.plans[0].allocation, LEGUMES, None)
            assert [r.value_pct for r in rows if r.id == "max_crop_share"] == [100.0, 100.0]


def test_ranks_best_first_and_differ_in_two_choices() -> None:
    pieces, scores = farm(DEMO, 3, 5)
    result = solve_farm(pieces, scores, LEGUMES, num_workers=1, max_time_s=SLOW)
    plans = result.plans
    assert len(plans) == 3 and all(p.status == "OPTIMAL" for p in plans)
    assert [p.objective for p in plans] == sorted((p.objective for p in plans), reverse=True)
    for i, better in enumerate(plans):
        on = choices(better, pieces)
        for worse in plans[i + 1 :]:
            assert len(on - choices(worse, pieces)) >= min(2, len(on))


@pytest.mark.parametrize(
    ("fields", "years", "farm_ha"),
    [(AIUD, 3, None), (AIUD, 4, None), (AIUD, 5, None), (ONE_74_99, 4, 74.99)],
    ids=["aiud-3y", "aiud-4y", "aiud-5y", "one-74.99ha-4y"],
)
def test_split_mode_plans_on_the_services_scores(
    fields: dict[str, list[tuple[float, float]]], years: int, farm_ha: float | None
) -> None:
    """Regression: on CP-SAT's default presolve the unpruned 4-year models stopped after presolve
    with no plan (UNKNOWN) within the 3 s limit. The 74.99 ha field's pieces sum to 75.0 ha, so
    its unrounded area is passed as the service does."""
    pieces, scores = service_farm(fields, years)
    ha = farm_ha or sum(a for *_, a in pieces) / 10
    result = solve_farm(pieces, scores, CROP_LEGUMES, farm_ha=ha)
    print(f"\n{ha:.2f} ha, {years} years: {result.times_s} {[p.status for p in result.plans]}")
    assert splits(ha) and len(result.plans) == 3
    check_blocks(result, pieces)


def test_one_log_line_per_solve(caplog: pytest.LogCaptureFixture) -> None:
    pieces, scores = farm(DEMO, 3, 5)
    with caplog.at_level(logging.INFO, logger="api.planner.optimizer"):
        result = solve_farm(pieces, scores, LEGUMES, top=2, max_time_s=SLOW)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("farm solve")]
    print("\n" + "\n".join(lines))
    assert len(lines) == len(result.times_s) == 4  # the floor's two parcel solves, then split
    assert ["mode=parcel" in line for line in lines] == [True, True, False, False]
    assert all("mode=split" in line for line in lines[2:])
    for keys in ("status=OPTIMAL", "gap=0.0000%", "candidates=", "pieces=7"):
        assert all(keys in line for line in lines)


def test_an_invalid_model_raises_and_is_not_retried(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    calls: list[int] = []

    def invalid(*_: Any) -> cp_model.CpSolverStatus:
        calls.append(1)
        return cp_model.MODEL_INVALID

    monkeypatch.setattr(cp_model.CpSolver, "solve", invalid)
    pieces, scores = farm(DEMO, 3, 2)
    with pytest.raises(RuntimeError, match="rejected the farm model"):
        solve_farm(pieces, scores, LEGUMES, "diversification")
    assert len(calls) == 1  # the floor's first solve: neither "no plan" nor any retry
    assert "CP-SAT rejected the model" in caplog.text


def test_demo_farm_four_years_top3_within_15s() -> None:
    pieces, scores = farm(DEMO, 4, SCENARIOS[4])
    start = time.perf_counter()
    result = solve_farm(pieces, scores, LEGUMES)
    elapsed = time.perf_counter() - start
    print(f"\ndemo farm, 4 years: {elapsed:.2f} s, {[p.status for p in result.plans]}")
    assert len(result.plans) == 3 and elapsed < 15


def test_report_solve_times() -> None:
    """Figures for the report: demo farm 3 and 5 years; 10 fields, 150 pieces, 5 years."""
    big = {f"F{j}": [53] * 15 for j in range(10)}
    for name, fields, years in (("demo", DEMO, 3), ("demo", DEMO, 5), ("150 pieces", big, 5)):
        pieces, scores = farm(fields, years, SCENARIOS[years])
        start = time.perf_counter()
        result = solve_farm(pieces, scores, LEGUMES)
        elapsed = time.perf_counter() - start
        split = splits(sum(a for _, _, a in pieces) / 10)
        print(
            f"\n{name}, {years} years, {len(scores)} piece pairs, split={split}, "
            f"pruned={result.pruned}: "
            f"{elapsed:.2f} s, {[p.status for p in result.plans]}"
        )
        assert result.plans
