"""Trained world model for the farm planner: the monthly delta LSTM in `model/` (run monthly_delta).

The model (Răzvan, `model/code/model.py`, trained on 2016-2024 HLS NDVI and SMAP root-zone soil
moisture at about 500 000 cropland points in Romania and Bulgaria) predicts next month's NDVI and
root-zone soil moisture from this month's state, the month's NASA POWER weather, the crop, the two
previous crops and the soil and terrain of the point. This module runs it in numpy with the
exported weights (`model/code/export_npz.py`), the same arithmetic as `model/code/infer.py`'s
delta rollout; `tests/test_world_model.py` checks the two agree on fixed inputs.

How a season is simulated (one batch per grid point, crop and last two crops, every season):
- 27 months from October two years before the harvest year to December of the harvest year;
- months 0-11 (the previous crop year, last year's crop) only warm up the LSTM: no NDVI or soil
  moisture is observed for a planned field, so the state starts at the crop's training mean;
- months 12-26 are rolled out autoregressively, each prediction fed back as the next state;
  January-December of the harvest year are the rows the planner reads;
- October-December after harvest belong to the next crop year, whose crop the per-year cache does
  not know: it is the model's `missing` class.

Ensemble: every exported run in `data/world_model/` is one member. With a single run, the members
are Monte Carlo dropout passes (p = the training dropout), a cheaper stand-in for the seed
ensemble; `MEMBERS` of them, seeded from the point and crops so results are repeatable.

From monthly states to the planner's `RotationOutcome` (the summaries the planner reads):
- `yield_rel` is an NDVI proxy, not a yield: (peak NDVI in season - the crop's lowest training
  mean NDVI) / (the crop's training peak - that lowest), so 1 = the crop's average training year;
- `ndvi_offseason` = mean NDVI of the months outside the crop's season (cover, volunteers);
- `rootzone_sm_critical` = mean predicted root-zone soil moisture (m3/m3) over flowering;
- `et_season_mm` = sum over the season of Kc(NDVI) x FAO-56 ET0 of the model's weather.

Inputs, built by `farm_data.world_weather` and `farm_data.static_grid` exactly as `model/code/
build.py` built them for training: monthly POWER weather per cell (10 channels, FAO-56 ET0),
SoilGrids 0-30 cm clay, sand, SOC, pH and Copernicus DEM elevation and slope per grid point.

Signatures (same as `mock_world_model`, so scoring and the service use either):

    available() -> bool                  # weights, weather and soil grid all present
    scenarios(plan_years) -> list[int]
    outcomes(grid_point_id, last_two, rotation, start) -> list[RotationOutcome]
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
import os
from collections.abc import Sequence
from functools import cache, lru_cache
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from api.contracts import Crop, Range, RotationOutcome
from api.planner import grid
from api.planner import water_balance as wb
from api.planner.crops import CROPS, crop_months

Array = NDArray[np.float32]

DATA = Path(__file__).with_name("data")
MODEL_DIR = DATA / "world_model"
WEATHER = DATA / "world_weather_monthly.csv.gz"
# The soil and terrain grid is large: CI downloads it from a release next to the API image.
STATIC = Path(os.environ.get("PLANNER_STATIC_GRID", DATA / "static_grid.npz"))

CLASSES = ("wheat", "barley", "maize", "sunflower", "soybeans", "dry_pulses", "rapeseed",
           "other", "non_crop", "missing")  # fmt: skip
MISSING = CLASSES.index("missing")
# Planner and history crop names -> the model's classes (HRL crop types).
CLASS_OF = {
    "wheat": 0, "barley": 1, "maize": 2, "sunflower": 3, "soybean": 4, "pea": 5,
    "cover_mustard": 7, "cover_phacelia": 7, "cover_vetch": 7,
}  # fmt: skip
WEATHER_CHANNELS = ("t2m_max", "t2m_min", "rh2m", "ws2m", "solar", "precip", "et0",
                    "hot_days", "frost_days", "dry_run_max")  # fmt: skip
STATIC_CHANNELS = ("clay", "sand", "soc", "ph", "elevation", "slope")
STATIC_SCALE = {"clay": 10, "sand": 10, "soc": 10, "ph": 100, "elevation": 1, "slope": 100}
MEMBERS = 5  # Monte Carlo dropout passes when only one run is exported
WARMUP, SPAN = 12, 27  # months of warm-up, months simulated (Oct two years back .. Dec)
JAN = 15  # index of January of the harvest year in the simulated span


def _version() -> str:
    runs = sorted(p.stem for p in MODEL_DIR.glob("*.npz"))
    return "lstm-" + "+".join(runs) if runs else "lstm-none"


MODEL_VERSION = _version()


def available() -> bool:
    return bool(list(MODEL_DIR.glob("*.npz"))) and WEATHER.exists() and STATIC.exists()


# ------------------------------------------------------------------ inputs


@cache
def _norm() -> dict[str, Array]:
    n = json.loads((MODEL_DIR / "norm_stats.json").read_text())
    assert tuple(n["ndvi"]["classes"]) == CLASSES
    assert tuple(n["weather"]["channels"]) == WEATHER_CHANNELS
    assert tuple(n["static"]["channels"]) == STATIC_CHANNELS
    f = np.float32
    return {
        "nd_mean": np.asarray(n["ndvi"]["mean"], f),  # [class, calendar month]
        "nd_std": np.asarray(n["ndvi"]["std"], f),
        "sm_mean": np.asarray(n["sm"]["mean"], f),  # [calendar month]
        "sm_std": np.asarray(n["sm"]["std"], f),
        "w_mean": np.asarray(n["weather"]["mean"], f),
        "w_std": np.asarray(n["weather"]["std"], f),
        "s_mean": np.asarray(n["static"]["mean"], f),
        "s_std": np.asarray(n["static"]["std"], f),
    }


@cache
def _nets() -> list[dict[str, Array]]:
    nets = []
    for p in sorted(MODEL_DIR.glob("*.npz")):
        z = np.load(p)
        cfg = json.loads(str(z["meta"]))["config"]
        w_ih = z["lstm.weight_ih_l0"]
        nets.append(
            {
                "emb": z["emb.weight"],
                "w_ih": w_ih.T.copy(),  # [46, 4H]
                "w_hh": z["lstm.weight_hh_l0"].T.copy(),  # [H, 4H]
                "b": z["lstm.bias_ih_l0"] + z["lstm.bias_hh_l0"],
                "head_w": z["head.weight"].T.copy(),  # [H, 2]
                "head_b": z["head.bias"],
                "dropout": float(cfg["dropout"]),
            }
        )
    return nets


@cache
def _weather() -> tuple[dict[str, Array], int]:
    """cell_id -> [month since the first month, channel] (raw units); first month as y*12+m-1."""
    rows: dict[str, list[tuple[int, list[float]]]] = {}
    with gzip.open(WEATHER, "rt", newline="") as f:
        for r in csv.DictReader(f):
            k = int(r["year"]) * 12 + int(r["month"]) - 1
            rows.setdefault(r["cell_id"], []).append(
                (k, [float(r[c]) for c in WEATHER_CHANNELS])
            )
    first = min(k for v in rows.values() for k, _ in v)
    out = {}
    for cell, v in rows.items():
        v.sort()
        assert [k for k, _ in v] == list(range(first, first + len(v))), f"gap in {cell}"
        out[cell] = np.asarray([x for _, x in v], np.float32)
    return out, first


@cache
def seasons() -> range:
    """Harvest years with weather from November two years before through December."""
    table, first = _weather()
    n = len(next(iter(table.values())))
    y0 = (first + 1) // 12 + 2  # November of y0 - 2 must be in the table
    y1 = (first + n - 1) // 12  # December of y1 must be in the table
    return range(y0, y1 + 1)


def scenarios(plan_years: int) -> list[int]:
    s = seasons()
    return list(range(s.start, s.stop - plan_years + 1))


@cache
def _static_grid() -> dict[str, NDArray[np.int16]]:
    z = np.load(STATIC)
    return {c: z[c] for c in STATIC_CHANNELS}


def _static(point: str) -> Array:
    """Standardised static features of a grid point; a channel without data is the training
    mean (0 after standardising)."""
    lat, lon = map(float, point.split("_"))
    row, col = grid._cell(lat, lon)
    n = _norm()
    g = _static_grid()
    out = np.zeros(len(STATIC_CHANNELS), np.float32)
    for i, c in enumerate(STATIC_CHANNELS):
        v = int(g[c][row, col])
        if v != -32768:
            out[i] = (v / STATIC_SCALE[c] - n["s_mean"][i]) / n["s_std"][i]
    return out


def _power_cell(point: str) -> str:
    from api.planner import weather  # the planner's POWER cell rule

    return weather.cell_id(*map(float, point.split("_")))


@cache
def _season_weather(cell: str) -> tuple[Array, Array]:
    """([season, SPAN, channel] standardised, [season, 12] ET0 mm Jan-Dec) for every season."""
    table, first = _weather()
    w = table[cell]
    n = _norm()
    starts = [(s - 2) * 12 + 9 - first for s in seasons()]  # October two years back
    raw = np.stack([w[a : a + SPAN] for a in starts])
    et0 = raw[:, JAN:, WEATHER_CHANNELS.index("et0")]
    return (raw - n["w_mean"]) / n["w_std"], et0


def _cls(crop: str) -> int:
    return CLASS_OF.get(crop, MISSING)


# ------------------------------------------------------------------ the LSTM


def _sigmoid(x: Array) -> Array:
    return 0.5 * (1.0 + np.tanh(0.5 * x))


def _rollout(
    net: dict[str, Array],
    w: Array,
    crops: NDArray[np.int64],
    static: Array,
    rng: np.random.Generator | None,
) -> Array:
    """Standardised states [B, SPAN - WARMUP, 2] for months WARMUP..SPAN-1.

    w [B, SPAN, 10] standardised weather by calendar month of the span; crops [3 crop years, 3]
    (crop, previous, two back) class ids; static [6]. Step t's input carries the weather, time
    and crops of month t + 1 (`infer._embed`); no state is observed, so state and flag are 0
    through the warm-up and the rollout starts from state 0 (`infer._rollout_delta`)."""
    b = w.shape[0]
    hid = net["w_hh"].shape[0]
    months = np.arange(1, SPAN + 1)
    cal = (months % 12 + 9) % 12 + 1  # index 0 is October
    phase = 2 * np.pi * (cal - 1) / 12.0
    ts = np.stack([np.sin(phase), np.cos(phase)], 1).astype(np.float32)
    year = np.minimum(months // 12, len(crops) - 1)
    emb = net["emb"][crops[year]].reshape(len(months), -1)  # [SPAN, 24]
    wi = net["w_ih"]
    # input projection of everything but the state and flag (rows 0-3 of w_ih)
    w_next = np.concatenate([w[:, 1:], w[:, -1:]], 1)  # step t reads month t + 1
    rest = np.concatenate(
        [
            w_next,
            np.broadcast_to(ts, (b, SPAN, 2)),
            np.broadcast_to(emb, (b, SPAN, emb.shape[1])),
            np.broadcast_to(static, (b, SPAN, len(static))),
        ],
        -1,
    )
    pre = rest @ wi[4:] + net["b"]  # [B, SPAN, 4H]
    h = np.zeros((b, hid), np.float32)
    c = np.zeros((b, hid), np.float32)

    def step(x: Array) -> None:
        nonlocal h, c
        g = x + h @ net["w_hh"]
        i, f, gg, o = np.split(g, 4, axis=1)  # torch gate order
        c = _sigmoid(f) * c + _sigmoid(i) * np.tanh(gg)
        h = _sigmoid(o) * np.tanh(c)

    for t in range(WARMUP):  # state 0, flag 0
        step(pre[:, t])
    state = np.zeros((b, 2), np.float32)
    flag = wi[2] + wi[3]  # observed flag = 1 for fed-back predictions
    out = []
    keep = 1.0 - net["dropout"]
    for m in range(WARMUP, SPAN):
        step(pre[:, m - 1] + state @ wi[:2] + flag)
        hd = h if rng is None else h * (rng.random(h.shape) < keep) / keep
        state = state + hd @ net["head_w"] + net["head_b"]
        out.append(state)
    return np.stack(out, 1)


def _destandardise(z: Array, crops: NDArray[np.int64]) -> Array:
    """[B, months WARMUP..SPAN-1, 2] -> physical NDVI and soil moisture."""
    n = _norm()
    m = np.arange(WARMUP, SPAN)
    cal = (m % 12 + 9) % 12  # 0-based calendar month
    cls = crops[np.minimum(m // 12, len(crops) - 1), 0]
    nd = z[..., 0] * n["nd_std"][cls, cal] + n["nd_mean"][cls, cal]
    sm = z[..., 1] * n["sm_std"][cal] + n["sm_mean"][cal]
    return np.stack([nd, sm], -1)


def _seed(*parts: str) -> int:
    return int.from_bytes(hashlib.blake2b("|".join(parts).encode(), digest_size=8).digest())


def simulate(point: str, crop: str, prev2: str, prev1: str) -> Array:
    """[season, member, month Jan-Dec, (ndvi, sm_rootzone)] of the harvest years."""
    crops = np.array(
        [
            [_cls(prev1), _cls(prev2), MISSING],
            [_cls(crop), _cls(prev1), _cls(prev2)],
            [MISSING, _cls(crop), _cls(prev1)],
        ]
    )
    w, _ = _season_weather(_power_cell(point))
    static = _static(point)
    nets = _nets()
    n_s = w.shape[0]
    if len(nets) > 1:
        z = np.stack([_rollout(net, w, crops, static, None) for net in nets], 1)
    else:
        rng = np.random.default_rng(_seed(point, prev2, prev1, crop))
        wm = np.repeat(w, MEMBERS, axis=0)
        z = _rollout(nets[0], wm, crops, static, rng).reshape(n_s, MEMBERS, SPAN - WARMUP, 2)
    phys = _destandardise(z.reshape(-1, SPAN - WARMUP, 2), crops).reshape(z.shape)
    return phys[:, :, JAN - WARMUP :]


# ------------------------------------------------------------------ planner rows


@cache
def _yield_ref(crop: str) -> tuple[float, float]:
    """(lowest, peak) training mean NDVI of the crop's class, peak over its season months."""
    curve = _norm()["nd_mean"][_cls(crop)]
    mask = crop_months(crop)[0]
    return float(curve.min()), float(curve[mask].max())


