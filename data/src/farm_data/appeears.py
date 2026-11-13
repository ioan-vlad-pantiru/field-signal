"""NASA AppEEARS point extraction (MODIS NDVI/EVI, SMAP L4) for many points in one task.

Credentials: EARTHDATA_USERNAME / EARTHDATA_PASSWORD (env or `.env`), else ~/.netrc
(machine urs.earthdata.nasa.gov).

    uv run --package farm-data python -m farm_data.appeears submit   # once; tasks queue for ~1 h
    uv run --package farm-data python -m farm_data.appeears fetch    # waits, then writes parquet
    uv run --package farm-data python -m farm_data.appeears missing  # counts only, no submit

`submit` after the first run queues a new batch (`<name>-2`, ...) for points no task covers.

Outputs (data/cache/appeears/):
- modis.parquet (batch 1; later batches modis-2.parquet ...): point x 16-day composite,
  MOD13Q1 (Terra) and MYD13Q1 (Aqua): ndvi, evi,
  reliability (0 good, 1 marginal, 2 snow/ice, 3 cloudy, -1 fill)
- smap.parquet (smap-2.parquet ...): point x day, SPL4SMGP root-zone soil moisture (m³/m³),
  daily mean of 3-hourly
"""

from __future__ import annotations

import io
import json
import netrc
import os
import sys
import time
from datetime import date

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from farm_data import CACHE, DATA_DIR

API = "https://appeears.earthdatacloud.nasa.gov/api"
OUT = CACHE / "appeears"
TASKS = OUT / "tasks.json"  # task name -> id, so `fetch` finds what `submit` queued
MODIS = {
    "MOD13Q1.061": ["_250m_16_days_NDVI", "_250m_16_days_EVI", "_250m_16_days_pixel_reliability"],
    "MYD13Q1.061": ["_250m_16_days_NDVI", "_250m_16_days_EVI", "_250m_16_days_pixel_reliability"],
}
SMAP = {"SPL4SMGP.008": ["Geophysical_Data_sm_rootzone"]}
MODIS_DATES = (date(2000, 1, 1), date(2025, 12, 31))
SMAP_DATES = (date(2015, 3, 31), date(2025, 12, 31))  # SMAP record starts 31 Mar 2015
BASES = {  # task base name -> (layers, dates); batch n >= 2 is "<base>-<n>"
    "field-signal-modis-ndvi": (MODIS, MODIS_DATES),
    "field-signal-smap-rootzone": (SMAP, SMAP_DATES),
}


def session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        respect_retry_after_header=True,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers["User-Agent"] = "field-signal/0.1"
    return s


def earthdata_credentials() -> tuple[str, str] | None:
    env = DATA_DIR.parent / ".env"
    if env.exists():  # minimal KEY=VALUE reader; no python-dotenv dependency
        for line in env.read_text().splitlines():
            k, sep, v = line.partition("=")
            if sep and k.strip().startswith("EARTHDATA_"):
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))
    user, pw = os.getenv("EARTHDATA_USERNAME"), os.getenv("EARTHDATA_PASSWORD")
    if user and pw:
        return user, pw
    try:
        auth = netrc.netrc().authenticators("urs.earthdata.nasa.gov")
    except (FileNotFoundError, netrc.NetrcParseError):
        return None
    return (auth[0], auth[2]) if auth and auth[0] and auth[2] else None


class AppEEARS:
    def __init__(self, s: requests.Session | None = None):
        self.s = s or session()
        creds = earthdata_credentials()
        if creds is None:
            raise PermissionError("No Earthdata credentials (EARTHDATA_* in .env or ~/.netrc)")
        r = self.s.post(f"{API}/login", auth=creds, timeout=60)
        if r.status_code == 401:
            raise PermissionError("Earthdata login rejected by AppEEARS")
        r.raise_for_status()
        self.s.headers["Authorization"] = f"Bearer {r.json()['token']}"

    def submit_points(
        self,
        name: str,
        layers: dict[str, list[str]],
        points: pd.DataFrame,
        start: date,
        end: date,
    ) -> str:
        """One point task for all rows of `points` (columns id, category, lat, lon)."""
        task = {
            "task_type": "point",
            "task_name": name,
            "params": {
                "dates": [
                    {"startDate": start.strftime("%m-%d-%Y"), "endDate": end.strftime("%m-%d-%Y")}
                ],
                "layers": [{"product": p, "layer": lyr} for p, ls in layers.items() for lyr in ls],
                "coordinates": [
                    {"id": str(r.id), "category": r.category, "latitude": r.lat, "longitude": r.lon}
                    for r in points.itertuples()
                ],
            },
        }
        r = self.s.post(f"{API}/task", json=task, timeout=60)
        if not r.ok:
            raise RuntimeError(f"AppEEARS rejected {name}: {r.status_code} {r.text[:300]}")
        return str(r.json()["task_id"])

    def status(self, task_id: str) -> str:
        r = self.s.get(f"{API}/task/{task_id}", timeout=60)
        r.raise_for_status()
        return str(r.json()["status"])

    def task_point_ids(self, task_id: str) -> set[str]:
        r = self.s.get(f"{API}/task/{task_id}", timeout=60)
        r.raise_for_status()
        return {str(c["id"]) for c in r.json()["params"]["coordinates"]}

    def wait(self, task_id: str, timeout_s: int = 6 * 3600, poll_s: int = 60) -> None:
        t0 = time.monotonic()
        while (st := self.status(task_id)) != "done":
            if st in {"error", "expired", "deleted"}:
                raise RuntimeError(f"AppEEARS task {task_id}: {st}")
            if time.monotonic() - t0 > timeout_s:
                raise TimeoutError(f"AppEEARS task {task_id} still {st}")
            print(f"  {task_id}: {st}", file=sys.stderr)
            time.sleep(poll_s)

    def results(self, task_id: str) -> pd.DataFrame:
        """All *results.csv files of a finished task (one per product), concatenated."""
        r = self.s.get(f"{API}/bundle/{task_id}", timeout=60)
        r.raise_for_status()
        frames = []
        for f in r.json()["files"]:
            if f["file_name"].endswith("results.csv"):
                d = self.s.get(f"{API}/bundle/{task_id}/{f['file_id']}", timeout=600)
                d.raise_for_status()
                frames.append(pd.read_csv(io.StringIO(d.text)))
        if not frames:
            raise RuntimeError(f"AppEEARS task {task_id} has no results.csv")
        return pd.concat(frames, ignore_index=True)


