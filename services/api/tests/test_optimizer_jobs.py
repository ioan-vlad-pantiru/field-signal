import time
from typing import Any

from fastapi.testclient import TestClient

from api.contracts import OptimizerJob, OptimizerJobStatus, OptimizerResponse
from api.main import app

client = TestClient(app)
FIELD = [(46.3000, 23.7460), (46.3003, 23.7538), (46.2953, 23.7546), (46.2948, 23.7457)]
OUTSIDE = [(40.0, 10.0), (40.0, 10.01), (39.99, 10.01), (39.99, 10.0)]


def _body(boundary: list[tuple[float, float]]) -> dict[str, Any]:
    return {
        "fields": [
            {
                "id": "f1",
                "boundary": [{"lat": a, "lon": b} for a, b in boundary],
                "current_rotation": ["maize", "wheat", "maize"],
            }
        ],
        "priorities": {"yield": 1, "water": 1, "soil": 1, "risk": 1},
    }


def _wait(job_id: str, timeout_s: float = 120) -> OptimizerJob:
    end = time.monotonic() + timeout_s
    while time.monotonic() < end:
        r = client.get(f"/v1/farm/optimize/jobs/{job_id}")
        assert r.status_code == 200, r.text
        job = OptimizerJob.model_validate(r.json())
        if job.status not in (OptimizerJobStatus.QUEUED, OptimizerJobStatus.RUNNING):
            return job
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def test_job_returns_at_once_and_matches_the_synchronous_plan() -> None:
    t = time.monotonic()
    r = client.post("/v1/farm/optimize/jobs", json=_body(FIELD))
    assert r.status_code == 202 and time.monotonic() - t < 2
    job = OptimizerJob.model_validate(r.json())
    assert job.status in (OptimizerJobStatus.QUEUED, OptimizerJobStatus.RUNNING)
    done = _wait(job.id)
    assert done.status == OptimizerJobStatus.DONE and done.result is not None
    sync = OptimizerResponse.model_validate(
        client.post("/v1/farm/optimize", json=_body(FIELD)).json()
    )
    assert done.result.model_version == sync.model_version
    assert [p.score.total for p in done.result.plans] == [p.score.total for p in sync.plans]


def test_rejected_job_and_unknown_id() -> None:
    job = OptimizerJob.model_validate(
        client.post("/v1/farm/optimize/jobs", json=_body(OUTSIDE)).json()
    )
    done = _wait(job.id)
    assert done.status == OptimizerJobStatus.REJECTED and done.detail
    assert client.get("/v1/farm/optimize/jobs/nope").status_code == 404
