"""How many CPUs the planner may use: the container's quota, not the host's core count.

Inside a container `os.cpu_count()` is the host's cores (Azure: many), so libraries sized from it
(CP-SAT's default workers, a process pool) oversubscribe the vCPUs the app was given. The quota is
in cgroup v2 `cpu.max` ("200000 100000" = 2 CPUs). `PLANNER_CPUS` overrides it.
"""

from __future__ import annotations

import math
import os
from functools import cache
from pathlib import Path

CPU_MAX = Path("/sys/fs/cgroup/cpu.max")


@cache
def budget() -> int:
    if v := os.environ.get("PLANNER_CPUS"):
        return max(1, int(v))
    n = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count() or 1
    try:
        quota, period = CPU_MAX.read_text().split()
        if quota != "max":
            n = min(n, max(1, math.floor(int(quota) / int(period))))
    except (OSError, ValueError):
        pass
    return max(1, n)


# CP-SAT's portfolio wins on variety more than on cores: at 2 CPUs (Docker, 45 ha demo, 15 Nov
# 2026) 8 workers proved 2 of 3 split solves optimal in 7.3 s, 2 or 4 workers none in 9.2 s.
MIN_SOLVER_WORKERS = 8


@cache
def solver_workers() -> int:
    """CP-SAT workers: `PLANNER_SOLVER_WORKERS`, else the CPU budget with a floor of
    MIN_SOLVER_WORKERS."""
    if v := os.environ.get("PLANNER_SOLVER_WORKERS"):
        return max(1, int(v))
    return max(MIN_SOLVER_WORKERS, budget())
