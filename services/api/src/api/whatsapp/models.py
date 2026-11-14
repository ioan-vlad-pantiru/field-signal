"""The slice of the /v1/fields/analyze response the bot needs.

The bot has no logic of its own: it only rephrases what the API computed.
`from_contract` is the ONE place that knows the API contract (`api.contracts`);
everything else depends only on these models.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Literal

from pydantic import BaseModel, Field

from api import contracts
from api.contracts import Crop, FieldRequest, LatLon, Priority

Lang = Literal["ro", "en"]
Confidence = Literal["low", "medium", "high"]


class Evidence(BaseModel):
    label: str  # e.g. "Zile cu căldură >32 °C la înflorirea porumbului"
    value: str  # already formatted with unit, e.g. "9 zile/an (medie)"
    period: str | None = None  # e.g. "2001-2025"
    source: str | None = None  # e.g. "NASA POWER"


class Strategy(BaseModel):
    id: int  # 1-based, as shown to the farmer
    name: str
    sequence: list[str]
    score: float = Field(ge=0, le=100)
    score_low: float | None = None
    score_high: float | None = None
    why: str  # one line
    confidence: Confidence
    is_current: bool = False
    evidence: list[Evidence] = []
    benefits: list[str] = []
    risks: list[str] = []
    gaps: list[str] = []


class FieldAnalysis(BaseModel):
    analysis_id: str | None = None
    place_label: str
    main_risk: str | None = None
    strategies: list[Strategy] = Field(min_length=1)
    data_period: str | None = None
    resolution_note: str | None = None
    results_url: str | None = None
    is_demo: bool = False


DEFAULT_ROTATION = [Crop.MAIZE, Crop.WHEAT, Crop.MAIZE]
"""The bot does not ask for the current rotation; it assumes the common regional one."""

EQUAL_PRIORITIES = dict.fromkeys(Priority, 1.0)

CROP_NAMES: dict[Crop, dict[Lang, str]] = {
    Crop.MAIZE: {"ro": "porumb", "en": "maize"},
    Crop.WHEAT: {"ro": "grâu", "en": "wheat"},
    Crop.BARLEY: {"ro": "orz", "en": "barley"},
    Crop.SOYBEAN: {"ro": "soia", "en": "soybean"},
    Crop.SUNFLOWER: {"ro": "floarea-soarelui", "en": "sunflower"},
    Crop.PEA: {"ro": "mazăre", "en": "pea"},
    Crop.COVER_MUSTARD: {"ro": "muștar (acoperire)", "en": "mustard (cover)"},
    Crop.COVER_PHACELIA: {"ro": "facelia (acoperire)", "en": "phacelia (cover)"},
    Crop.COVER_VETCH: {"ro": "măzăriche (acoperire)", "en": "vetch (cover)"},
    Crop.FALLOW: {"ro": "pârloagă", "en": "fallow"},
}

UNIT_NAMES: dict[str, dict[Lang, str]] = {
    "seasons": {"ro": "sezoane", "en": "seasons"},
    "days": {"ro": "zile", "en": "days"},
}


def build_analyze_request(lat: float, lon: float) -> FieldRequest:
    return FieldRequest(
        location=LatLon(lat=lat, lon=lon),
        current_rotation=DEFAULT_ROTATION,
        priorities=EQUAL_PRIORITIES,
    )


def parse_analysis(payload: dict[str, Any]) -> FieldAnalysis:
    """Validate an already-shaped bot payload (the cached demo file)."""
    return FieldAnalysis.model_validate(payload)


def _value(e: contracts.Evidence, lang: Lang) -> str:
    if e.value is None:
        return "—"
    if e.unit == "year":
        return f"{e.value:.0f}"
    unit = UNIT_NAMES.get(e.unit or "", {}).get(lang, e.unit or "")
    return f"{e.value:g} {unit}".strip()


def _main_risk(a: contracts.FieldAnalysis, lang: Lang) -> str | None:
    """The reason that most often made the current rotation's past seasons poor."""
    current = next((s for s in a.strategies if s.is_current), a.strategies[0])
    counts: Counter[str] = Counter()
    labels: dict[str, str] = {}
    for season in current.replay:
        if season.status in (contracts.Status.BAD, contracts.Status.WATCH):
            for r in season.reasons:
                counts[r.code] += 1
                labels[r.code] = getattr(r.label, lang)
    if not counts:
        return None
    return labels[counts.most_common(1)[0][0]]


def from_contract(a: contracts.FieldAnalysis, lang: Lang) -> FieldAnalysis:
    """Map the API's FieldAnalysis onto the bot's view model. Adapt here, nowhere else."""
    periods = {src.dataset: src.period for src in a.sources}
    strategies = [
        Strategy(
            id=i,
            name=getattr(s.name, lang),
            sequence=[CROP_NAMES[Crop(c)][lang] for c in s.sequence],
            score=s.score.total,
            score_low=s.score_range.low,
            score_high=s.score_range.high,
            why=getattr(s.explanation.why, lang),
            confidence=s.confidence,
            is_current=s.is_current,
            evidence=[
                Evidence(
                    label=getattr(e.text, lang),
                    value=_value(e, lang),
                    period=periods.get(e.source),
                    source=e.source,
                )
                for e in s.explanation.evidence
            ],
            benefits=[getattr(b, lang) for b in s.explanation.benefits],
            risks=[getattr(r.text, lang) for r in s.explanation.risks],
            gaps=[getattr(g, lang) for g in s.explanation.gaps],
        )
        for i, s in enumerate(a.strategies, start=1)
    ]
    return FieldAnalysis(
        place_label=a.location.label,
        main_risk=_main_risk(a, lang),
        strategies=strategies,
        data_period=f"{a.period_start}-{a.period_end}",
        is_demo=a.mock,
    )
