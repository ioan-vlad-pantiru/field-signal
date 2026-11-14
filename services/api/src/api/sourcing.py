"""The feed-buyer view: real numbers for Alba's communes when they have been built, demo otherwise.

`data/scripts/build_sourcing.py` computes a complete SourcingRegion from NASA POWER, MODIS,
EUCROPMAP, the APIA parcels and INS county yields, and writes it to `data/sourcing_alba.json`
next to this module. The API serves that file; without it (or for another season) it falls back
to the demo data, which says mock=true so the page shows its demo banner.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from api import mocks
from api.contracts import ImportOrigins, SourcingRegion

BUILT = Path(__file__).parent / "data" / "sourcing_alba.json"
ORIGINS = Path(__file__).parent / "data" / "origins.json"


@lru_cache
def _built(path: Path) -> SourcingRegion | None:
    if not path.is_file():
        return None
    return SourcingRegion.model_validate_json(path.read_text(encoding="utf-8"))


def sourcing_region(season: int | None = None) -> SourcingRegion:
    """The built region for its season (or when no season is asked), else the demo data."""
    built = _built(BUILT)
    if built is not None and (season is None or season == built.season):
        return built
    return mocks.sourcing_region(season or 2025)


@lru_cache
def import_origins() -> ImportOrigins:
    """Imported soy: the origins' seasons, built by `data/scripts/build_origins.py`."""
    return ImportOrigins.model_validate_json(ORIGINS.read_text(encoding="utf-8"))
