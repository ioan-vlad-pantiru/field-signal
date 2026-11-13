#!/usr/bin/env python3
"""
Field Signal — data-access check for one point.

Pulls, for a single lat/lon:
  1. NASA POWER daily agroclimate (no account)          -> power_daily.csv
  2. MODIS MOD13Q1 NDVI/EVI via ORNL DAAC web service   -> modis_vi.csv
     (no account)
  3. SMAP L4 root-zone + surface soil moisture via      -> smap_daily.csv
     NASA AppEEARS (needs Earthdata login)
  4. SoilGrids 2.0 soil properties (ISRIC, no account)  -> soilgrids.csv
and prints a per-year summary proving we have >=3 NASA indicators over >=5 years.

Earthdata credentials (for SMAP only), first match wins:
  - env EARTHDATA_USERNAME / EARTHDATA_PASSWORD
  - ~/.netrc entry:  machine urs.earthdata.nasa.gov login <user> password <pass>

Usage (from the repo root):
  uv run python data/scripts/fetch_point.py --name aiud --lat 46.30 --lon 23.75
  uv run python data/scripts/fetch_point.py --name aiud --lat 46.30 --lon 23.75 --skip-smap
  uv run python data/scripts/fetch_point.py --name aiud --lat 46.30 --lon 23.75 \
      --smap-task-id <id>   # resume a queued AppEEARS task

Outputs go to data/cache/<name>/ (gitignored).

AppEEARS tasks are queued server-side and can take from minutes to an hour.
If polling times out, the script prints the task id; rerun with --smap-task-id.
"""

from __future__ import annotations

import argparse
import io
import logging
import netrc
import os
import sys
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("fetch_point")

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_PARAMS = [
    "T2M",  # mean air temp at 2 m (°C)
    "T2M_MAX",  # max air temp (°C)
    "T2M_MIN",  # min air temp (°C)
    "PRECTOTCORR",  # bias-corrected precipitation (mm/day)
    "RH2M",  # relative humidity at 2 m (%)
    "ALLSKY_SFC_SW_DWN",  # solar radiation (MJ/m²/day with AG community)
    "WS2M",  # wind speed at 2 m (m/s)
    "GWETROOT",  # root-zone soil wetness (0-1, model-based, MERRA-2)
    "GWETTOP",  # surface soil wetness (0-1, model-based)
]
POWER_FILL = -999.0

MODIS_BASE = "https://modis.ornl.gov/rst/api/v1"
MODIS_PRODUCT = "MOD13Q1"
MODIS_BANDS = {
    "250m_16_days_NDVI": "ndvi",
    "250m_16_days_EVI": "evi",
    "250m_16_days_pixel_reliability": "reliability",  # 0 good, 1 marginal, 2 snow/ice, 3 cloudy
}
MODIS_MAX_DATES_PER_CALL = 10  # service limit

APPEEARS_BASE = "https://appeears.earthdatacloud.nasa.gov/api"
SMAP_PRODUCT_PREFIX = "SPL4SMGP"  # SMAP L4 global 3-hourly 9 km
SMAP_LAYER_KEYS = {"sm_rootzone": "smap_rootzone", "sm_surface": "smap_surface"}

SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
SOILGRIDS_PROPS = ["soc", "phh2o", "clay", "sand", "silt", "bdod", "nitrogen", "cec"]
SOILGRIDS_DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm"]

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "cache"


# --------------------------------------------------------------------------- utils


def make_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        respect_retry_after_header=True,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.headers.update({"User-Agent": "farm-titans-spaceapps/0.1"})
    return s


@dataclass(frozen=True)
class Point:
    name: str
    lat: float
    lon: float


def earthdata_credentials() -> tuple[str, str] | None:
    user, pw = os.getenv("EARTHDATA_USERNAME"), os.getenv("EARTHDATA_PASSWORD")
    if user and pw:
        return user, pw
    try:
        auth = netrc.netrc().authenticators("urs.earthdata.nasa.gov")
    except (FileNotFoundError, netrc.NetrcParseError):
        auth = None
    if auth and auth[0] and auth[2]:
        return auth[0], auth[2]
    return None


# --------------------------------------------------------------------------- 1. POWER


def fetch_power(s: requests.Session, p: Point, start: date, end: date) -> pd.DataFrame:
    params = {
        "parameters": ",".join(POWER_PARAMS),
        "community": "AG",
        "latitude": p.lat,
        "longitude": p.lon,
        "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "format": "JSON",
        "time-standard": "UTC",
    }
    r = s.get(POWER_URL, params=params, timeout=180)
    r.raise_for_status()
    payload = r.json()
    series = payload["properties"]["parameter"]
    df = pd.DataFrame(series)
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df.index.name = "date"
    df = df.replace(POWER_FILL, pd.NA).astype("Float64")
    missing = [c for c in POWER_PARAMS if c not in df.columns]
    if missing:
        log.warning("POWER did not return: %s", missing)
    log.info("POWER: %d days, %s → %s", len(df), df.index.min().date(), df.index.max().date())
    return df


