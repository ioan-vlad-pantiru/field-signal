"""Earth Engine extraction (step 3): chunked, resumable, long-format Parquet.

schema.py is the frozen contract; assets/bands are probed before bulk work. Run
from code/: `venv/bin/python -m gee [--region alba --pilot]` or `--self-check`.
"""
import argparse, io, json, os, random, re, tempfile, time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np, pandas as pd, requests, env

ROOT = Path(__file__).resolve().parent.parent
POINTS_PATH = ROOT / "data/interim/points.parquet"
RAW = ROOT / "data/raw"
CHUNK = int(os.environ.get("GEE_CHUNK", "2000"))
# Interactive-request quota is 40/project, but the binding constraint is the monthly
# EECU budget, not concurrency, and past the knee requests just 429 and back off.
WORKERS = int(os.environ.get("GEE_WORKERS", "2"))
EMPTY_OK = {"eucropmap"}  # EU-only product; RS12 points have no coverage
TARGET_BYTES = 40_000_000  # a larger first response shrinks the remaining chunks
MAX_ATTEMPTS = 6
TILE_SCALE = 2  # 576-band embedding mosaics exceed the default per-tile memory
EMB, EUCM, MOD13 = ("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL", "JRC/D5/EUCROPMAP/V1",
                    "MODIS/061/MOD13Q1")
L30, S30 = "NASA/HLS/HLSL30/v002", "NASA/HLS/HLSS30/v002"
SMAP, SRTM = "NASA/SMAP/SPL4SMGP/008", "USGS/SRTMGL1_003"
# Fmask bits 1..4: cloud, adjacent-to-cloud, cloud-shadow, snow/ice. All corrupt
# surface reflectance and therefore NDVI; the remaining bits are kept.
HLS_BAD_BITS = 0b11110

def _req(cond, msg):
    if not cond: raise SystemExit(msg)

def _year(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).year

def _init():
    # Earth Engine is authenticated with the interactive OAuth credential file, not a
    # service-account key. The path is absolute rather than ~-relative because pipeline
    # steps may run as root while the credential lives in jovyan's home.
    cred = Path(os.environ.get("EE_CREDENTIALS",
                               "/home/jovyan/.config/earthengine/credentials"))
    if not cred.is_file(): raise SystemExit(f"missing Earth Engine credentials: {cred}")
    # shortcut: project id belongs in env.py; read the one-line file until exposed.
    proj = Path("/home/jovyan/.crop_secrets/gee_project")
    if not proj.is_file(): raise SystemExit(f"missing secrets file: {proj}")
    import ee, ee.oauth
    from google.oauth2.credentials import Credentials
    stored = json.loads(cred.read_text())
    creds = Credentials(
        token=None, refresh_token=stored["refresh_token"],
        client_id=stored.get("client_id", ee.oauth.CLIENT_ID),
        client_secret=stored.get("client_secret", ee.oauth.CLIENT_SECRET),
        token_uri=ee.oauth.TOKEN_URI,
        scopes=stored.get("scopes", ee.oauth.SCOPES))
    ee.Initialize(creds, project=proj.read_text().strip())
    return ee

