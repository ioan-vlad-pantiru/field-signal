import polars as pl
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "hls_ndvi"
INTERIM = ROOT / "data" / "interim"
DOCS = ROOT / "docs"
TARGET = ["wheat", "barley", "maize", "sunflower", "soybeans", "dry_pulses", "rapeseed"]
VOCAB = set(TARGET) | {"other", "non_crop"}
N_POINTS, N_HLS_MONTHS = 299_987, 130


def md(df):
    rows = df.write_csv(separator="|").splitlines()
    sep = "|" + "|".join(["---"] * df.width) + "|"
    return "\n".join(["|" + rows[0] + "|", sep] + ["|" + r + "|" for r in rows[1:]])


def run(name, fn, *args):
    try:
        return fn(*args)
    except Exception as e:
        raise RuntimeError(f"[{name}] {e}") from e


def load():
    pts = pl.read_parquet(INTERIM / "points.parquet")
    cr = pl.read_parquet(INTERIM / "crops.parquet")
    assert pts.height == N_POINTS, pts.height
    assert pts["point_id"].n_unique() == N_POINTS
    assert cr.height == N_POINTS * 8, cr.height
    assert set(cr["crop"].unique()) == VOCAB, set(cr["crop"].unique())
    assert set(cr["year"].unique()) == set(range(2017, 2025))
    return pts, cr


def sec1(pts):
    country = pts.group_by("country").agg(pl.len().alias("points")).sort(["points", "country"], descending=[True, False])
    nuts = (pts.lazy().group_by("nuts3")
            .agg(pl.len().alias("points"),
                 pl.col("cell_id").n_unique().alias("cells touching this unit"))
            .sort(["points", "nuts3"], descending=[True, False]).collect())
    assert country.height == 7
    assert nuts.height == 100
    assert country["points"].sum() == pts.height == nuts["points"].sum()
    counties = (pts.filter(pl.col("county") != "").group_by("county")
                .agg(pl.len().alias("points")).sort(["points", "county"], descending=[True, False]))
    assert counties.height == 10
    return country, nuts, counties


def sec2(pts, cr):
    mix = (cr.lazy().select("point_id", "crop")
           .join(pts.lazy().select("point_id", "nuts3"), on="point_id", how="left")
           .group_by(["nuts3", "crop"]).agg(pl.len().alias("n"))
           .with_columns((pl.col("n") / pl.col("n").sum().over("nuts3")).alias("share")))
    chk = mix.collect()
    assert chk["nuts3"].null_count() == 0
    sums = chk.group_by("nuts3").agg(pl.col("share").sum().alias("s"))
    assert (sums["s"] - 1).abs().max() < 1e-6, (sums["s"] - 1).abs().max()
    wide = (chk.with_columns(pl.col("share").round(4))
            .pivot(on="crop", index="nuts3", values="share", aggregate_function="first")
            .fill_null(0.0)
            .select(["nuts3"] + TARGET + ["other", "non_crop"])
            .sort("nuts3"))
    assert wide.height == 100
    return wide


def build_presence(pts):
    cal = pl.DataFrame({"date": pl.date_range(date(2016, 1, 1), date(2026, 10, 1), interval="1mo", eager=True)})
    assert cal.height == N_HLS_MONTHS
    obs = pl.scan_parquet(str(RAW / "*.parquet")).select(
        "point_id", pl.col("date_or_year").str.to_date().alias("date"))
    pres = (pts.lazy().select("point_id", "nuts3").join(cal.lazy(), how="cross")
            .join(obs.with_columns(pl.lit(1, dtype=pl.UInt8).alias("present")),
                  on=["point_id", "date"], how="left")
            .with_columns(pl.col("present").fill_null(0).cast(pl.UInt8))
            .collect(engine="streaming"))
    assert pres.height == N_POINTS * N_HLS_MONTHS, pres.height
    assert set(pres["present"].unique().to_list()) == {0, 1}
    out = pres.select("point_id",
                      pl.col("date").dt.year().cast(pl.Int16).alias("year"),
                      pl.col("date").dt.month().cast(pl.UInt8).alias("month"),
                      "present")
    out.write_parquet(INTERIM / "hls_presence.parquet")
    assert pl.scan_parquet(INTERIM / "hls_presence.parquet").select(pl.len()).collect().item() == N_POINTS * N_HLS_MONTHS
    return pres