# --------------------------------------------------------------------------- 2. MODIS


def _modis_dates(s: requests.Session, p: Point, start: date, end: date) -> list[str]:
    r = s.get(
        f"{MODIS_BASE}/{MODIS_PRODUCT}/dates",
        params={"latitude": p.lat, "longitude": p.lon},
        headers={"Accept": "application/json"},
        timeout=60,
    )
    r.raise_for_status()
    dates = [
        d["modis_date"]
        for d in r.json()["dates"]
        if start <= date.fromisoformat(d["calendar_date"]) <= end
    ]
    return dates


def fetch_modis(s: requests.Session, p: Point, start: date, end: date) -> pd.DataFrame:
    dates = _modis_dates(s, p, start, end)
    log.info("MODIS: %d composites to fetch", len(dates))
    rows: list[dict[str, Any]] = []
    for i in range(0, len(dates), MODIS_MAX_DATES_PER_CALL):
        chunk = dates[i : i + MODIS_MAX_DATES_PER_CALL]
        for band, col in MODIS_BANDS.items():
            r = s.get(
                f"{MODIS_BASE}/{MODIS_PRODUCT}/subset",
                params={
                    "latitude": p.lat,
                    "longitude": p.lon,
                    "band": band,
                    "startDate": chunk[0],
                    "endDate": chunk[-1],
                    "kmAboveBelow": 0,
                    "kmLeftRight": 0,
                },
                headers={"Accept": "application/json"},
                timeout=120,
            )
            r.raise_for_status()
            body = r.json()
            scale = float(body.get("scale") or 1) if col != "reliability" else 1.0
            for item in body.get("subset", []):
                raw = item["data"][0] if item.get("data") else None
                rows.append(
                    {
                        "date": item["calendar_date"],
                        "var": col,
                        "value": None if raw is None else raw * (scale if scale != 0 else 1),
                    }
                )
    if not rows:
        raise RuntimeError("MODIS returned no data")
    df = (
        pd.DataFrame(rows)
        .pivot_table(index="date", columns="var", values="value", aggfunc="first")
        .sort_index()
    )
    df.index = pd.to_datetime(df.index)
    # NDVI/EVI fill value in MOD13Q1 is -3000 → after scaling -0.3; treat < -0.2 as missing
    for c in ("ndvi", "evi"):
        if c in df:
            df.loc[df[c] < -0.2, c] = pd.NA
    if "reliability" in df:
        df["usable"] = df["reliability"].isin([0, 1])
    log.info("MODIS: %d composites, %s → %s", len(df), df.index.min().date(), df.index.max().date())
    return df


# --------------------------------------------------------------------------- 3. SMAP via AppEEARS


class AppEEARS:
    def __init__(self, s: requests.Session, creds: tuple[str, str]):
        self.s = s
        r = s.post(f"{APPEEARS_BASE}/login", auth=creds, timeout=60)
        if r.status_code == 401:
            raise PermissionError("Earthdata login rejected by AppEEARS (check username/password)")
        r.raise_for_status()
        self.headers = {"Authorization": f"Bearer {r.json()['token']}"}

    def latest_product(self, prefix: str) -> str:
        r = self.s.get(f"{APPEEARS_BASE}/product", timeout=60)
        r.raise_for_status()
        ids = sorted(
            (
                p["ProductAndVersion"]
                for p in r.json()
                if p["ProductAndVersion"].startswith(prefix + ".")
            ),
            key=lambda x: x.split(".")[-1],
        )
        if not ids:
            raise RuntimeError(f"AppEEARS has no product starting with {prefix}")
        return ids[-1]

    def layers(self, product: str) -> list[str]:
        r = self.s.get(f"{APPEEARS_BASE}/product/{product}", timeout=60)
        r.raise_for_status()
        return list(r.json().keys())

    def submit_point(
        self, p: Point, product: str, layers: list[str], start: date, end: date
    ) -> str:
        task = {
            "task_type": "point",
            "task_name": f"farm-titans-{p.name}-{product}",
            "params": {
                "dates": [
                    {"startDate": start.strftime("%m-%d-%Y"), "endDate": end.strftime("%m-%d-%Y")}
                ],
                "layers": [{"product": product, "layer": lyr} for lyr in layers],
                "coordinates": [
                    {"id": "0", "category": p.name, "latitude": p.lat, "longitude": p.lon}
                ],
            },
        }
        r = self.s.post(f"{APPEEARS_BASE}/task", json=task, headers=self.headers, timeout=60)
        r.raise_for_status()
        return r.json()["task_id"]

    def wait(self, task_id: str, timeout_s: int, poll_s: int = 20) -> bool:
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout_s:
            r = self.s.get(f"{APPEEARS_BASE}/task/{task_id}", headers=self.headers, timeout=60)
            r.raise_for_status()
            status = r.json().get("status")
            log.info("AppEEARS task %s: %s", task_id, status)
            if status == "done":
                return True
            if status in {"error", "expired", "deleted"}:
                raise RuntimeError(f"AppEEARS task {task_id} ended with status {status}")
            time.sleep(poll_s)
        return False

    def download_csv(self, task_id: str) -> pd.DataFrame:
        r = self.s.get(f"{APPEEARS_BASE}/bundle/{task_id}", headers=self.headers, timeout=60)
        r.raise_for_status()
        files = [f for f in r.json()["files"] if f["file_name"].endswith("results.csv")]
        if not files:
            raise RuntimeError("AppEEARS bundle has no *results.csv")
        f = files[0]
        d = self.s.get(
            f"{APPEEARS_BASE}/bundle/{task_id}/{f['file_id']}",
            headers=self.headers,
            timeout=300,
            allow_redirects=True,
        )
        d.raise_for_status()
        return pd.read_csv(io.StringIO(d.text))


