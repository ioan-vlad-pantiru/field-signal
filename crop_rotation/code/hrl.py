"""Step 1: CDSE CLMS HRL Crop Types (CTY) + Confidence (CTYCL) -> inventory + tiles.

Verified 2026-11-13 on the live services: STAC search is anonymous and limit=1000
works; OData Products(<uuid>)/$value returns a ZIP, NOT a GeoTIFF; the STAC data
asset's alternate.https.href (.../Products(uuid)/Nodes(<name>)/Nodes(<name>.tif)/$value)
returns the GeoTIFF, so that is what we download.
"""
from __future__ import annotations

import argparse, os, shutil, tempfile, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

import numpy as np, pandas as pd, rasterio, requests
from shapely.geometry import shape
from shapely.ops import unary_union

import env, schema

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "interim" / "hrl"
TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
STAC_URL = "https://catalogue.dataspace.copernicus.eu/stac/search"
GISCO = "https://raw.githubusercontent.com/eurostat/Nuts2json/master/pub/v2/2021/4326/60M/nutsrg_{}.json"
COLLECTIONS = {
    "cty": "clms_vlcc_crop-types_europe_10m_yearly_v1",
    "ctycl": "clms_vlcc_crop-types-confidence-layer_europe_10m_yearly_v1",
}
YEARS = schema.HRL_YEARS
ALLOWED = set(schema.CROP_CODE_MAP) | set(schema.EXCLUDED_CODES)
COLUMNS = ["product_id", "year", "product", "tile_id", "href", "bytes", "access_date", "path"]
# NUTS level -> required codes for the full region (levels 0/1/2).
FULL = {0: {"RO", "HU", "BG", "HR", "SK"}, 1: {"AT1"}, 2: {"RS12"}}


def fetch_nuts(level):
    r = requests.get(GISCO.format(level), timeout=120)
    if r.status_code != 200:
        raise SystemExit(f"GISCO NUTS level {level}: HTTP {r.status_code}")
    return r.json()


def select_roi(region, levels):
    """Return (codes, geometries); a code missing from its level halts, no bbox fallback."""
    wanted = {3: {"RO121"}} if region == "alba" else FULL
    codes, geoms = [], []
    for level, ids in sorted(wanted.items()):
        if level not in levels:
            raise SystemExit(f"NUTS level {level} not loaded for region {region!r}")
        by_id = {f["properties"]["id"]: f["geometry"] for f in levels[level]["features"]}
        missing = ids - set(by_id)
        if missing:
            raise SystemExit(f"NUTS codes absent from level {level}: {sorted(missing)}")
        codes += sorted(ids)
        geoms += [by_id[code] for code in sorted(ids)]
    return codes, geoms


def _flat(coords):
    if isinstance(coords[0], (int, float)):
        yield coords
    else:
        for sub in coords:
            yield from _flat(sub)


def roi_bbox(geoms):
    pts = [p for g in geoms for p in _flat(g["coordinates"])]
    return [min(p[0] for p in pts), min(p[1] for p in pts),
            max(p[0] for p in pts), max(p[1] for p in pts)]


