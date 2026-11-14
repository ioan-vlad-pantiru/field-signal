"""Candidate crop rotations for the farm planner (plan §3.7). Plain data; no other planner module.

A rotation ID joins the plan-year crops with ">", e.g. "maize>wheat>pea". The same crop may come
back after `d` years only if `d >= max(2, min_return[crop])`, so no crop two years running, even
maize. The rule holds inside the plan and against the field's last `HISTORY_YEARS` harvests (most
recent last, at distance 1 from plan year 1). It is NOT applied across the wrap-around: the plan is
not assumed to repeat (the caller states that in its caveats).

Signatures (T5 builds on these):

    rotation_id(seq: Sequence[str]) -> str
    crops_of(rid: str) -> list[str]
    is_valid(seq: Sequence[str], min_return: Mapping[str, int],
             history: Sequence[str] = ()) -> bool
    candidates(crops: Sequence[str], plan_years: int, min_return: Mapping[str, int],
               history: Sequence[str] = ()) -> list[str]           # rotation IDs
    cycle(current_rotation: Sequence[str], plan_years: int) -> list[str]
    history_from_cycle(current_rotation: Sequence[str]) -> list[str]

`min_return` needs an entry for every crop that can be proposed; a history crop outside it (e.g.
soybean) never matches a proposed crop and is ignored.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from itertools import product

HISTORY_YEARS = 4  # sunflower's interval of 5 needs the last four harvests


def rotation_id(seq: Sequence[str]) -> str:
    return ">".join(seq)


def crops_of(rid: str) -> list[str]:
    return rid.split(">")


def is_valid(
    seq: Sequence[str], min_return: Mapping[str, int], history: Sequence[str] = ()
) -> bool:
    """True when every plan-year crop waits its return interval after any earlier entry."""
    past = list(history)[-HISTORY_YEARS:]
    line = [*past, *seq]
    return all(
        line[i] != line[j] or j - i >= max(2, min_return[line[j]])
        for j in range(len(past), len(line))
        for i in range(j)
    )


def candidates(
    crops: Sequence[str],
    plan_years: int,
    min_return: Mapping[str, int],
    history: Sequence[str] = (),
) -> list[str]:
    """Every valid sequence of `crops` of length `plan_years`, as rotation IDs (72, 234 and 735
    for 3, 4 and 5 years with the five planner crops and no history)."""
    return [
        rotation_id(s)
        for s in product(crops, repeat=plan_years)
        if is_valid(s, min_return, history)
    ]


def cycle(current_rotation: Sequence[str], plan_years: int) -> list[str]:
    """The farmer's reference cycle extended from entry 0 over the plan years (the baseline)."""
    return [current_rotation[i % len(current_rotation)] for i in range(plan_years)]


def history_from_cycle(current_rotation: Sequence[str]) -> list[str]:
    """Assumed history when none was observed: the cycle read backwards, its last entry taken as
    the most recent harvest (returned most recent last)."""
    n = len(current_rotation)
    return [current_rotation[i % n] for i in range(-HISTORY_YEARS, 0)]
