from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from api import stocks
from api.main import app
from api.whatsapp.assistant import CompatibleChatModel
from api.whatsapp.config import get_settings

# BriefFacts as the web app sends them (illustrative numbers).
FACTS: dict[str, Any] = {
    "mock": True,
    "as_of": "2026-11-15",
    "marketing_year": "2026/27",
    "path": "A",
    "path_name": "Broiler feed",
    "scenario": "A dry summer like 2024 cuts local maize supply.",
    "target_days": 90,
    "n_red": 1,
    "n_amber": 0,
    "total_shortfall_t": 26000,
    "n_countries": 2,
    "weights_pct": {"coverage": 35, "reliability": 25, "logistics": 20, "friction": 20},
    "short": [
        {
            "ingredient": "Maize",
            "status": "red",
            "cover_days": 18,
            "shortfall_t": 26000,
            "split": [
                {
                    "country": "Hungary",
                    "tonnes": 15600,
                    "share_pct": 60,
                    "score": 67,
                    "lead_days": 12,
                },
                {
                    "country": "Ukraine",
                    "tonnes": 10400,
                    "share_pct": 40,
                    "score": 66,
                    "lead_days": 21,
                },
            ],
            "uncovered_t": 0,
            "concentrated": False,
            "bridge_needed": True,
            "alternatives": ["Wheat", "Barley"],
        }
    ],
}


def _key(monkeypatch: pytest.MonkeyPatch, key: str) -> None:
    # A local .env may hold a real key: always override it.
    monkeypatch.setattr(
        stocks, "get_settings", lambda: get_settings().model_copy(update={"llm_api_key": key})
    )


def _model_says(monkeypatch: pytest.MonkeyPatch, text: str) -> None:
    _key(monkeypatch, "test-key")

    async def complete(self: CompatibleChatModel, system: str, history: list[Any]) -> str:
        return text

    monkeypatch.setattr(CompatibleChatModel, "complete", complete)


def _brief(facts: dict[str, Any] = FACTS) -> httpx.Response:
    response: httpx.Response = TestClient(app).post(
        "/v1/sourcing/brief", json={"lang": "en", "facts": facts}
    )
    return response


def test_no_key_means_no_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    _key(monkeypatch, "")
    assert _brief().json() == {"text": None, "source": "none", "reason": "no_llm"}


def test_reply_with_known_numbers_is_served(monkeypatch: pytest.MonkeyPatch) -> None:
    text = (
        "Maize is critical at 18 days of cover against a 90-day target, short 26,000 t. "
        "Buy 15,600 t (60%) from Hungary and 10,400 t (40%) from Ukraine within 3 weeks; "
        "a bridge purchase is needed. Figures are illustrative."
    )
    _model_says(monkeypatch, text)
    assert _brief().json() == {"text": text, "source": "llm", "reason": None}


def test_invented_number_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    _model_says(monkeypatch, "Buy 15,600 t from Hungary at 245 EUR/t. Figures are illustrative.")
    assert _brief().json() == {"text": None, "source": "none", "reason": "unverified_number"}


def test_oversized_facts_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _model_says(monkeypatch, "unused")
    assert _brief({"pad": "x" * 20_001}).status_code == 422


def test_numbers_from_strings_and_grouped_numbers_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    _model_says(monkeypatch, "As in 2024, maize is short 26.000 t. Figures are illustrative.")
    assert _brief().json()["source"] == "llm"


def test_list_of_numbers_is_not_merged(monkeypatch: pytest.MonkeyPatch) -> None:
    _model_says(monkeypatch, "Hungary and Ukraine score 67, 66. Figures are illustrative.")
    assert _brief().json()["source"] == "llm"


def test_llm_failure_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _key(monkeypatch, "test-key")

    async def complete(self: CompatibleChatModel, system: str, history: list[Any]) -> str:
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(CompatibleChatModel, "complete", complete)
    assert _brief().json() == {"text": None, "source": "none", "reason": "llm_error"}
