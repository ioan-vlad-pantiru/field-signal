"""Load and sanity-check the crop knowledge base in `data/crops.toml`.

    from farm_data.crops import load_crops
    kb = load_crops()
    kb.crops["maize"].flowering  # (date(2001, 7, 10), date(2001, 8, 5)) style via .window(year)

Run directly to validate the file:

    uv run --package farm-data python -m farm_data.crops
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

CROPS_PATH = Path(__file__).resolve().parents[2] / "crops.toml"
CONFIDENCE = {"high", "medium", "low"}


@dataclass(frozen=True)
class Crop:
    id: str
    name_ro: str
    name_en: str
    family: str
    season_type: str
    sowing: tuple[str, str] | None
    flowering: tuple[str, str] | None
    harvest: tuple[str, str] | None
    nitrogen_fixing: bool
    confidence: str
    review: bool
    raw: dict[str, Any] = field(repr=False)

    def window(self, name: str, season: int) -> tuple[date, date] | None:
        """Concrete dates of a window for a harvest-year `season`.

        Winter crops are sown in the previous calendar year.
        """
        w = getattr(self, name)
        if not w:
            return None
        start, end = (_md(season, s) for s in w)
        if name == "sowing" and self.season_type == "winter":
            start, end = start.replace(year=season - 1), end.replace(year=season - 1)
        return start, end


@dataclass(frozen=True)
class KnowledgeBase:
    version: str
    crops: dict[str, Crop]
    quality: dict[str, dict[str, Any]]
    rotation: dict[str, Any]


def _md(year: int, mmdd: str) -> date:
    month, day = (int(x) for x in mmdd.split("-"))
    return date(year, month, day)


def _pair(v: Any) -> tuple[str, str] | None:
    if not v:
        return None
    if not (isinstance(v, list) and len(v) == 2):
        raise ValueError(f"window must be [MM-DD, MM-DD], got {v!r}")
    _md(2001, v[0]), _md(2001, v[1])  # validates format
    return v[0], v[1]


def load_crops(path: Path = CROPS_PATH) -> KnowledgeBase:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    crops: dict[str, Crop] = {}
    for cid, c in data["crops"].items():
        if c.get("confidence") not in CONFIDENCE:
            raise ValueError(f"{cid}: confidence must be one of {CONFIDENCE}")
        crops[cid] = Crop(
            id=cid,
            name_ro=c["name"]["ro"],
            name_en=c["name"]["en"],
            family=c["family"],
            season_type=c["season_type"],
            sowing=_pair(c.get("sowing")),
            flowering=_pair(c.get("flowering")),
            harvest=_pair(c.get("harvest")),
            nitrogen_fixing=bool(c.get("nitrogen_fixing", False)),
            confidence=c["confidence"],
            review=bool(c.get("review", True)),
            raw=c,
        )
    return KnowledgeBase(
        version=data["version"],
        crops=crops,
        quality=data.get("quality", {}),
        rotation=data.get("rotation", {}),
    )


if __name__ == "__main__":
    kb = load_crops()
    pending = [c.id for c in kb.crops.values() if c.review]
    print(f"crops.toml {kb.version}: {len(kb.crops)} crops, {len(kb.quality)} quality rules")
    print(f"awaiting agronomist review: {', '.join(pending) or 'none'}")
    maize = kb.crops["maize"]
    print("maize flowering 2024:", maize.window("flowering", 2024))
    print("wheat sowing for season 2025:", kb.crops["wheat"].window("sowing", 2025))