def sec3(pts, cr, pres):
    cn = (cr.lazy().select("point_id", "crop", "confidence")
          .join(pts.lazy().select("point_id", "nuts3"), on="point_id", how="left"))
    labels = (cn.group_by("nuts3")
              .agg((pl.col("confidence").null_count() / pl.len()).alias("null_conf_share"),
                   (pl.col("crop").is_in(["other", "non_crop"]).sum() / pl.len()).alias("other_non_crop_share"))
              .join(cn.filter(pl.col("crop").is_in(TARGET)).group_by("nuts3")
                    .agg(pl.col("confidence").mean().alias("mean_confidence_target")),
                    on="nuts3", how="left")
              .collect())
    assert labels["mean_confidence_target"].null_count() == 0

    m = (pres.lazy()
         .with_columns(pl.col("date").dt.strftime("%m").alias("month"))
         .filter(pl.col("date").dt.year().is_between(2017, 2024))
         .group_by(["nuts3", "month"])
         .agg((1 - pl.col("present").mean()).alias("missing"), pl.len().alias("n"))
         .collect(engine="streaming"))
    assert m["month"].n_unique() == 12
    pc = pts.group_by("nuts3").agg(pl.len().alias("points"))
    chk = m.join(pc, on="nuts3")
    assert (chk["n"] == chk["points"] * 8).all(), "month denominator is not 8 per point-month"
    wide = (m.select("nuts3", "month", pl.col("missing").round(4))
            .pivot(on="month", index="nuts3", values="missing", aggregate_function="first")
            .sort("nuts3"))
    assert wide.height == 100 and wide.width == 13
    months = [f"{i:02d}" for i in range(1, 13)]
    table = (labels.join(pc, on="nuts3", how="left").join(wide, on="nuts3", how="left")
             .select(["nuts3", "points", "mean_confidence_target", "null_conf_share",
                      "other_non_crop_share"] + months)
             .sort("nuts3")
             .with_columns(pl.col("mean_confidence_target").round(2),
                           pl.col("null_conf_share").round(4),
                           pl.col("other_non_crop_share").round(4)))
    assert table.height == 100

    full = (pres.lazy()
            .with_columns(pl.col("date").dt.strftime("%m").alias("month"))
            .group_by("month").agg((1 - pl.col("present").mean()).alias("missing"))
            .sort("month").collect(engine="streaming"))
    overall = 1 - pres["present"].mean()
    jan26 = pres.filter(pl.col("date") == date(2026, 1, 1))["present"].mean()
    return table, full, overall, jan26


def sec4(cr):
    # shortcut: shift windows assume consecutive years; the 1,799,922 self-check catches any gap.
    seq = (cr.lazy().sort(["point_id", "year"])
           .with_columns(pl.col("crop").shift(-1).over("point_id").alias("c1"),
                         pl.col("crop").shift(-2).over("point_id").alias("c2"))
           .filter(pl.col("c1").is_not_null(), pl.col("c2").is_not_null())
           .with_columns(pl.concat_str(["crop", "c1", "c2"], separator=" > ").alias("sequence")))
    n = seq.select(pl.len()).collect().item()
    assert n == N_POINTS * 6, n
    top = (seq.group_by("sequence").agg(pl.len().alias("count"))
           .sort(["count", "sequence"], descending=[True, False]).head(20).collect())
    assert top.height == 20
    top_contains = top.filter(pl.col("sequence").str.contains("dry_pulses|soybeans")).height
    any_share = seq.select(
        (pl.col("crop").is_in(["dry_pulses", "soybeans"])
         | pl.col("c1").is_in(["dry_pulses", "soybeans"])
         | pl.col("c2").is_in(["dry_pulses", "soybeans"])).mean().alias("s")).collect().item()
    return top, top_contains, any_share, n


pts, cr = run("load inputs", load)
country, nuts, counties = run("1. geography", sec1, pts)
mix = run("2. crop mix", sec2, pts, cr)
pres = run("hls presence", build_presence, pts)
table, full, overall, jan26 = run("3. confidence/labels/NDVI", sec3, pts, cr, pres)
top, top_contains, any_share, n_seq = run("4. sequences", sec4, cr)

months = [f"{i:02d}" for i in range(1, 13)]
full_vals = dict(zip(full["month"].to_list(), full["missing"].to_list()))
full_txt = ", ".join(f"{m}={full_vals[m]:.4f}" for m in months)
footnote = (f"Full 130-month range (2016-01→2026-10), missing share by month: {full_txt}; "
            f"overall {overall:.4f}. 2026-01 is a provider outage (only {jan26:.4f} of expected observations present); "
            "2016 and 2025–2026 carry no labels (labels span 2017–2024).")

report = "\n".join([
    "# Crop-rotation EDA", "",
    "## 1. Geography", "",
    "### Points per country", "", md(country), "",
    "### Points per NUTS3", "", md(nuts), "",
    "### Appendix: Romanian counties (county non-empty)", "", md(counties), "",
    "## 2. Crop mix per NUTS3, 2017–2024 (share of point-years, rows sum to 1.00)", "",
    md(mix), "",
    "## 3. Per-NUTS3 confidence, labels and HLS NDVI coverage", "",
    md(table), "",
    "Note: `flags` only takes `none` and `non_crop`, duplicating the crop value; it is not tabulated.", "",
    footnote, "",
    "## 4. Most frequent 3-year crop sequences", "",
    md(top), "",
    f"Of the 20 most frequent sequences, {top_contains} contain `dry_pulses` or `soybeans`; "
    f"{any_share:.4f} of all {n_seq:,} sequence instances contain either.", "",
])

DOCS.mkdir(parents=True, exist_ok=True)
(DOCS / "eda_report.md").write_text(report)
print("wrote", DOCS / "eda_report.md", len(report), "bytes")
