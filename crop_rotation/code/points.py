"""Step 2: scan HRL CTY/CTYCL, count strata, sample points. Contract: schema.py.
Eligibility filters the frame only; all years 2017-2024 are stored per point.
"""
import argparse, hashlib, math, multiprocessing as mp, os
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from urllib.request import urlretrieve
import numpy as np, pandas as pd, rasterio
from pyproj import Transformer
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds
from scipy import ndimage

CRS3035 = CRS.from_epsg(3035)
import schema
ROOT = Path(__file__).resolve().parents[1]
INTERIM = ROOT / "data" / "interim"
INVENTORY = INTERIM / "hrl" / "inventory.parquet"
NUTS_PATH = INTERIM / "nutsrg_3.json"
NUTS_URL = "https://raw.githubusercontent.com/eurostat/Nuts2json/master/pub/v2/2021/4326/60M/nutsrg_3.json"  # schema.py
BLOCK, GRID = 2048, 250.0
# NUTS0 countries in the ROI, plus NUTS1 AT1 (eastern Austria) and NUTS2 RS12 (Vojvodina).
FULL_COUNTRIES = {"RO", "HU", "BG", "HR", "SK"}
MODIS = "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs"
_TARGET = list(schema.TARGET_CROPS)
_CODE = {c: _TARGET.index(n) + 1 for c, n in schema.CROP_CODE_MAP.items() if n in _TARGET}
_LUT = np.zeros(65536, np.uint8)
for _c, _i in _CODE.items(): _LUT[_c] = _i
def write_atomic(df, path):
    """NFS quirk: tmp + os.replace; output dirs stay 0777."""
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    try: os.chmod(path.parent, 0o777)
    except OSError: pass  # not ours; to_parquet tests writability
    tmp = path.with_name(path.name + ".tmp"); tmp.unlink(missing_ok=True)  # stale tmp may be nobody-owned
    df.to_parquet(tmp, index=False); os.replace(tmp, path)
def eligible_block(cty):
    """(eligible bool, crop index); centre target and 3x3 class-uniform."""
    uniform = ndimage.minimum_filter(cty, 3, mode="nearest") == ndimage.maximum_filter(cty, 3, mode="nearest")
    idx = _LUT[cty]
    return uniform & (idx > 0), idx
def confidence_series(cl):
    """uint8 CTYCL -> nullable UInt8; sentinels 253/255 become NA."""
    s = pd.Series(np.asarray(cl, np.uint8).ravel()).astype("UInt8")
    s[np.isin(np.asarray(cl).ravel(), schema.CTYCL_SENTINELS)] = pd.NA
    return s
