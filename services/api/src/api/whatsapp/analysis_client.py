"""Runs the same analysis as /v1/fields/analyze, in-process."""

from __future__ import annotations

import json
import logging
from urllib.parse import urlencode

import anyio

from api.analysis import run_field_analysis

from .config import BotSettings
from .models import FieldAnalysis, Lang, build_analyze_request, from_contract, parse_analysis

log = logging.getLogger(__name__)


class AnalysisUnavailable(Exception):
    pass


def _results_url(
    settings: BotSettings, lat: float, lon: float, lang: Lang, label: str | None
) -> str:
    query = {"lat": f"{lat:.5f}", "lon": f"{lon:.5f}"}
    if label:
        query["place"] = label
    return f"{settings.results_base_url.rstrip('/')}/{lang}/field?{urlencode(query)}"


def load_demo(settings: BotSettings, lang: Lang) -> FieldAnalysis:
    data = json.loads(settings.demo_analysis_path.read_text(encoding="utf-8"))
    payload = data.get(lang) or data["ro"]
    return parse_analysis(payload).model_copy(update={"is_demo": True})


async def analyze(
    settings: BotSettings, lat: float, lon: float, lang: Lang, label: str | None
) -> FieldAnalysis:
    try:
        request = build_analyze_request(lat, lon)
        result = await anyio.to_thread.run_sync(run_field_analysis, request)
        a = from_contract(result, lang)
    except Exception as exc:
        log.warning("analysis failed (%s); demo fallback=%s", exc, settings.fallback_to_demo)
        if not settings.fallback_to_demo:
            raise AnalysisUnavailable from exc
        a = load_demo(settings, lang)
    return a.model_copy(update={"results_url": _results_url(settings, lat, lon, lang, label)})