def _points() -> pd.DataFrame:
    from farm_data import zones

    _, pts = zones.load()
    return pts.assign(id=pts["zone_id"] + "#" + pts["point"].astype(str), category=pts["zone_type"])


def _batch(name: str) -> tuple[str, int]:
    """Task name -> (base name, batch number); batch 1 keeps the bare base name."""
    for b in BASES:
        if name == b:
            return b, 1
        if name.startswith(b + "-") and name[len(b) + 1 :].isdigit():
            return b, int(name[len(b) + 1 :])
    raise KeyError(name)


def missing_points(api: AppEEARS, tasks: dict[str, str]) -> dict[str, pd.DataFrame]:
    """Per base name: the sample points that no task of that base covers yet."""
    pts, covered = _points(), {b: set[str]() for b in BASES}
    for name, tid in tasks.items():
        covered[_batch(name)[0]] |= api.task_point_ids(tid)
    return {b: pts[~pts["id"].isin(ids)] for b, ids in covered.items()}


def submit() -> dict[str, str]:
    """First call: one task per base. Later calls: one new batch per base for points no task
    covers (idempotent); returns only the new tasks."""
    api = AppEEARS()
    old = json.loads(TASKS.read_text()) if TASKS.exists() else {}
    todo = missing_points(api, old) if old else {b: _points() for b in BASES}
    new = {}
    for base, pts in todo.items():
        if pts.empty:
            continue
        n = 1 + max((_batch(k)[1] for k in old if _batch(k)[0] == base), default=0)
        name = base if n == 1 else f"{base}-{n}"
        layers, dates = BASES[base]
        new[name] = api.submit_points(name, layers, pts, *dates)
    OUT.mkdir(parents=True, exist_ok=True)
    TASKS.write_text(json.dumps({**old, **new}, indent=2))
    return new


def _split_id(df: pd.DataFrame) -> pd.DataFrame:
    zp = df["ID"].astype(str).str.rsplit("#", n=1, expand=True)
    return df.assign(zone_id=zp[0], point=zp[1].astype(int), date=pd.to_datetime(df["Date"]))


def tidy_modis(raw: pd.DataFrame) -> pd.DataFrame:
    """Long AppEEARS MODIS CSV (one product per row block) -> point x date x satellite."""
    frames = []
    for prod, sat in (("MOD13Q1_061", "terra"), ("MYD13Q1_061", "aqua")):
        cols = {f"{prod}__250m_16_days_{b}": b.lower() for b in ("NDVI", "EVI")}
        rel = f"{prod}__250m_16_days_pixel_reliability"
        if rel not in raw:
            continue
        d = _split_id(raw[raw[rel].notna()])
        d = d[["zone_id", "point", "date", *cols, rel]].rename(columns={**cols, rel: "reliability"})
        frames.append(d.assign(satellite=sat))
    out = pd.concat(frames, ignore_index=True)
    for c in ("ndvi", "evi"):  # AppEEARS returns scaled values; fill (-3000 raw) -> NaN
        out.loc[out[c] < -0.2, c] = float("nan")
    return out.astype({"reliability": "int8"}).sort_values(["zone_id", "point", "date"])


def tidy_smap(raw: pd.DataFrame) -> pd.DataFrame:
    col = "SPL4SMGP_008_Geophysical_Data_sm_rootzone"
    d = _split_id(raw)
    d = d[d[col] >= 0].assign(date=lambda x: x["date"].dt.normalize())
    return (
        d.groupby(["zone_id", "point", "date"], as_index=False)[col]
        .mean()
        .rename(columns={col: "sm_rootzone"})
    )


def fetch(wait: bool = True) -> None:
    """Download + tidy each finished task once. `wait=False` skips tasks still queued."""
    api, tasks = AppEEARS(), json.loads(TASKS.read_text())
    for name, tid in tasks.items():
        base, n = _batch(name)
        stem = "modis" if "modis" in base else "smap"
        out = OUT / (f"{stem}.parquet" if n == 1 else f"{stem}-{n}.parquet")
        if out.exists():
            continue
        if not wait and (st := api.status(tid)) != "done":
            print(f"{name}: {st}")
            continue
        api.wait(tid)
        raw = api.results(tid)
        part = out.with_name(out.name + ".part")  # shared folder: never expose a half-written file
        (tidy_modis if stem == "modis" else tidy_smap)(raw).to_parquet(part, index=False)
        part.rename(out)
        print(f"{name}: {len(raw)} raw rows -> {out}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    if cmd == "submit":
        print(submit())
    elif cmd == "status":
        api = AppEEARS()
        for n, t in json.loads(TASKS.read_text()).items():
            print(n, t, api.status(t))
    elif cmd == "missing":  # GET only
        for b, m in missing_points(AppEEARS(), json.loads(TASKS.read_text())).items():
            print(b, len(m), "missing points")
    else:
        fetch(wait=cmd != "poll")  # `fetch` waits for every task; `poll` takes what is done
