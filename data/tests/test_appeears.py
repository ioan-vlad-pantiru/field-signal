"""AppEEARS batching with a fake API: no network, no credentials."""

from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from farm_data import appeears

MODIS, SMAP = "field-signal-modis-ndvi", "field-signal-smap-rootzone"


def test_batch_names() -> None:
    assert appeears._batch(MODIS) == (MODIS, 1)
    assert appeears._batch(SMAP + "-2") == (SMAP, 2)
    with pytest.raises(KeyError):
        appeears._batch("fieldshift_alba_x")


class FakeAPI:
    def __init__(self, tasks: dict[str, tuple[str, list[str]]]):
        self.tasks = tasks  # task id -> (status, point ids)

    def task(self, tid: str) -> dict[str, Any]:
        st, ids = self.tasks[tid]
        return {"status": st, "params": {"coordinates": [{"id": i} for i in ids]}}


def test_missing_points_ignores_failed_tasks(monkeypatch: pytest.MonkeyPatch) -> None:
    pts = pd.DataFrame({"id": ["a#0", "b#0", "c#0"]})
    monkeypatch.setattr(appeears, "_points", lambda: pts)
    api = FakeAPI({"m1": ("done", ["a#0"]), "m2": ("pending", ["b#0"]), "s1": ("error", ["a#0"])})
    tasks = {MODIS: "m1", MODIS + "-2": "m2", SMAP: "s1"}
    miss = appeears.missing_points(api, tasks)  # type: ignore[arg-type]
    assert list(miss[MODIS]["id"]) == ["c#0"]
    assert list(miss[SMAP]["id"]) == ["a#0", "b#0", "c#0"]  # errored task covers nothing


def test_load_keeps_batch_1_on_overlap(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(appeears, "OUT", tmp_path)
    d = pd.Timestamp("2024-06-01")
    row = {"zone_id": "1213", "point": 0, "date": d}
    pd.DataFrame([{**row, "sm_rootzone": 0.30}]).to_parquet(tmp_path / "smap.parquet")
    pd.DataFrame(
        [{**row, "sm_rootzone": 0.99}, {**row, "point": 1, "sm_rootzone": 0.2}]
    ).to_parquet(tmp_path / "smap-2.parquet")
    pd.DataFrame([{**row, "sm_rootzone": 0.5}]).to_parquet(tmp_path / "smap-old.parquet")
    df = appeears.load("smap")
    assert df is not None and len(df) == 2
    assert df.loc[df.point == 0, "sm_rootzone"].item() == 0.30
    assert appeears.load("modis") is None
