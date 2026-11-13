"""Datasets and fetch pipelines."""

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2]
RAW = DATA_DIR / "raw"  # downloaded inputs (gitignored)
CACHE = DATA_DIR / "cache"  # derived outputs (gitignored)