@lru_cache(maxsize=4096)
def _season_summaries(point: str, crop: str, prev2: str, prev1: str) -> tuple[Array, Array] | None:
    """([season, summary, (P10, P50, P90)], [season, 12] NDVI P50), summaries in RotationOutcome
    order; None for a crop the planner does not score."""
    if crop not in CROPS:
        return None
    s = simulate(point, crop, prev2, prev1)
    _, et0 = _season_weather(_power_cell(point))
    mask, _, f = crop_months(crop)
    ndvi, sm = s[..., 0], s[..., 1]
    lo, peak_ref = _yield_ref(crop)
    peak = ndvi[..., mask].max(-1)
    et = (wb.crop_coefficient(ndvi) * et0[:, None, :])[..., mask].sum(-1)
    x = np.stack(
        [
            (peak - lo) / (peak_ref - lo),
            peak,
            ndvi[..., ~mask].mean(-1),
            sm[..., f].mean(-1),
            et,
        ],
        -1,
    )
    out = (
        np.percentile(x, (10, 50, 90), axis=1).transpose(1, 2, 0),
        np.percentile(ndvi, 50, axis=1),
    )
    for a in out:
        a.setflags(write=False)
    return out


def _years(last_two: Sequence[str], rotation: Sequence[str]) -> list[tuple[str, str, str]]:
    seq = [*("", "", *last_two)[-2:], *rotation]
    return [(seq[i + 2], seq[i], seq[i + 1]) for i in range(len(rotation))]


def outcomes(
    grid_point_id: str, last_two: Sequence[str], rotation: Sequence[str], start: int
) -> list[RotationOutcome]:
    s = seasons()
    if not (s.start <= start and start + len(rotation) <= s.stop):
        raise ValueError(f"weather window {start}+{len(rotation)} years is outside {s}")
    i = start - s.start
    rows = []
    for y, (crop, p2, p1) in enumerate(_years(last_two, rotation)):
        v = _season_summaries(grid_point_id, crop, p2, p1)
        r: list[Range | None] = [None] * 5
        monthly = None
        if v is not None:
            r = [Range(low=a, mid=b, high=c) for a, b, c in v[0][i + y].tolist()]
            monthly = v[1][i + y].tolist()
        rows.append(
            RotationOutcome(
                grid_point_id=grid_point_id,
                rotation=">".join(rotation),
                weather_start_season=start,
                plan_year=y + 1,
                crop=Crop(crop),
                season=start + y,
                yield_rel=r[0],
                ndvi_peak=r[1],
                ndvi_offseason=r[2],
                ndvi_monthly=monthly,
                rootzone_sm_critical=r[3],
                et_season_mm=r[4],
                model_version=MODEL_VERSION,
            )
        )
    return rows