def probe(ee):
    """Resolve every asset and assert the band assumptions before bulk extraction."""
    emb = ee.ImageCollection(EMB).sort("system:time_start")
    eb = emb.first().bandNames().getInfo()
    _req(eb == [f"A{i:02d}" for i in range(64)], f"{EMB}: expected A00..A63, got {eb}")
    mm = emb.reduceColumns(ee.Reducer.minMax(), ["system:time_start"]).getInfo()
    _req(mm.get("min"), f"{EMB}: no image times found")
    y0, y1 = _year(mm["min"]), _year(mm["max"])
    years = [y for y in range(y0, y1 + 1)
             if emb.filter(ee.Filter.calendarRange(y, y, "year")).size().getInfo() > 0]
    _req(len(years) == y1 - y0 + 1,
         f"{EMB}: missing years between {y0} and {y1}: present {years}")
    cm = ee.ImageCollection(EUCM)
    cm_years = sorted({_year(t) for t in (cm.aggregate_array("system:time_start").getInfo() or [])})
    _req(cm_years == [2018, 2022], f"{EUCM}: expected years [2018, 2022], got {cm_years}")
    _req("classification" in cm.first().bandNames().getInfo(), f"{EUCM}: missing classification")
    mod = ee.ImageCollection(MOD13).first().bandNames().getInfo()
    _req({"NDVI", "SummaryQA"} <= set(mod), f"{MOD13}: got {mod}")
    for asset, red, nir in ((L30, "B4", "B5"), (S30, "B4", "B8A")):
        b = ee.ImageCollection(asset).first().bandNames().getInfo()
        # S30 also exposes B8; we use B8A, the band paired with L30 B5 for HLS NDVI.
        _req(red in b and nir in b and "Fmask" in b, f"{asset}: got {b}")
    _req("sm_rootzone" in ee.ImageCollection(SMAP).first().bandNames().getInfo(),
         f"{SMAP}: missing sm_rootzone")
    for v in ("clay", "sand", "soc", "phh2o"):
        b = set(ee.Image(f"projects/soilgrids-isric/{v}_mean").bandNames().getInfo())
        need = {f"{v}_{d}cm_mean" for d in ("0-5", "5-15", "15-30")}
        _req(need <= b, f"soilgrids {v}: missing {sorted(need - b)}")
    _req("elevation" in ee.Image(SRTM).bandNames().getInfo(), f"{SRTM}: missing elevation")
    return {"embedding_bands": eb, "embedding_years": years}

def _rename(col, names, label):
    img = col.toBands()
    n = img.bandNames().size().getInfo()
    _req(n == len(names), f"{label}: toBands gave {n} bands, expected {len(names)}")
    return img.rename(names)

def _embedding(ee, info):
    # The collection is ~10k tiles per year with 64 bands each, not one image per
    # year, so toBands() is unusable: mosaic each year, then concatenate the years.
    imgs = [ee.ImageCollection(EMB).filter(ee.Filter.calendarRange(y, y, "year")).mosaic()
            .rename([f"{b}_{y}" for b in info["embedding_bands"]])
            for y in info["embedding_years"]]
    _req(len(imgs) == len(info["embedding_years"]), "embedding: no annual mosaics")
    return ee.Image.cat(imgs)

def _eucropmap(ee):
    imgs = [ee.ImageCollection(EUCM).filterDate(f"{y}-01-01", f"{y+1}-01-01").first()
            for y in (2018, 2022)]
    return _rename(ee.ImageCollection(imgs),
                   ["classification_2018", "classification_2022"], "eucropmap")

def _modis(ee, band):
    col = (ee.ImageCollection(MOD13)
           .filterDate("2000-01-01", str(date.today() + timedelta(days=1)))
           .select(band).sort("system:time_start"))
    ts = col.aggregate_array("system:time_start").getInfo() or []
    _req(ts, f"{MOD13}: no images for {band}")
    img = _rename(col, [datetime.fromtimestamp(t / 1000, timezone.utc).strftime("%Y-%m-%d")
                        for t in ts], f"modis {band}")
    return img.multiply(0.0001) if band == "NDVI" else img

def _months():
    y, m, stop, out = 2016, 1, date.today().replace(day=1), []
    while date(y, m, 1) < stop:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out

def _hls_ndvi(ee, asset, red, nir, lo, hi):
    return (ee.ImageCollection(asset).filterDate(lo, hi)
            .map(lambda i: i.updateMask(i.select("Fmask").bitwiseAnd(HLS_BAD_BITS).eq(0))
                 .normalizedDifference([nir, red]).rename("ndvi")))

def _hls(ee):
    months = _months()
    imgs = []
    for ym in months:
        y, m = int(ym[:4]), int(ym[5:7])
        hi = f"{y+1:04d}-01-01" if m == 12 else f"{y:04d}-{m+1:02d}-01"
        imgs.append(_hls_ndvi(ee, L30, "B4", "B5", f"{ym}-01", hi)
                    .merge(_hls_ndvi(ee, S30, "B4", "B8A", f"{ym}-01", hi))
                    .median().rename("ndvi"))
    return _rename(ee.ImageCollection(imgs), months, "hls_ndvi")

