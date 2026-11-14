"""Build data/MANIFEST.md from files that actually exist. Never asserts a dataset."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

import schema

ROOT = Path(__file__).resolve().parents[1]
CORE = ("points.parquet", "crops.parquet", "strata_counts.parquet")
INVENTORY = "data/interim/hrl/inventory.parquet"


def _run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def _git(root):
    return _run(["git", "-C", str(root), "rev-parse", "HEAD"]) or "no git"


def _packages():
    req = Path(__file__).with_name("requirements.txt")
    return _run([sys.executable, "-m", "pip", "freeze"]) or (
        req.read_text().strip() if req.exists() else "unavailable")


def _size(files):
    n = sum(p.stat().st_size for p in files)
    return f"{n} bytes ({n / 1048576:.1f} MiB)"


def _paths(files, root):
    rel = ["`" + p.relative_to(root).as_posix() + "`" for p in files]
    return ", ".join(rel[:10]) + (f" … ({len(rel) - 10} more)" if len(rel) > 10 else "")


def _table(cols, rows):
    return "\n".join(["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
                     + ["| " + " | ".join(map(str, r)) + " |" for r in rows])


def _long_section(name, files, root):
    # shortcut: reads date/variable/value whole; stream row groups when parts get multi-GB
    tables = [pq.read_table(p, columns=["date_or_year", "variable", "value"]) for p in files]
    rows = sum(pq.ParquetFile(p).metadata.num_rows for p in files)
    dates, nulls, values = [], 0, []
    for t in tables:
        dates += [x for x in t.column("date_or_year").to_pylist() if x]
        nulls += t.column("value").null_count
        values += t.column("variable").to_pylist()
    # shortcut: lexicographic min/max on ISO YYYY[-MM-DD]; revisit if a dataset mixes formats
    rng = f"{min(dates)} .. {max(dates)}" if dates else "none (static only)"
    pct = (100.0 * nulls / rows) if rows else 0.0
    return "\n".join([
        f"### {name}", f"- paths: {_paths(files, root)}", f"- size: {_size(files)}",
        f"- rows: {rows}", f"- date/year range: {rng}",
        f"- distinct variables: {len(set(values))}",
        f"- missing `value`: {pct:.1f}% ({nulls}/{rows})"])


def _crops_section(path, root):
    crops = pd.read_parquet(path)
    n = len(crops)
    lines = ["### crops.parquet", f"- path: `{path.relative_to(root).as_posix()}`",
             f"- size: {_size([path])}", f"- rows: {n}"]
    for col in ("confidence", "purity_m250"):
        ok = crops[col].notna()
        lines.append(f"- {col} coverage (non-null): {100.0 * ok.mean():.1f}% ({ok.sum()}/{n})"
                     if n and col in crops else f"- {col} coverage (non-null): n/a")
    pts = root / "data/interim/points.parquet"
    if not pts.exists():
        lines.append("- crop counts per country/year: unavailable (points.parquet not present)")
        return "\n".join(lines)
    country = pd.read_parquet(pts, columns=["point_id", "country"])
    m = crops[["point_id", "year"]].merge(country, on="point_id", how="left")
    m["country"] = m["country"].fillna("(unknown)")
    g = m.groupby(["country", "year"]).size().reset_index(name="rows")
    lines += ["", _table(["country", "year", "rows"],
                         g.sort_values(["country", "year"]).itertuples(index=False))]
    return "\n".join(lines)


def _inventory_section(path, root):
    df = pq.read_table(path).to_pandas()
    cols = list(df.columns)
    lines = [f"- path: `{path.relative_to(root).as_posix()}`", f"- size: {_size([path])}",
             f"- rows: {len(df)}", f"- columns: {', '.join(cols)}"]
    year = "year" if "year" in cols else None
    # shortcut: inventory columns are not in the frozen schema; detect them until hrl.py fixes the shape
    product = next((c for c in ("product", "dataset", "collection") if c in cols), None)
    keys = [c for c in (year, product) if c]
    if keys:
        g = df.groupby(keys).size().reset_index(name="items")
        lines += ["", _table(keys + ["items"], g.itertuples(index=False))]
    else:
        lines.append("- years/items per product: no year or product column in inventory")
    access = [c for c in cols if "access" in c.lower()]
    if access:
        vals = sorted({str(v) for c in access for v in df[c].dropna().unique()})
        lines.append(f"- access dates: {', '.join(vals)}")
    else:
        lines.append("- access dates: not recorded in inventory")
    return "\n".join(lines)


def build(root, region, pilot):
    root = Path(root)
    raw = root / "data/raw"
    out = ["# Dataset manifest", "",
           f"Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')} from files "
           f"present under `data/` (region: {region}, pilot: {pilot}). Nothing here is asserted "
           "unless its file exists.", "", "## Provenance", f"- git commit: `{_git(root)}`"]
    params = root / "data/params.json"
    if params.exists():
        try:
            out.append(f"- analysis parameters (`data/params.json`): "
                       f"`{json.dumps(json.loads(params.read_text()), sort_keys=True)}`")
        except Exception as e:
            out.append(f"- analysis parameters (`data/params.json`): unreadable ({e})")
    else:
        out.append("- analysis parameters (`data/params.json`): not recorded")
    out += ["- deviation: `power` (weather) and `smap_sm` are keyed by `cell_id`, not "
            "`point_id`, because expanding to points would be ~10^10 rows.",
            "", "### Package versions", "```", _packages(), "```", ""]

    present, absent = [], []
    out.append("## Datasets")
    for ds in schema.DATASETS:
        files = sorted((raw / ds).glob("*.parquet"))
        if files:
            present.append(_long_section(ds, files, root))
        else:
            absent.append(f"`data/raw/{ds}/` ({ds})")
    out += ["\n\n".join(present) if present else "_none present_", ""]

    out.append("## Core tables")
    core = []
    for name in CORE:
        p = root / "data/interim" / name
        if not p.exists():
            absent.append(f"`data/interim/{name}`")
        elif name == "crops.parquet":
            core.append(_crops_section(p, root))
        else:
            core.append(f"### {name}\n- path: `{p.relative_to(root).as_posix()}`\n"
                        f"- size: {_size([p])}\n- rows: {pq.ParquetFile(p).metadata.num_rows}")
    out += ["\n\n".join(core) if core else "_none present_", ""]

    out.append("## HRL inventory")
    inv = root / INVENTORY
    if inv.exists():
        out.append("### inventory.parquet\n" + _inventory_section(inv, root))
    else:
        absent.append(f"`{INVENTORY}`")
        out.append("_not present_")
    out += ["", "## Not present", "\n".join(f"- {a}" for a in absent) if absent else "_none_", ""]
    return "\n".join(out)


def write_manifest(text, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o777)  # NFS: shared writers need group-writable dirs
    except OSError:
        pass
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)  # atomic on NFS


def main(region: str, pilot: bool):
    path = ROOT / "data/MANIFEST.md"
    write_manifest(build(ROOT, region, pilot), path)
    print(f"wrote {path}")


def self_check():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        d = root / "data/raw/modis_ndvi"
        d.mkdir(parents=True)
        pq.write_table(pa.table({
            "point_id": ["p1", "p2", "p3"],
            "date_or_year": ["2019-01-01", "2019-01-09", "2019-01-17"],
            "variable": ["NDVI", "NDVI", "SummaryQA"],
            "value": pa.array([0.1, None, 0.3], type=pa.float32()),
        }), d / "part-0.parquet")
        md = build(root, "alba", True)
        head, absent = md.split("## Not present")
        for needle in ("- rows: 3", "2019-01-01 .. 2019-01-17", "- distinct variables: 2",
                       "missing `value`: 33.3% (1/3)"):
            assert needle in head, (needle, md)
        assert all(x in absent for x in ("embedding", "smap_sm", "points.parquet")), absent
        out = root / "data/MANIFEST.md"
        write_manifest(md, out)
        assert out.read_text() == md
        print("self-check ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(prog="manifest")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--region", choices=("alba", "full"), default="full")
    ap.add_argument("--pilot", action="store_true")
    a = ap.parse_args()
    self_check() if a.self_check else main(a.region, a.pilot)