def quotas(counts, total):
    """Quota/shortfall per stratum; shortfalls are not redistributed.
    shortcut: a 1000-point pilot cannot fund the 2000 floor, so floors fall back
    to total//(2N) when they exceed the budget; upgrade if the budget changes."""
    n = len(counts); floor_q = max(2000, total // (2 * n))
    if floor_q * n > total: floor_q = max(1, total // (2 * n))
    q = {k: min(floor_q, e) for k, e in counts.items()}; short = {k: floor_q - q[k] for k in counts}
    rem = total - sum(q.values()); cap = {k: counts[k] - q[k] for k in counts}; add = {k: 0 for k in counts}
    if rem > 0 and sum(cap.values()) > 0:
        raw = {k: rem * c / sum(cap.values()) for k, c in cap.items()}
        add = {k: min(int(math.floor(v)), cap[k]) for k, v in raw.items()}; left = rem - sum(add.values())
        for k in sorted(raw, key=lambda k: (-(raw[k] - add[k]), -counts[k], k)):
            if left <= 0: break
            if add[k] < cap[k]: add[k] += 1; left -= 1
    return {k: q[k] + add[k] for k in q}, short
def pick(order, cells, used, want):
    chosen = []
    for i in order:
        if len(chosen) >= want: break
        if int(cells[i]) in used: continue
        used.add(int(cells[i])); chosen.append(int(i))
    return chosen
def _inventory():
    if not INVENTORY.is_file(): raise SystemExit(f"missing {INVENTORY}; run step1 (hrl.py) first")
    inv = pd.read_parquet(INVENTORY)
    if missing := {"product", "year", "tile_id", "path"} - set(inv.columns):
        raise SystemExit(f"{INVENTORY} lacks column(s): {', '.join(sorted(missing))}")
    def kind(p): p = str(p).lower(); return "conf" if "ctycl" in p or "confidence" in p else ("cls" if "cty" in p else None)
    inv["kind"] = inv["product"].map(kind)
    if inv["kind"].isna().any(): raise SystemExit(f"unrecognised HRL product(s): {sorted(inv.loc[inv['kind'].isna(), 'product'].unique())}")
    inv = inv[inv["year"].isin(schema.HRL_YEARS)]
    inv["path"] = inv["path"].map(lambda p: str(p) if os.path.isabs(str(p)) else str(ROOT / p))
    pairs = {}
    for (tile, year), g in inv.groupby(["tile_id", "year"], sort=True):
        if g["kind"].duplicated().any() or set(g["kind"]) != {"cls", "conf"}:
            raise SystemExit(f"tile {tile} year {year} lacks exactly one CTY and one CTYCL")
        paths = dict(zip(g["kind"], g["path"])); pairs[(str(tile), int(year))] = (paths["cls"], paths["conf"])
    if not pairs: raise SystemExit(f"{INVENTORY} has no HRL rows for {schema.HRL_YEARS[0]}-{schema.HRL_YEARS[-1]}")
    tiles = sorted({t for t, _ in pairs})
    for tile in tiles:
        if absent := [y for y in schema.HRL_YEARS if (tile, y) not in pairs]: raise SystemExit(f"tile {tile} lacks HRL year(s): {absent}")
    return pairs, tiles
def _load_nuts():
    if not schema.HOLDOUT_NUTS3: raise SystemExit("schema.HOLDOUT_NUTS3 is empty; refusing to guess holdouts")
    if not NUTS_PATH.is_file():
        tmp = NUTS_PATH.with_name(NUTS_PATH.name + ".tmp")
        try:
            NUTS_PATH.parent.mkdir(parents=True, exist_ok=True); os.chmod(NUTS_PATH.parent, 0o777); urlretrieve(NUTS_URL, tmp)
        except OSError as exc: raise SystemExit(f"missing {NUTS_PATH} and download failed ({exc}); fetch {NUTS_URL}")
        os.replace(tmp, NUTS_PATH)
    import geopandas as gpd
    gdf = gpd.read_file(NUTS_PATH, driver="GeoJSON"); gdf = gdf[gdf["id"].astype(str).str.len() == 5].to_crs("EPSG:3035")
    rows = [{"code": str(c), "country": str(c)[:2], "county": str(n) if str(c).startswith("RO") else "",
             "geom": g} for c, n, g in zip(gdf["id"], gdf["na"], gdf.geometry)]
    missing = sorted(set(schema.HOLDOUT_NUTS3) - {r["code"] for r in rows})
    if missing: raise SystemExit(f"HOLDOUT_NUTS3 not verified against {NUTS_PATH}: missing {missing}")
    countries = sorted({r["country"] for r in rows}); cid = {c: i for i, c in enumerate(countries)}
    for r in rows: r["ci"] = cid[r["country"]]
    return rows, countries
def _open(pairs, tile):
    stack = ExitStack(); cls = {y: stack.enter_context(rasterio.open(pairs[(tile, y)][0])) for y in schema.HRL_YEARS}
    conf = {y: stack.enter_context(rasterio.open(pairs[(tile, y)][1])) for y in schema.HRL_YEARS}; ref = cls[schema.HRL_YEARS[0]]
    for src in list(cls.values()) + list(conf.values()):
        if (src.width, src.height, src.transform) != (ref.width, ref.height, ref.transform):
            stack.close(); raise SystemExit(f"tile {tile}: raster grid differs across years/products")
        # 2017-2023 WKTs carry the EEA CRS but no resolvable EPSG authority, so
        # compare the CRS dict (verified equal to EPSG:3035 for every pilot tile)
        # rather than to_epsg(), which returns None for those years.
        if src.crs is not None and src.crs.to_dict() != CRS3035.to_dict():
            stack.close(); raise SystemExit(f"tile {tile}: expected EPSG:3035, got {src.crs}")
    # Belt and braces: if a tile ever ships with no CRS tag at all, the EEA grid origin
    # (a whole 100 km, as encoded in the tile id) plus 10 m resolution identify it, so
    # verify that and adopt EPSG:3035 rather than silently trusting an absent tag.
    t = ref.transform
    if ref.crs is None and (ref.res != (10.0, 10.0) or t.c % 100_000 or t.f % 100_000):
        stack.close(); raise SystemExit(f"tile {tile}: no CRS tag and grid does not match the EEA 100 km grid")
    return stack, cls, conf, ref
def _modal(cls, row, col, h, w):
    """Modal target crop (1..7) across years; ties keep the smaller index."""
    votes = np.zeros((len(_TARGET), h, w), np.uint8); win = Window(col - 1, row - 1, w + 2, h + 2)
    for src in cls.values():
        elig, idx = eligible_block(src.read(1, window=win, boundless=True, fill_value=0))
        idx = np.where(elig, idx, 0)[1:1 + h, 1:1 + w]
        for c in range(1, len(_TARGET) + 1): votes[c - 1] += idx == c
    return votes.argmax(0) + 1, votes.max(0) > 0
_CTX = {}  # fork-inherited worker context: pairs, nuts, keep


def _tile_candidates(tile):
    """Every eligible candidate in one tile, one per 250 m cell. Worker-safe (read-only)."""
    pairs, nuts_rows, keep = _CTX["pairs"], _CTX["nuts"], _CTX["keep"]
    stack, cls, _, ref = _open(pairs, tile)
    try:
        nr = rasterize([(r["geom"], i) for i, r in enumerate(nuts_rows) if r["geom"] is not None],
                       out_shape=(ref.height, ref.width), transform=ref.transform, fill=-1, dtype="int16")
        ci = np.array([r["ci"] for r in nuts_rows], np.int16)
        R, C, M, N = [], [], [], []
        for row in range(0, ref.height, BLOCK):
            for col in range(0, ref.width, BLOCK):
                h, w = min(BLOCK, ref.height - row), min(BLOCK, ref.width - col)
                modal, has = _modal(cls, row, col, h, w); sub = nr[row:row + h, col:col + w]
                # A 100 km tile straddles borders, so the scan sees neighbouring
                # countries too; `keep` is the only thing restricting it to the ROI.
                valid = has & (sub >= 0)
                if keep is not None: valid &= keep[np.maximum(sub, 0)]
                if not valid.any(): continue
                r0, c0 = np.nonzero(valid)
                R.append((r0 + row).astype(np.int32)); C.append((c0 + col).astype(np.int32))
                M.append(modal[r0, c0].astype(np.uint8)); N.append(sub[r0, c0].astype(np.int16))
        if not R: return None
        rows, cols, modal, nidx = (np.concatenate(a) for a in (R, C, M, N))
        keys = ci[nidx].astype(np.int64) * 8 + modal
        t = ref.transform
        xs = t.c + (cols + 0.5) * t.a; ys = t.f + (rows + 0.5) * t.e
        sx, sy = Transformer.from_crs(CRS3035, MODIS, always_xy=True).transform(xs, ys)
        cell = np.floor(sx / GRID).astype(np.int64) * 10_000_000 + np.floor(sy / GRID).astype(np.int64)
        _, keep = np.unique(cell, return_index=True)  # one candidate per 250 m cell
        return {"tile": tile, "rows": rows[keep], "cols": cols[keep], "modal": modal[keep],
                "nidx": nidx[keep], "keys": keys[keep], "cell": cell[keep],
                "xs": xs[keep], "ys": ys[keep], "sx": sx[keep], "sy": sy[keep]}
    finally: stack.close()
def _modis_frame(ref):
    b = transform_bounds(CRS3035, MODIS, *ref.bounds, densify_pts=21)
    left, bottom, right, top = (math.floor(b[0] / GRID) * GRID, math.floor(b[1] / GRID) * GRID,
                                math.ceil(b[2] / GRID) * GRID, math.ceil(b[3] / GRID) * GRID)
    return from_origin(left, top, GRID, GRID), (int((top - bottom) / GRID), int((right - left) / GRID)), left, top
def _purity(cty, ref, mleft, mtop, mrow, mcol, code):
    """Fraction of one 250 m cell covered by `code`, from this tile only.

    Reads only the cell's source footprint. The old full-tile warp (one per tile-year-crop)
    dominated the run while producing a handful of values.
    shortcut: cells straddling a tile edge are undercounted; needs neighbour tiles to fix.
    """
    x0, x1 = mleft + mcol * GRID, mleft + (mcol + 1) * GRID
    y0, y1 = mtop - (mrow + 1) * GRID, mtop - mrow * GRID
    b = transform_bounds(MODIS, CRS3035, x0, y0, x1, y1, densify_pts=21)
    tb = ref.bounds
    xl, yb = max(b[0], tb.left), max(b[1], tb.bottom)
    xr, yt = min(b[2], tb.right), min(b[3], tb.top)
    if xr <= xl or yt <= yb: return None
    win = from_bounds(xl, yb, xr, yt, ref.transform).round_offsets().round_lengths()
    c0, r0 = max(0, int(win.col_off)), max(0, int(win.row_off))
    w, h = min(int(win.width), ref.width - c0), min(int(win.height), ref.height - r0)
    if w <= 0 or h <= 0: return None
    src = cty[r0:r0 + h, c0:c0 + w]; st = ref.window_transform(Window(c0, r0, w, h))
    dt = from_origin(x0, y1, GRID, GRID)
    num = np.zeros((1, 1), np.float32); den = np.zeros((1, 1), np.float32)
    reproject((src == code).astype(np.uint8), num, src_transform=st, src_crs=CRS3035,
              dst_transform=dt, dst_crs=MODIS, resampling=Resampling.sum)
    reproject(np.ones(src.shape, np.uint8), den, src_transform=st, src_crs=CRS3035,
              dst_transform=dt, dst_crs=MODIS, resampling=Resampling.sum)
    return float(num[0, 0] / den[0, 0]) if den[0, 0] > 0 else None
def _tile_crop_rows(job):
    """Worker-safe: point rows and crop rows for the candidates chosen in one tile."""
    tile, sel = job
    stack, cls, conf, ref = _open(_CTX["pairs"], tile)
    try:
        _, mshape, mleft, mtop = _modis_frame(ref)
        rows, cols, modal = sel["rows"], sel["cols"], sel["modal"]
        xs, ys, sx, sy = sel["xs"], sel["ys"], sel["sx"], sel["sy"]
        mrow = np.clip(((mtop - sy) / GRID).astype(int), 0, mshape[0] - 1)
        mcol = np.clip(((sx - mleft) / GRID).astype(int), 0, mshape[1] - 1)
        lon, lat = Transformer.from_crs(CRS3035, "EPSG:4326", always_xy=True).transform(xs, ys)
        nuts = _CTX["nuts"]
        point_rows = [{"point_id": f"{tile}_{r}_{c}", "lon": float(x), "lat": float(y),
                       "country": nuts[i]["country"], "nuts3": nuts[i]["code"],
                       "county": nuts[i]["county"], "holdout": nuts[i]["code"] in schema.HOLDOUT_NUTS3,
                       "cell_id": "", "modal_crop": _TARGET[int(mo) - 1], "inclusion_probability": 0.0}
                      for r, c, mo, i, x, y in zip(rows, cols, modal, sel["nidx"], lon, lat)]
        crop_rows = []
        for y in schema.HRL_YEARS:
            cty, ccl = cls[y].read(1), conf[y].read(1); codes = cty[rows, cols]
            for i in range(len(rows)):
                code = int(codes[i]); ci = _CODE.get(code)
                crop, flags = (("non_crop", "outside") if code == 65535 else
                               (schema.CROP_CODE_MAP[code], "none") if code in schema.CROP_CODE_MAP else
                               ("non_crop", "non_crop"))
                purity = _purity(cty, ref, mleft, mtop, int(mrow[i]), int(mcol[i]), code) if ci else None
                crop_rows.append({"point_id": f"{tile}_{rows[i]}_{cols[i]}", "year": y, "crop": crop,
                                  "confidence": int(ccl[rows[i], cols[i]]),
                                  "purity_m250": purity, "flags": flags})
        return point_rows, crop_rows
    finally: stack.close()
def _frames(point_rows, crop_rows):
    points = pd.DataFrame(point_rows, columns=list(schema.POINTS_COLUMNS)).astype(schema.POINTS_COLUMNS)
    crops = pd.DataFrame(crop_rows, columns=list(schema.CROPS_COLUMNS))
    crops["confidence"] = confidence_series(crops["confidence"]); crops["purity_m250"] = pd.array(crops["purity_m250"], dtype="Float32")
    return points, crops.astype({k: d for k, d in schema.CROPS_COLUMNS.items() if k not in ("confidence", "purity_m250")})
def main(region="full", pilot=False):
    pairs, tiles = _inventory(); nuts_rows, countries = _load_nuts()
    if region == "alba":
        code = next(c for c, n in schema.HOLDOUT_NUTS3.items() if n == "Alba")
        keep = np.array([r["code"] == code for r in nuts_rows])
    elif region == "full":
        keep = np.array([r["country"] in FULL_COUNTRIES or r["code"].startswith(("AT1", "RS12"))
                         for r in nuts_rows], dtype=bool)
    else: raise SystemExit(f"unknown region {region!r}")
    if not keep.any(): raise SystemExit(f"region {region!r}: no NUTS3 region kept")
    counts = Counter()
    _CTX.update(pairs=pairs, nuts=nuts_rows, keep=keep)
    workers = int(os.environ.get("POINTS_WORKERS") or min(16, os.cpu_count() or 1))
    ctx = mp.get_context("fork")  # workers inherit _CTX
    print(f"pass A: scanning {len(tiles)} tiles on {workers} workers")
    with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as ex:
        cands = [c for c in ex.map(_tile_candidates, tiles) if c is not None]
    if not cands: raise SystemExit(f"no eligible points in region {region!r}; refusing empty outputs")
    for c in cands:
        for k, n in zip(*np.unique(c["keys"], return_counts=True)): counts[int(k)] += int(n)
    total = 1000 if pilot else 300_000; qmap, shortfall = quotas(counts, total)
    print(f"pass A: {len(tiles)} tiles, {sum(counts.values())} eligible, {len(counts)} strata")
    rows = [{"country": countries[k // 8], "crop": _TARGET[k % 8 - 1], "n_eligible": counts[k],
             "quota": qmap[k], "sampled": 0, "shortfall": shortfall[k]} for k in sorted(counts)]
    strata = INTERIM / "strata_counts.parquet"; write_atomic(pd.DataFrame(rows, columns=list(schema.STRATA_COLUMNS)), strata)
    print(f"quotas: {sum(qmap.values())} points, {sum(shortfall.values())} shortfall-slots")
    used, sampled, jobs = set(), {}, []
    for c in sorted(cands, key=lambda c: c["tile"]):
        rng = np.random.default_rng(int.from_bytes(hashlib.sha256(c["tile"].encode()).digest()[:8], "big"))
        sel = []
        for k in sorted(qmap):
            want = qmap[k] - sampled.get(k, 0); cand = np.nonzero(c["keys"] == k)[0]
            if want <= 0 or not len(cand): continue
            chosen = pick(cand[rng.permutation(len(cand))], c["cell"], used, want)
            sel.extend(chosen); sampled[k] = sampled.get(k, 0) + len(chosen)
        if sel:
            idx = np.array(sorted(sel))
            jobs.append((c["tile"], {k: c[k][idx] for k in ("rows", "cols", "modal", "nidx", "xs", "ys", "sx", "sy")}))
    del cands
    point_rows, crop_rows = [], []
    with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as ex:
        for p, c in ex.map(_tile_crop_rows, jobs):
            point_rows.extend(p); crop_rows.extend(c)
    if not point_rows: raise SystemExit("sampling produced no points; refusing empty outputs")
    for r, k in zip(rows, sorted(counts)):
        r["sampled"] = int(sampled.get(k, 0)); r["shortfall"] = max(0, r["quota"] - r["sampled"])
    probs = {k: min(1.0, sampled.get(k, 0) / counts[k]) for k in counts}
    for pr in point_rows: pr["inclusion_probability"] = probs[countries.index(pr["country"]) * 8 + _TARGET.index(pr["modal_crop"]) + 1]
    points, crops = _frames(point_rows, crop_rows)
    write_atomic(points, INTERIM / "points.parquet"); write_atomic(crops, INTERIM / "crops.parquet")
    write_atomic(pd.DataFrame(rows, columns=list(schema.STRATA_COLUMNS)), strata)
    print(f"pass B: {len(points)} points, {len(crops)} point-years")
    return points, crops
def _cell_key(lon, lat):
    """Global 250 m MODIS cell key, the same integer _tile_candidates assigns."""
    sx, sy = Transformer.from_crs("EPSG:4326", MODIS, always_xy=True).transform(
        np.asarray(lon, float), np.asarray(lat, float))
    return np.floor(sx / GRID).astype(np.int64) * 10_000_000 + np.floor(sy / GRID).astype(np.int64)


def extend(total=300_000):
    """Append points for the NUTS3 the first wave under-covered.

    Append-only: cached raw data is addressed by row position, so existing rows must keep
    their order and none may be dropped. Targets are proportional to eligible candidates
    per NUTS3, which fills the eastern regions the tile-order quota never reached.
    """
    old_p = pd.read_parquet(INTERIM / "points.parquet")
    old_c = pd.read_parquet(INTERIM / "crops.parquet")
    pairs, tiles = _inventory(); nuts_rows, countries = _load_nuts()
    keep = np.array([r["country"] in FULL_COUNTRIES or r["code"].startswith(("AT1", "RS12"))
                     for r in nuts_rows], dtype=bool)
    _CTX.update(pairs=pairs, nuts=nuts_rows, keep=keep)
    workers = int(os.environ.get("POINTS_WORKERS") or min(16, os.cpu_count() or 1))
    ctx = mp.get_context("fork")
    print(f"extend: scanning {len(tiles)} tiles on {workers} workers")
    with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as ex:
        cands = [c for c in ex.map(_tile_candidates, tiles) if c is not None]
    if not cands: raise SystemExit("extend: no eligible candidates")
    per_nuts, per_stratum = Counter(), Counter()
    for c in cands:
        for i, n in zip(*np.unique(c["nidx"], return_counts=True)):
            per_nuts[nuts_rows[int(i)]["code"]] += int(n)
        for k, n in zip(*np.unique(c["keys"], return_counts=True)):
            per_stratum[int(k)] += int(n)
    have = Counter(old_p["nuts3"])
    elig_total = sum(per_nuts.values())
    left = {k: max(0, int(round(total * v / elig_total)) - have.get(k, 0)) for k, v in per_nuts.items()}
    print(f"extend: {len(per_nuts)} NUTS3 with candidates, {sum(left.values())} points to add")
    used = set(_cell_key(old_p["lon"].to_numpy(), old_p["lat"].to_numpy()).tolist())  # no 250 m duplicates
    jobs = []
    for c in sorted(cands, key=lambda c: c["tile"]):
        rng = np.random.default_rng(int.from_bytes(hashlib.sha256(c["tile"].encode()).digest()[:8], "big"))
        sel = []
        for i in np.unique(c["nidx"]):
            code = nuts_rows[int(i)]["code"]; want = left[code]
            if want <= 0: continue
            cand = np.nonzero(c["nidx"] == i)[0]
            chosen = pick(cand[rng.permutation(len(cand))], c["cell"], used, want)
            sel.extend(chosen); left[code] = want - len(chosen)
        if sel:
            idx = np.array(sorted(sel))
            jobs.append((c["tile"], {k: c[k][idx] for k in ("rows", "cols", "modal", "nidx", "xs", "ys", "sx", "sy")}))
    del cands
    point_rows, crop_rows = [], []
    with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as ex:
        for p, c in ex.map(_tile_crop_rows, jobs):
            point_rows.extend(p); crop_rows.extend(c)
    if not point_rows: raise SystemExit("extend produced no points; refusing to write")
    new_p, new_c = _frames(point_rows, crop_rows)
    points = pd.concat([old_p, new_p], ignore_index=True).astype(schema.POINTS_COLUMNS)
    crops = pd.concat([old_c, new_c], ignore_index=True)
    if not points.iloc[:len(old_p)].reset_index(drop=True).equals(old_p.reset_index(drop=True)):
        raise SystemExit("extend: existing rows changed; refusing to write (cache is row-addressed)")
    done = Counter(zip(points["country"], points["modal_crop"]))
    cid = {c: i for i, c in enumerate(countries)}
    probs = {k: min(1.0, done[(countries[k // 8], _TARGET[k % 8 - 1])] / n)
             for k, n in per_stratum.items() if n}
    points["inclusion_probability"] = [probs[cid[c] * 8 + _TARGET.index(m) + 1]
                                       for c, m in zip(points["country"], points["modal_crop"])]
    qmap, short = quotas(per_stratum, total)
    rows = [{"country": countries[k // 8], "crop": _TARGET[k % 8 - 1], "n_eligible": per_stratum[k],
             "quota": qmap[k], "sampled": done[(countries[k // 8], _TARGET[k % 8 - 1])],
             "shortfall": max(0, qmap[k] - done[(countries[k // 8], _TARGET[k % 8 - 1])])}
            for k in sorted(per_stratum)]
    strata = pd.DataFrame(rows, columns=list(schema.STRATA_COLUMNS))
    write_atomic(strata, INTERIM / "strata_counts.parquet")
    write_atomic(points, INTERIM / "points.parquet"); write_atomic(crops, INTERIM / "crops.parquet")
    print(f"extend: {len(new_p)} points added, {len(points)} total, {len(per_nuts)} NUTS3 covered")
    return points


def _self_check():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        cty = np.zeros((300, 300), np.uint16)
        cty[100:103, 100:103] = 1110; cty[150:153, 150:153] = 1120; cty[151, 151] = 1110
        elig, idx = eligible_block(cty)
        assert elig[101, 101] and idx[101, 101] == 1, "uniform target 3x3 must be eligible"
        assert not elig[150:153, 150:153].any(), "mixed 3x3 must not be eligible"
        cl = np.zeros((300, 300), np.uint8); cl[0, 0], cl[0, 1], cl[0, 2] = 253, 255, 42
        s = confidence_series(cl); assert pd.isna(s.iloc[0]) and pd.isna(s.iloc[1]) and s.iloc[2] == 42, "253/255 must be null"
        q, short = quotas({1: 100_000, 2: 5}, 300_000)
        assert q[1] >= 75_000 and q[1] <= 100_000 and q[2] == 5 and short[2] == 75_000 - 5, "floor/shortfall"
        assert sum(q.values()) <= 300_000
        cells = [7, 7, 8, 9, 9]; assert [cells[i] for i in pick(np.arange(5), cells, set(), 3)] == [7, 8, 9], "spacing"
        # Region mask: a 100 km tile straddles borders, so neighbours must be excluded.
        meta = [{"code": "RO121", "country": "RO"}, {"code": "AT130", "country": "AT"},
                {"code": "AT221", "country": "AT"}, {"code": "RS121", "country": "RS"},
                {"code": "ME000", "country": "ME"}, {"code": "CZ020", "country": "CZ"}]
        keep = [r["country"] in FULL_COUNTRIES or r["code"].startswith(("AT1", "RS12")) for r in meta]
        assert keep == [True, True, False, True, False, False], f"ROI mask wrong: {keep}"
        tif = Path(td) / "cty.tif"
        with rasterio.open(tif, "w", driver="GTiff", width=300, height=300, count=1, dtype="uint16",
                           crs="EPSG:3035", transform=from_origin(4_000_000, 2_000_000, 10, 10)) as dst: dst.write(cty, 1)
        with rasterio.open(tif) as src:
            block = src.read(1, window=Window(98, 98, 7, 7), boundless=True, fill_value=0)
            assert eligible_block(block)[0][3, 3], "haloed window read must preserve the block"
            _, _, mleft, mtop = _modis_frame(src)
            full = np.full((src.height, src.width), 1110, np.uint16)
            assert _purity(full, src, mleft, mtop, 4, 4, 1110) == 1.0, "uniform cell must be fully covered"
            assert _purity(full, src, mleft, mtop, 4, 4, 1120) == 0.0, "absent code must score 0"
        out = Path(td) / "sub" / "x.parquet"; write_atomic(pd.DataFrame({"a": [1]}), out)
        assert out.exists() and not out.with_name("x.parquet.tmp").exists(), "no .tmp left"
        assert pd.read_parquet(out)["a"].iloc[0] == 1
    print("self-check ok")
if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="points.py"); parser.add_argument("--self-check", action="store_true")
    parser.add_argument("--region", choices=("alba", "full"), default="full"); parser.add_argument("--pilot", action="store_true")
    parser.add_argument("--extend", action="store_true")
    args = parser.parse_args()
    if args.self_check: _self_check()
    elif args.extend: extend()
    else: main(args.region, args.pilot)