def _smap(ee):
    d, starts = date(2015, 1, 1), []
    while d < date.today():
        starts.append(d)
        d += timedelta(days=10)
    # Some 10-day windows have no SPL4SMGP granules, so mean() has no bands; cat
    # (unlike toBands) tolerates that and keeps each period's date as its band name.
    imgs = [ee.ImageCollection(SMAP)
            .filterDate(s.isoformat(), (s + timedelta(days=10)).isoformat())
            .select("sm_rootzone").mean().rename(s.isoformat()) for s in starts]
    return ee.Image.cat(imgs)

def _soil(ee):
    out = []
    for v in ("clay", "sand", "soc", "phh2o"):
        img = ee.Image(f"projects/soilgrids-isric/{v}_mean")
        a, b, c = (img.select(f"{v}_{d}cm_mean") for d in ("0-5", "5-15", "15-30"))
        # 0-30 cm thickness-weighted; g/kg, dg/kg or pH*10 -> /10.
        out.append(a.multiply(5).add(b.multiply(10)).add(c.multiply(15))
                   .divide(30).multiply(0.1).rename(v))
    return ee.Image.cat(out)

def _srtm(ee):
    elev = ee.Image(SRTM).select("elevation")
    return ee.Image.cat([elev.rename("elevation"), ee.Terrain.slope(elev).rename("slope")])

def _features(ee, frame, key):
    return ee.FeatureCollection([
        ee.Feature(ee.Geometry.Point([float(lo), float(la)]), {key: str(k)})
        for k, lo, la in zip(frame[key], frame["lon"], frame["lat"])])

def _fetch(ee, image, frame, key, dataset, cid, scale):
    # Explicit EPSG:4326 + scale: embedding tile projections vary per tile.
    table = image.reduceRegions(_features(ee, frame, key), ee.Reducer.first(),
                                crs="EPSG:4326", scale=scale, tileScale=TILE_SCALE)
    status = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = requests.get(table.getDownloadURL(filetype="csv"), timeout=900)
            if r.status_code == 429 or r.status_code >= 500:
                status = r.status_code; raise RuntimeError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.content
        except Exception as exc:
            status = getattr(exc, "status_code", None) or status
            if attempt + 1 == MAX_ATTEMPTS:
                raise SystemExit(f"{dataset}: chunk {cid} failed after {MAX_ATTEMPTS} "
                                 f"attempts (HTTP {status or 'unknown'}): {exc}")
            time.sleep(min(60.0, 2 ** attempt) + random.random())

_RULES = {
    "embedding": (r"A(\d{2})_(\d{4})", lambda m: (f"A{m[1]}", m[2])),
    "eucropmap": (r"classification_(\d{4})", lambda m: ("classification", m[1])),
    "modis_ndvi": (r"(\d{4}-\d{2}-\d{2})", lambda m: ("ndvi", m[1])),
    "modis_qa": (r"(\d{4}-\d{2}-\d{2})", lambda m: ("summary_qa", m[1])),
    "hls_ndvi": (r"(\d{4}-\d{2})", lambda m: ("ndvi", m[1] + "-01")),  # month start
    "smap_sm": (r"(\d{4}-\d{2}-\d{2})", lambda m: ("sm_rootzone", m[1])),
}
_STATIC = {"soilgrids": ("clay", "sand", "soc", "phh2o"),
           "srtm": ("elevation", "slope")}

def _rule(dataset, col):
    """Map a downloaded CSV column to (variable, date_or_year); None = ignore."""
    if dataset in _STATIC:
        return (col, "") if col in _STATIC[dataset] else None
    rx, fn = _RULES[dataset]
    m = re.fullmatch(rx, col)
    return fn(m) if m else None

