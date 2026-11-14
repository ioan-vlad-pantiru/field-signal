"""NUTS3 train/val/test split -> data/processed/splits.parquet; reports it on all kept points.

    venv/bin/python code/split.py
"""
from pathlib import Path

import polars as pl

OUT = Path("/home/jovyan/work/crop_rotation/data/processed")
CROPS = Path("/home/jovyan/work/crop_rotation/data/interim/crops.parquet")

TEST = {"RO121", "RO113", "RO125", "RO126", "RO423", "HU223", "BG312", "SK023", "HR027", "RS123", "AT121"}
VAL = {"RO422", "HU213", "BG311", "SK010", "RS125", "AT113", "HR025"}


def main():
    kept = pl.read_parquet(OUT / "kept_points.parquet").sort("point_id")
    present = set(kept["nuts3"].unique().to_list())
    print("listed nuts3 missing from kept points:", sorted((TEST | VAL) - present) or "none")

    split = kept.with_columns(
        pl.when(pl.col("nuts3").is_in(sorted(TEST))).then(pl.lit("test"))
        .when(pl.col("nuts3").is_in(sorted(VAL))).then(pl.lit("val"))
        .otherwise(pl.lit("train")).alias("split"))
    assert split.height == kept.height
    split.write_parquet(OUT / "splits.parquet")

    print("\npoints per split:")
    print(split.group_by("split").agg(pl.len().alias("points"))
          .with_columns((100 * pl.col("points") / split.height).round(2).alias("share_pct"))
          .sort("split"))
    print("\ncountry share within split (% of the split's points):")
    print(split.group_by("split", "country").len()
          .join(split.group_by("split").len().rename({"len": "total"}), on="split")
          .with_columns((100 * pl.col("len") / pl.col("total")).round(2).alias("pct"))
          .pivot(on="split", index="country", values="pct").sort("country").fill_null(0))
    print("\ncrop mix per split (% of the split's point-years):")
    crops = pl.read_parquet(CROPS).select("point_id", "year", "crop")
    py = split.select("point_id", "split").join(crops, on="point_id")
    print(py.group_by("split", "crop").len()
          .join(py.group_by("split").len().rename({"len": "total"}), on="split")
          .with_columns((100 * pl.col("len") / pl.col("total")).round(2).alias("pct"))
          .pivot(on="split", index="crop", values="pct").sort("crop").fill_null(0))


if __name__ == "__main__":
    main()
