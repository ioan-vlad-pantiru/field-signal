"""Webhook tests: run with `pytest -q` (no network, no Twilio or LLM account needed)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from twilio.request_validator import RequestValidator

import api.whatsapp.analysis_client as ac
import api.whatsapp.router as wr
from api.whatsapp.config import get_settings
from api.whatsapp.sender import split_body

TOKEN = "test-token"
URL = "https://example.ngrok.app/v1/whatsapp/webhook"
FARMER = "whatsapp:+40700000000"
PIN = {"From": FARMER, "Latitude": "46.07", "Longitude": "23.66", "Label": "Câmp test"}


class FakeLLM:
    def __init__(self, answer: str = "NDVI arată cât de verzi sunt plantele.") -> None:
        self.answer = answer
        self.calls: list[tuple[str, list[dict[str, str]]]] = []

    async def complete(self, system: str, history: list[dict[str, str]]) -> str:
        self.calls.append((system, list(history)))
        return self.answer


class BrokenLLM:
    async def complete(self, system: str, history: list[dict[str, str]]) -> str:
        raise RuntimeError("boom")


class FakeSender:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send(self, to: str, body: str) -> None:
        self.sent.append((to, body))


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", TOKEN)
    monkeypatch.setenv("PUBLIC_WEBHOOK_URL", URL)
    monkeypatch.setenv("TWILIO_VALIDATE_SIGNATURE", "true")
    monkeypatch.setenv("BOT_DEFAULT_LANG", "ro")
    monkeypatch.delenv("AZURE_OPENAI_ENDPOINT", raising=False)
    get_settings.cache_clear()
    wr._store = None
    yield
    get_settings.cache_clear()


def make_client(llm: Any = None, sender: Any = None) -> TestClient:
    app = FastAPI()
    app.include_router(wr.router)
    app.dependency_overrides[wr.get_llm] = lambda: llm
    app.dependency_overrides[wr.get_sender] = lambda: sender or FakeSender()
    return TestClient(app)


def post(client: TestClient, data: dict[str, str], sign: bool = True) -> Any:
    headers = (
        {"X-Twilio-Signature": RequestValidator(TOKEN).compute_signature(URL, data)} if sign else {}
    )
    return client.post("/v1/whatsapp/webhook", data=data, headers=headers)


def test_rejects_unsigned(env: None) -> None:
    assert post(make_client(), PIN, sign=False).status_code == 403


def test_greeting_is_instant_welcome(env: None) -> None:
    llm = FakeLLM()
    r = post(make_client(llm), {"From": FARMER, "Body": "Bună!"})
    assert "Sunt Field Signal" in r.text and not llm.calls


def test_pin_then_why(env: None) -> None:
    c = make_client(FakeLLM())
    r = post(c, PIN)
    assert r.status_code == 200 and "application/xml" in r.headers["content-type"]
    assert "Rotații" in r.text and "de ce 2" in r.text and "agronom" in r.text
    r = post(c, {"From": FARMER, "Body": "De ce 2?"})
    assert "porumb → soia → grâu" in r.text and "Fixează azot" in r.text
    assert "Încredere: medie" in r.text
    assert "Am 3 rotații" in post(c, {"From": FARMER, "Body": "de ce 9"}).text


def test_summary_uses_api_analysis(env: None) -> None:
    r = post(make_client(), PIN)
    assert "Aiud (mock) (date demo)" in r.text
    assert "1. porumb → grâu → porumb (actuală)" in r.text
    assert "/ro/field?lat=46.07000&amp;lon=23.66000&amp;place=C%C3%A2mp+test" in r.text


def test_demo_fallback_when_analysis_fails(env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_request: object) -> None:
        raise RuntimeError("pipeline down")

    monkeypatch.setattr(ac, "run_field_analysis", boom)
    r = post(make_client(), PIN)
    assert "Sântimbru" in r.text and "(date demo)" in r.text


def test_why_without_pin(env: None) -> None:
    r = post(make_client(), {"From": FARMER, "Body": "de ce 1"})
    assert "Trimiteți mai întâi locația" in r.text


def test_free_chat_goes_to_llm_with_grounding(env: None) -> None:
    llm, sender = FakeLLM(), FakeSender()
    c = make_client(llm, sender)
    post(c, PIN)
    r = post(c, {"From": FARMER, "Body": "Ce înseamnă NDVI?"})
    assert "<Message>" not in r.text  # empty TwiML, answer sent separately
    assert sender.sent == [(FARMER, llm.answer)]
    system, history = llm.calls[0]
    assert "KNOWLEDGE" in system and "Never invent numbers" in system
    assert "Aiud" in system  # field results are in context
    assert history[-1] == {"role": "user", "content": "Ce înseamnă NDVI?"}
    assert any(h["role"] == "assistant" and "Rotații" in h["content"] for h in history)


def test_chat_without_pin_says_no_results(env: None) -> None:
    llm = FakeLLM()
    post(make_client(llm), {"From": FARMER, "Body": "Ce face aplicația voastră?"})
    assert "has not sent a field location" in llm.calls[0][0]


def test_llm_failure_sends_fallback(env: None) -> None:
    sender = FakeSender()
    post(make_client(BrokenLLM(), sender), {"From": FARMER, "Body": "Cum funcționează?"})
    assert "Nu pot răspunde" in sender.sent[0][1]


def test_no_llm_configured(env: None) -> None:
    r = post(make_client(None), {"From": FARMER, "Body": "Cum funcționează?"})
    assert "Nu pot răspunde" in r.text


def test_english(env: None) -> None:
    llm = FakeLLM("NDVI shows how green plants are.")
    c = make_client(llm)
    assert "English" in post(c, {"From": FARMER, "Body": "en"}).text
    assert "Rotations" in post(c, PIN).text
    post(c, {"From": FARMER, "Body": "what is NDVI"})
    assert "Default: English" in llm.calls[0][0]


def test_history_is_capped(env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BOT_HISTORY_TURNS", "2")
    get_settings.cache_clear()
    llm = FakeLLM()
    c = make_client(llm)
    for i in range(6):
        post(c, {"From": FARMER, "Body": f"întrebarea {i}"})
    assert len(llm.calls[-1][1]) <= 4


def test_split_body() -> None:
    parts = split_body("a" * 1000 + "\n" + "b" * 1000)
    assert len(parts) == 2 and all(len(p) <= 1600 for p in parts)