def _parse(text, dataset, key):
    table = pd.read_csv(io.StringIO(text), dtype=str)  # keep point/cell ids verbatim
    _req(key in table.columns,
         f"{dataset}: CSV has no {key} column (first: {list(table.columns)[:5]})")
    parts = []
    for col in table.columns:
        rule = _rule(dataset, col)
        if rule:
            var, when = rule
            parts.append(pd.DataFrame({
                key: table[key].astype(str), "date_or_year": when, "variable": var,
                "value": pd.to_numeric(table[col], errors="coerce")}))
    _req(parts, f"{dataset}: no recognised band columns in CSV")
    out = pd.concat(parts, ignore_index=True).dropna(subset=["value"])
    out["date_or_year"] = out["date_or_year"].astype(str)
    out["value"] = out["value"].astype("float32")
    return out[[key, "date_or_year", "variable", "value"]]

def _write_atomic(df, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try: path.parent.chmod(0o777)  # NFS: other agents must be able to write here too
    except OSError: pass
    tmp = f"{path}.{os.getpid()}.tmp"  # unique, so a stale tmp of another owner is untouched
    try:
        df.to_parquet(tmp, index=False)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def _covered(dataset, n):
    # shortcut: coverage comes from part-name ranges, so a chunk spanning a resume
    # gap would mark the gap covered; upgrade to a per-point manifest if needed.
    cov = np.zeros(n, dtype=bool)
    pat = re.compile(rf"^part-{re.escape(dataset)}-p(\d+)-(\d+)\.parquet$")
    for p in (RAW / dataset).glob(f"part-{dataset}-p*.parquet"):
        m = pat.match(p.name)
        if m: cov[int(m[1]):int(m[2])] = True
    return cov

def _chunks(idx, size):
    return [idx[i:i + size] for i in range(0, len(idx), size)]

def _tune(size, nbytes):
    return size if nbytes <= TARGET_BYTES else max(200, min(size, int(size * TARGET_BYTES / nbytes)))

def _run_dataset(dataset, image, frame, key, ee, stats, scale):
    todo = np.flatnonzero(~_covered(dataset, len(frame)))
    stats[dataset]["skipped"] = len(list((RAW / dataset).glob(f"part-{dataset}-p*.parquet")))
    if not len(todo): return
    size, first = CHUNK, True
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        pending, pos = {}, 0
        while pos < len(todo) or pending:
            while len(pending) < WORKERS and pos < len(todo):
                idx = _chunks(todo[pos:], size)[0]  # honour a tuned size immediately
                pos += len(idx)
                cid = f"p{idx[0]:06d}-{idx[-1] + 1:06d}"
                fut = pool.submit(_fetch, ee, image, frame.iloc[idx], key, dataset, cid, scale)
                pending[fut] = (idx, cid)
            for fut in wait(pending, return_when=FIRST_COMPLETED)[0]:
                idx, cid = pending.pop(fut)
                payload = fut.result()
                df = _parse(payload.decode("utf-8"), dataset, key)
                if len(df) == 0:
                    # EUCROPMAP covers the EU only, so Vojvodina (RS12) legitimately
                    # returns nothing; an empty part records that a chunk was attempted
                    # so a resume does not retry it forever. Every other dataset must
                    # return values or the step halts.
                    if dataset not in EMPTY_OK:
                        raise SystemExit(f"{dataset}: chunk {cid} returned no values")
                    print(f"{dataset}: chunk {cid} has no coverage (empty part)", flush=True)
                path = RAW / dataset / f"part-{dataset}-{cid}.parquet"
                _write_atomic(df, path)
                s = stats[dataset]
                s["rows"] += len(df); s["parts"] += 1
                s["bytes"] += path.stat().st_size
                s["dates"].update(df["date_or_year"].unique())
                if first:
                    new = _tune(size, len(payload))
                    if new != size:
                        print(f"{dataset}: first response {len(payload)/2**20:.1f} MiB, "
                              f"chunk size -> {new}")
                    size, first = new, False

def _cells(points):
    try:
        from weather import cell_ids
    except ModuleNotFoundError:
        raise SystemExit("smap_sm needs code/weather.py (agent D) exporting cell_ids; not found")
    ids = cell_ids(points)  # weather.py returns power_cell and smap_cell per point
    _req("smap_cell" in ids.columns, "weather.cell_ids must expose smap_cell")
    # shortcut: SMAP sampled at the points' mean position per SMAP grid cell, not the
    # cell centre; upgrade when weather.py exposes cell centres.
    out = points[["lon", "lat"]].copy()
    out["cell_id"] = ids["smap_cell"].to_numpy()
    return out.groupby("cell_id", as_index=False)[["lon", "lat"]].mean()

def _report(stats):
    print(f"\n{'dataset':12} {'rows':>10} {'parts':>6} {'MiB':>8}  "
          f"{'dates covered (this run)':32} skipped")
    for name, s in stats.items():
        dates = sorted(d for d in s["dates"] if d)
        cov = "static" if not dates else f"{dates[0]} .. {dates[-1]} ({len(dates)})"
        print(f"{name:12} {s['rows']:>10,} {s['parts']:>6} {s['bytes']/2**20:>8.2f}  "
              f"{cov:32} {s['skipped']}")

def main(region: str = "full", pilot: bool = False):
    ee = _init()  # first, so a missing service-account key is the reported blocker
    # points.parquet is already region/pilot-scoped by step 2; args are informational.
    if not POINTS_PATH.is_file():
        raise SystemExit(f"missing input: {POINTS_PATH}; run step 2 (points.py) first")
    points = pd.read_parquet(POINTS_PATH)
    info, cells = probe(ee), _cells(points)  # fail on missing weather.py before bulk
    print(f"gee: {len(points)} points, {len(cells)} cells, region={region}, "
          f"pilot={pilot}, embedding years={info['embedding_years']}")
    jobs = [("embedding", _embedding(ee, info), points, "point_id", 10),
            ("eucropmap", _eucropmap(ee), points, "point_id", 10),
            ("modis_ndvi", _modis(ee, "NDVI"), points, "point_id", 250),
            ("modis_qa", _modis(ee, "SummaryQA"), points, "point_id", 250),
            ("hls_ndvi", _hls(ee), points, "point_id", 30),
            ("smap_sm", _smap(ee), cells, "cell_id", 9000),  # native SMAP 9 km grid
            ("soilgrids", _soil(ee), points, "point_id", 250),
            ("srtm", _srtm(ee), points, "point_id", 30)]
    stats = {j[0]: {"rows": 0, "parts": 0, "bytes": 0, "dates": set(), "skipped": 0}
             for j in jobs}
    for dataset, image, frame, key, scale in jobs:
        print(f"{dataset}: {len(frame)} {key}s, "
              f"{int((~_covered(dataset, len(frame))).sum())} uncached")
        _run_dataset(dataset, image, frame, key, ee, stats, scale)
    _report(stats)

def _self_check():
    frame = pd.DataFrame({"point_id": [f"p{i}" for i in range(4500)]})
    _req([len(c) for c in _chunks(frame.index.to_numpy(), 2000)] == [2000, 2000, 500],
         "chunk helper did not split 4500 points into 2000/2000/500")
    fixture = "system:index,point_id,A00_2017,A01_2017\n0,p1,0.5,\n1,p2,,\n"
    df = _parse(fixture, "embedding", "point_id")
    _req(list(df.columns) == ["point_id", "date_or_year", "variable", "value"],
         f"bad long columns: {list(df.columns)}")
    _req(str(df["point_id"].dtype) == "str" and str(df["date_or_year"].dtype) == "str"
         and str(df["variable"].dtype) == "str" and str(df["value"].dtype) == "float32",
         f"bad dtypes: {df.dtypes.to_dict()}")
    row = df.iloc[0]
    _req(len(df) == 1 and row["variable"] == "A00" and row["date_or_year"] == "2017"
         and abs(float(row["value"]) - 0.5) < 1e-6, "fixture CSV parsed wrongly")
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "part.parquet"
        _write_atomic(df, path)
        _req(path.is_file() and not list(Path(td).glob("*.tmp")),
             "atomic write left a .tmp file")
    print("self-check ok")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(prog="gee")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--region", default="full")
    ap.add_argument("--pilot", action="store_true")
    args = ap.parse_args()
    if args.self_check: _self_check()
    else: main(args.region, args.pilot)