def fetch_smap(
    s: requests.Session,
    p: Point,
    start: date,
    end: date,
    creds: tuple[str, str],
    task_id: str | None,
    timeout_s: int,
) -> pd.DataFrame | None:
    api = AppEEARS(s, creds)
    product = api.latest_product(SMAP_PRODUCT_PREFIX)
    if task_id is None:
        all_layers = api.layers(product)
        wanted = [lyr for lyr in all_layers if any(lyr.endswith(k) for k in SMAP_LAYER_KEYS)]
        if not wanted:
            raise RuntimeError(f"No soil-moisture layers found in {product}: {all_layers[:20]}")
        smap_start = max(start, date(2015, 3, 31))  # SMAP record begins 31 Mar 2015
        task_id = api.submit_point(p, product, wanted, smap_start, end)
        log.info("AppEEARS: submitted %s (%s) → task %s", product, ", ".join(wanted), task_id)
    if not api.wait(task_id, timeout_s):
        log.warning("AppEEARS still processing. Rerun later with --smap-task-id %s", task_id)
        return None
    raw = api.download_csv(task_id)
    date_col = (
        "Date"
        if "Date" in raw.columns
        else raw.columns[raw.columns.str.lower().str.contains("date")][0]
    )
    out = pd.DataFrame({"date": pd.to_datetime(raw[date_col]).dt.tz_localize(None).dt.floor("D")})
    for key, name in SMAP_LAYER_KEYS.items():
        cols = [c for c in raw.columns if c.endswith(key)]
        if cols:
            v = pd.to_numeric(raw[cols[0]], errors="coerce")
            out[name] = v.where(v >= 0)  # negative = fill
    daily = out.groupby("date").mean().sort_index()  # L4 is 3-hourly → daily mean
    log.info(
        "SMAP (%s): %d days, %s → %s",
        product,
        len(daily),
        daily.index.min().date(),
        daily.index.max().date(),
    )
    return daily


# --------------------------------------------------------------------------- 4. SoilGrids


def fetch_soilgrids(s: requests.Session, p: Point) -> pd.DataFrame:
    params: list[tuple[str, Any]] = [("lat", p.lat), ("lon", p.lon), ("value", "mean")]
    params += [("property", x) for x in SOILGRIDS_PROPS]
    params += [("depth", d) for d in SOILGRIDS_DEPTHS]
    r = s.get(SOILGRIDS_URL, params=params, timeout=120)
    r.raise_for_status()
    rows = []
    for layer in r.json()["properties"]["layers"]:
        um = layer["unit_measure"]
        factor = float(um.get("d_factor") or 1)
        for d in layer["depths"]:
            v = d["values"].get("mean")
            rows.append(
                {
                    "property": layer["name"],
                    "depth": d["label"],
                    "value": None if v is None else v / factor,
                    "unit": um.get("target_units"),
                }
            )
    df = pd.DataFrame(rows)
    log.info("SoilGrids: %d values", df["value"].notna().sum())
    return df


# --------------------------------------------------------------------------- summary