def atomic_write(path, write):
    """Write via <stem>.tmp then replace; removes the temp file on any failure."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.parent.chmod(0o777)
    tmp = path.with_suffix(".tmp")
    try:
        write(tmp)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


_AUTH = {}


def token(creds):
    """Single bearer token, refreshed shortly before the 1800 s expiry."""
    if _AUTH.get("exp", 0) < time.time() + 60:
        r = requests.post(TOKEN_URL, data={
            "client_id": "cdse-public", "grant_type": "password",
            "username": creds["username"], "password": creds["password"]}, timeout=60)
        if r.status_code != 200:
            raise SystemExit(f"CDSE token: HTTP {r.status_code}: {r.text[:300]}")
        body = r.json()
        _AUTH.update(token=body["access_token"], exp=time.time() + body["expires_in"])
    return _AUTH["token"]


def search(collection, bbox, year):
    # shortcut: one page only; the full ROI returns ~103 tiles/year/product, under
    # limit=1000. Add next-link paging if a future collection exceeds it.
    r = requests.post(STAC_URL, json={
        "collections": [collection], "bbox": bbox, "limit": 1000,
        "datetime": f"{year}-01-01T00:00:00Z/{year}-12-31T23:59:59Z"}, timeout=120)
    if r.status_code != 200:
        raise SystemExit(f"STAC {collection} {year}: HTTP {r.status_code}: {r.text[:300]}")
    return r.json().get("features", [])


def tif_href(item):
    try:
        return item["assets"]["data"]["alternate"]["https"]["href"]
    except KeyError:
        raise SystemExit(f"{item['id']}: no HTTPS GeoTIFF asset")


def _get_to(href, tok, dest):
    with requests.get(href, headers={"Authorization": f"Bearer {tok}"}, stream=True,
                      timeout=600) as r:
        if r.status_code != 200:
            raise SystemExit(f"GET {href}: HTTP {r.status_code}")
        with open(dest, "wb") as f:
            shutil.copyfileobj(r.raw, f)


def probe(href, tok):
    """Download exactly one item and prove it is a readable GeoTIFF with real data."""
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=OUT) as td:
        path = Path(td) / "probe.tif"
        _get_to(href, tok, path)
        size = path.stat().st_size
        try:
            with rasterio.open(path) as ds:
                ds.read(1, window=((0, 64), (0, 64)))  # exercise a windowed read
                # A 64x64 corner is legitimately all 0 ("no cropland"), verified on
                # tile E54N27, so non-emptiness is judged on a decimated full tile.
                thumb = ds.read(1, out_shape=(256, 256))
        except rasterio.errors.RasterioIOError as exc:
            raise SystemExit(f"probe {href}: HTTP 200 but not a readable GeoTIFF: {exc}")
    if not (thumb.size and np.any((thumb != 0) & (thumb != 65535))):
        raise SystemExit(f"probe {href}: readable GeoTIFF but no crop data")
    return size


def download(href, path, tok):
    # shortcut: no retry/backoff on transient 5xx; add when the bulk run shows flakes.
    if path.is_file() and path.stat().st_size > 0:
        return path.stat().st_size
    atomic_write(path, lambda tmp: _get_to(href, tok, tmp))
    return path.stat().st_size


def collect(bbox, roi):
    rows = []
    for year in YEARS:
        for product, collection in COLLECTIONS.items():
            # The bbox is a superset of the ROI (it spans all of Austria and Serbia),
            # so keep only tiles whose footprint actually touches the selected NUTS.
            items = [i for i in search(collection, bbox, year)
                     if shape(i["geometry"]).intersects(roi)]
            print(f"{year} {product}: {len(items)} items")
            for item in items:
                tile = item["properties"]["_private"]["cellID"]
                rows.append({
                    "product_id": item["id"], "year": year, "product": product,
                    "tile_id": tile, "href": tif_href(item), "bytes": 0,
                    "access_date": date.today().isoformat(),
                    "path": str(OUT / str(year) / product / f"{tile}.tif")})
    return rows


def legend_check(df):
    """The distinct CTY codes per year must stay inside the frozen contract."""
    for year in YEARS:
        sub = df[(df["year"] == year) & (df["product"] == "cty")]
        if sub.empty:
            continue
        codes = set()
        with rasterio.open(sub.iloc[0]["path"]) as ds:
            for y in range(0, ds.height, 1024):
                window = rasterio.windows.Window(0, y, ds.width, min(1024, ds.height - y))
                codes.update(int(v) for v in np.unique(ds.read(1, window=window)))
        print(f"{year} cty codes: {sorted(codes)}")
        bad = codes - ALLOWED
        if bad:
            raise SystemExit(f"{year}: CTY codes outside CROP_CODE_MAP|EXCLUDED_CODES: {sorted(bad)}")
    # shortcut: transition frequencies need both years' full co-registered masks;
    # not cheap inside a download step - recompute during analysis if required.
    print("legend: transition frequencies skipped (not cheap at this step)")


def main(region="alba", pilot=False):
    # shortcut: pilot is a no-op for rasters - region='alba' already bounds them;
    # shard by year/product if the pilot must download less.
    creds = env.load(["cdse"])["cdse"]
    levels = {lv: fetch_nuts(lv) for lv in ((3,) if region == "alba" else (0, 1, 2, 3))}
    codes, geoms = select_roi(region, levels)
    bbox = roi_bbox(geoms)
    print(f"region={region} pilot={pilot} nuts={codes} bbox={bbox}")

    rows = collect(bbox, unary_union([shape(g) for g in geoms]))
    if not rows:
        raise SystemExit("no STAC items returned for the ROI")
    tok = token(creds)
    print(f"probe: {rows[0]['product_id']} ({rows[0]['tile_id']})")
    size = probe(rows[0]["href"], tok)
    print(f"probe OK: {rows[0]['tile_id']} {size} bytes, readable GeoTIFF")

    OUT.mkdir(parents=True, exist_ok=True)
    OUT.chmod(0o777)
    errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(download, r["href"], Path(r["path"]), tok): r for r in rows}
        for future in as_completed(futures):
            try:
                futures[future]["bytes"] = future.result()
            except (SystemExit, requests.RequestException, OSError) as exc:
                errors.append(str(exc))
    if errors:
        raise SystemExit("download failures:\n" + "\n".join(errors))

    df = pd.DataFrame(rows, columns=COLUMNS)
    df["year"], df["bytes"] = df["year"].astype("int16"), df["bytes"].astype("int64")
    atomic_write(OUT / "inventory.parquet", lambda p: df.to_parquet(p, index=False))
    print(f"inventory: {OUT / 'inventory.parquet'} ({len(df)} rows)")

    legend_check(df)

    missing = []
    print("\nyear  product  items  bytes")
    for year in YEARS:
        for product in COLLECTIONS:
            sub = df[(df["year"] == year) & (df["product"] == product)]
            print(f"{year}  {product:6s}  {len(sub):5d}  {int(sub['bytes'].sum()):12d}")
            if sub.empty:
                missing.append(f"{year}/{product}")
    if missing:
        raise SystemExit("missing: " + ", ".join(missing))


def self_check():
    def sq(x0, y0, x1, y1):
        return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}

    specs = {
        0: {"RO": (20, 44, 26, 48), "HU": (16, 45.7, 22.9, 48.6), "BG": (22.3, 41.2, 28.6, 44.2),
            "HR": (13.5, 42.4, 19.4, 46.6), "SK": (16.8, 47.7, 22.6, 49.6)},
        1: {"AT1": (9.5, 46.4, 17.2, 49)},
        2: {"RS12": (18.9, 44.9, 21.6, 46.2)},
        3: {"RO121": (22.7, 45.5, 24.2, 46.6), "RO113": (23, 46.5, 24.5, 47.3)},
    }
    levels = {lv: {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": code}, "geometry": sq(*box)}
        for code, box in boxes.items()]} for lv, boxes in specs.items()}
    alba_codes, alba_geoms = select_roi("alba", levels)
    assert alba_codes == ["RO121"], alba_codes
    assert roi_bbox(alba_geoms) == [22.7, 45.5, 24.2, 46.6]
    full_codes, full_geoms = select_roi("full", levels)
    assert full_codes == ["BG", "HR", "HU", "RO", "SK", "AT1", "RS12"], full_codes
    assert roi_bbox(full_geoms) == [9.5, 41.2, 28.6, 49.6]

    with tempfile.TemporaryDirectory() as td:
        target = Path(td) / "out.parquet"
        atomic_write(target, lambda tmp: tmp.write_text("payload"))
        assert target.read_text() == "payload"
        assert not list(Path(td).glob("*.tmp")), "atomic_write left a .tmp file"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(prog="hrl")
    parser.add_argument("--region", choices=("alba", "full"), default="alba")
    parser.add_argument("--pilot", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        self_check()
        print("self-check OK")
    else:
        main(args.region, args.pilot)
