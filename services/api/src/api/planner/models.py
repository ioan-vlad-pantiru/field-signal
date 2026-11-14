"""Which world model the planner reads: the trained LSTM (`world_model`) or the mock.

`PLANNER_WORLD_MODEL` = `auto` (default: the LSTM when its weights, weather and soil grid are all
present, else the mock), `lstm` (fail loudly when an input is missing) or `mock`.
"""

from __future__ import annotations

import os
from types import ModuleType

from api.planner import mock_world_model, world_model


def active() -> ModuleType:
    choice = os.environ.get("PLANNER_WORLD_MODEL", "auto")
    if choice == "mock":
        return mock_world_model
    if choice == "lstm" or world_model.available():
        if not world_model.available():
            raise RuntimeError("PLANNER_WORLD_MODEL=lstm but the model's inputs are missing")
        return world_model
    return mock_world_model


def is_mock() -> bool:
    return active() is mock_world_model