def yearly_summary(
    power: pd.DataFrame | None,
    modis: pd.DataFrame | None,
    smap: pd.DataFrame | None,
    hot_c: float,
) -> pd.DataFrame:
    """Quick per-year indicators. Thresholds are placeholders pending agronomist review."""
    parts: list[pd.Series | pd.DataFrame] = []
    if power is not None:
        jul = power[power.index.month == 7]
        parts.append(
            jul.groupby(jul.index.year)["T2M_MAX"]
            .apply(lambda x: int((x >= hot_c).sum()))
            .rename(f"jul_days_tmax_ge_{hot_c:g}C")
        )
        jja = power[power.index.month.isin([6, 7, 8])]
        parts.append(
            jja.groupby(jja.index.year)["PRECTOTCORR"].sum().round(0).rename("jja_rain_mm")
        )
        may = power[power.index.month.isin([5, 6])]
        parts.append(may.groupby(may.index.year)["RH2M"].mean().round(1).rename("may_jun_rh_pct"))
    if modis is not None and "ndvi" in modis:
        m = modis[modis.get("usable", True) == True]  # noqa: E712
        parts.append(m.groupby(m.index.year)["ndvi"].max().round(3).rename("ndvi_peak"))
    if smap is not None and "smap_rootzone" in smap:
        ja = smap[smap.index.month.isin([7, 8])]
        parts.append(
            ja.groupby(ja.index.year)["smap_rootzone"]
            .mean()
            .round(3)
            .rename("smap_rootzone_jul_aug")
        )
    if not parts:
        return pd.DataFrame()
    out = pd.concat(parts, axis=1)
    out.index.name = "year"
    return out


# --------------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--name", required=True, help="short id, used for the output folder")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--start-year", type=int, default=2001)
    ap.add_argument("--end-year", type=int, default=2025)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--skip-power", action="store_true")
    ap.add_argument("--skip-modis", action="store_true")
    ap.add_argument("--skip-smap", action="store_true")
    ap.add_argument("--skip-soil", action="store_true")
    ap.add_argument("--smap-task-id", help="resume an existing AppEEARS task")
    ap.add_argument("--smap-timeout", type=int, default=900, help="seconds to wait for AppEEARS")
    ap.add_argument(
        "--hot-threshold",
        type=float,
        default=30.0,
        help="°C for the July hot-day count (placeholder, needs agronomist review)",
    )
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if a.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    p = Point(a.name, a.lat, a.lon)
    start, end = date(a.start_year, 1, 1), date(a.end_year, 12, 31)
    out_dir = a.out / p.name
    out_dir.mkdir(parents=True, exist_ok=True)
    s = make_session()
    status: dict[str, str] = {}

    power = modis = smap = None

    if not a.skip_power:
        try:
            power = fetch_power(s, p, start, end)
            power.to_csv(out_dir / "power_daily.csv")
            status["NASA POWER"] = "ok"
        except Exception as e:
            log.exception("POWER failed")
            status["NASA POWER"] = f"FAILED: {e}"

    if not a.skip_modis:
        try:
            modis = fetch_modis(s, p, start, end)
            modis.to_csv(out_dir / "modis_vi.csv")
            status["MODIS MOD13Q1"] = "ok"
        except Exception as e:
            log.exception("MODIS failed")
            status["MODIS MOD13Q1"] = f"FAILED: {e}"

    if not a.skip_smap:
        creds = earthdata_credentials()
        if creds is None:
            status["SMAP L4"] = "SKIPPED: no Earthdata credentials (env or ~/.netrc)"
        else:
            try:
                smap = fetch_smap(s, p, start, end, creds, a.smap_task_id, a.smap_timeout)
                if smap is not None:
                    smap.to_csv(out_dir / "smap_daily.csv")
                    status["SMAP L4"] = "ok"
                else:
                    status["SMAP L4"] = "PENDING: rerun with --smap-task-id (see log)"
            except Exception as e:
                log.exception("SMAP failed")
                status["SMAP L4"] = f"FAILED: {e}"

    if not a.skip_soil:
        try:
            soil = fetch_soilgrids(s, p)
            soil.to_csv(out_dir / "soilgrids.csv", index=False)
            status["SoilGrids"] = "ok"
        except Exception as e:
            log.exception("SoilGrids failed")
            status["SoilGrids"] = f"FAILED: {e}"

    summary = yearly_summary(power, modis, smap, a.hot_threshold)
    if not summary.empty:
        summary.to_csv(out_dir / "summary_by_year.csv")
        with pd.option_context("display.max_rows", 50, "display.width", 140):
            print("\nPer-year indicators (thresholds are placeholders, need agronomist review):")
            print(summary.tail(12).to_string())

    print(f"\nPoint {p.name} ({p.lat}, {p.lon}) → {out_dir.resolve()}")
    for k, v in status.items():
        print(f"  {k:<14} {v}")
    nasa_ok = sum(v == "ok" for k, v in status.items() if k != "SoilGrids")
    print(f"\nNASA sources working: {nasa_ok}/3 (brief needs ≥3 indicators over ≥5 years)")
    return 0 if all(v == "ok" for v in status.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
