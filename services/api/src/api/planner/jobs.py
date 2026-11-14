"""Farm plans as background jobs, so a slow plan never holds up the API.

The trained world model makes a farm plan CPU-heavy (about 25 s for 45 ha on one vCPU the first
time). Run inside a request thread, it would hold the API's only CPU and the GIL, and every other
request (field analysis, parcels, the assistant) would crawl. So plans run in one separate worker
process at a lower CPU priority, one at a time; its model caches stay warm between jobs.

    submit(request) -> OptimizerJob      # queued at once
    get(job_id) -> OptimizerJob | None   # None: unknown or expired

Jobs live in this process's memory for KEEP_S seconds: right for the single API replica
(maxReplicas 1). More replicas would need a shared store.
"""

from __future__ import annotations

import contextlib
import multiprocessing as mp
import os
import threading
import time
import uuid
from concurrent.futures import Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass
from typing import Any

from api.contracts import OptimizerJob, OptimizerJobStatus, OptimizerRequest, OptimizerResponse

KEEP_S = 15 * 60
WORKER_NICE = 10  # lower priority than the API process

_lock = threading.Lock()
_pool: ProcessPoolExecutor | None = None
_jobs: dict[str, _Job] = {}


@dataclass
class _Job:
    future: Future[dict[str, Any]]
    submitted: float


def _init_worker() -> None:
    with contextlib.suppress(OSError):  # not allowed everywhere; then same priority
        os.nice(WORKER_NICE)


def _run(payload: dict[str, Any]) -> dict[str, Any]:
    """In the worker: the plan as JSON, or why the fields cannot be planned."""
    from api.planner.service import PlanRejected, plan_farm

    try:
        plan = plan_farm(OptimizerRequest.model_validate(payload))
        return {"result": plan.model_dump(mode="json")}
    except PlanRejected as e:
        return {"rejected": str(e)}


def _executor() -> ProcessPoolExecutor:
    global _pool
    if _pool is None:
        # spawn: a clean interpreter, no threads or locks copied from the API process
        _pool = ProcessPoolExecutor(1, mp_context=mp.get_context("spawn"), initializer=_init_worker)
    return _pool


def _prune(now: float) -> None:
    for k in [k for k, j in _jobs.items() if j.future.done() and now - j.submitted > KEEP_S]:
        del _jobs[k]


def submit(request: OptimizerRequest) -> OptimizerJob:
    global _pool
    payload = request.model_dump(mode="json")
    with _lock:
        now = time.monotonic()
        _prune(now)
        try:
            future = _executor().submit(_run, payload)
        except BrokenProcessPool:  # the worker died (e.g. out of memory): start a new one
            _pool = None
            future = _executor().submit(_run, payload)
        job_id = uuid.uuid4().hex
        _jobs[job_id] = _Job(future, now)
    return _view(job_id, _jobs[job_id])


def get(job_id: str) -> OptimizerJob | None:
    with _lock:
        job = _jobs.get(job_id)
    return None if job is None else _view(job_id, job)


def _view(job_id: str, job: _Job) -> OptimizerJob:
    elapsed = round(time.monotonic() - job.submitted, 1)
    f = job.future
    base = {"id": job_id, "elapsed_s": elapsed}
    if not f.done():
        status = OptimizerJobStatus.RUNNING if f.running() else OptimizerJobStatus.QUEUED
        return OptimizerJob(status=status, **base)
    try:
        out = f.result()
    except Exception as e:  # the worker crashed or the plan raised
        return OptimizerJob(status=OptimizerJobStatus.FAILED, detail=type(e).__name__, **base)
    if "rejected" in out:
        return OptimizerJob(status=OptimizerJobStatus.REJECTED, detail=out["rejected"], **base)
    return OptimizerJob(
        status=OptimizerJobStatus.DONE,
        result=OptimizerResponse.model_validate(out["result"]),
        **base,
    )
