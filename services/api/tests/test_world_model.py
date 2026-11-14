from pathlib import Path

import numpy as np
import pytest

from api.planner import world_model as wm

FIXTURE = Path(__file__).with_name("fixtures") / "world_model_parity.npz"
AIUD = "46.30125_23.75125"


def test_numpy_rollout_matches_torch_inference():
    """Fixture from model/code/infer.py rollout (torch, delta head, cutoff 11, 15 months) on
    random standardised weather and static inputs; the numpy port must give the same states."""
    f = np.load(FIXTURE)
    net = wm._stack(wm._nets()[:1])  # the fixture is run monthly_delta
    z = wm._rollout(net, f["w"], f["crops"], f["static"], None)[0]
    assert np.allclose(wm._destandardise(z, f["crops"]), f["expected"], atol=1e-5)


def test_class_mapping_covers_planner_crops():
    from api.planner.crops import CROPS

    assert set(CROPS) <= set(wm.CLASS_OF)
    assert wm.CLASSES[wm.CLASS_OF["pea"]] == "dry_pulses"
    assert wm._cls("") == wm.MISSING


@pytest.mark.skipif(not wm.available(), reason="world model inputs not built")
def test_outcomes_are_physical_and_respond_to_the_crop():
    s = wm.scenarios(1)
    rows = [wm.outcomes(AIUD, ("wheat", "pea"), ("maize",), y)[0] for y in s]
    assert all(r.model_version.startswith("lstm-") for r in rows)
    ndvi = np.array([r.ndvi_monthly for r in rows])
    assert ndvi.shape == (len(s), 12) and np.isfinite(ndvi).all()
    assert ndvi.min() > 0 and ndvi.max() < 1
    assert ndvi[:, 6:8].mean() > ndvi[:, 1:3].mean()  # maize greens in July-August
    wheat = np.array(
        [wm.outcomes(AIUD, ("maize", "pea"), ("wheat",), y)[0].ndvi_monthly for y in s]
    )
    assert wheat[:, 3:5].mean() > ndvi[:, 3:5].mean()  # wheat is green in April-May


def test_shared_warm_up_gives_the_same_states():
    """The first SHARED steps read only the previous crops: a run that starts from another
    crop's warm-up state with the same history equals a full run."""
    f = np.load(FIXTURE)
    net = wm._stack(wm._nets())
    full = wm._rollout(net, f["w"], f["crops"], f["static"], None)
    other = f["crops"].copy()
    other[1, 0] = wm.CLASS_OF["wheat"]  # another planned crop, same history (year 0)
    warm = wm._rollout(net, f["w"], other, f["static"], None, stop_shared=True)
    shared = wm._rollout(net, f["w"], f["crops"], f["static"], None, (warm[0], warm[1]))
    assert np.array_equal(full, shared)
