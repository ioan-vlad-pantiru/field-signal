"""Webhook tests: run with `pytest -q` (no network, no Meta or LLM account needed)."""

from __future__ import annotations

import hashlib
import hmac
import itertools
import json
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.whatsapp.analysis_client as ac
import api.whatsapp.router as wr
from api.whatsapp.config import get_settings
from api.whatsapp.sender import split_body

SECRET = "test-app-secret"
VERIFY = "test-verify-token"
FARMER = "40700000000"
PIN = {"type": "location", "location": {"latitude": 46.07, "longitude": 23.66, "name": "Câmp test"}}
_ids = itertools.count()


def text(body: str) -> dict[str, Any]:
    return {"type": "text", "text": {"body": body}}


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
    monkeypatch.setenv("WHATSAPP_APP_SECRET", SECRET)
    monkeypatch.setenv("WHATSAPP_VERIFY_TOKEN", VERIFY)
    monkeypatch.setenv("WHATSAPP_VALIDATE_SIGNATURE", "true")
    monkeypatch.setenv("BOT_DEFAULT_LANG", "ro")
    get_settings.cache_clear()
    wr._store = None
    wr._seen.clear()
    yield
    get_settings.cache_clear()


class Bot:
    """Test client that posts Cloud API payloads and returns what the bot sent back."""

    def __init__(self, llm: Any = None, sender: Any = None) -> None:
        self.sender = sender or FakeSender()
        app = FastAPI()
        app.include_router(wr.router)
        app.dependency_overrides[wr.get_llm] = lambda: llm
        app.dependency_overrides[wr.get_sender] = lambda: self.sender
        self.client = TestClient(app)

    def raw(self, message: dict[str, Any], sign: bool = True, msg_id: str | None = None) -> Any:
        msg = {"from": FARMER, "id": msg_id or f"wamid.{next(_ids)}", "timestamp": "0", **message}
        payload = {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "id": "1",
                    "changes": [
                        {
                            "field": "messages",
                            "value": {
                                "messaging_product": "whatsapp",
                                "metadata": {"phone_number_id": "123"},
                                "messages": [msg],
                            },
                        }
                    ],
                }
            ],
        }
        body = json.dumps(payload).encode()
        sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        headers = {"Content-Type": "application/json"}
        if sign:
            headers["X-Hub-Signature-256"] = sig
        return self.client.post("/v1/whatsapp/webhook", content=body, headers=headers)

    def send(self, message: dict[str, Any], **kw: Any) -> str:
        """Post one message; return the bot's reply ('' if none)."""
        before = len(self.sender.sent)
        r = self.raw(message, **kw)
        assert r.status_code == 200
        return "\n".join(b for _, b in self.sender.sent[before:])


def test_rejects_unsigned(env: None) -> None:
    assert Bot().raw(PIN, sign=False).status_code == 403


def test_verify_handshake(env: None) -> None:
    c = Bot().client
    q = {"hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "42"}
    r = c.get("/v1/whatsapp/webhook", params=q)
    assert r.status_code == 200 and r.text == "42"
    q["hub.verify_token"] = "wrong"
    assert c.get("/v1/whatsapp/webhook", params=q).status_code == 403


def test_status_updates_are_ignored(env: None) -> None:
    bot = Bot()
    body = json.dumps({"entry": [{"changes": [{"value": {"statuses": [{"id": "x"}]}}]}]}).encode()
    sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    r = bot.client.post("/v1/whatsapp/webhook", content=body, headers={"X-Hub-Signature-256": sig})
    assert r.status_code == 200 and bot.sender.sent == []


def test_retried_message_is_answered_once(env: None) -> None:
    bot = Bot()
    bot.send(text("Bună!"), msg_id="wamid.same")
    bot.send(text("Bună!"), msg_id="wamid.same")
    assert len(bot.sender.sent) == 1


def test_greeting_is_welcome_without_llm(env: None) -> None:
    llm = FakeLLM()
    bot = Bot(llm)
    assert "Sunt Field Signal" in bot.send(text("Bună!")) and not llm.calls
    assert bot.sender.sent[0][0] == FARMER


def test_unsupported_media_gets_welcome(env: None) -> None:
    assert "Sunt Field Signal" in Bot().send({"type": "audio", "audio": {"id": "1"}})


def test_pin_then_why(env: None) -> None:
    bot = Bot(FakeLLM())
    r = bot.send(PIN)
    assert "Rotații" in r and "de ce 2" in r and "agronom" in r
    r = bot.send(text("De ce 2?"))
    assert "porumb → mazăre → grâu" in r and "Fixează azot" in r
    assert "Încredere: medie" in r
    assert "Am 3 rotații" in bot.send(text("de ce 9"))


def test_summary_uses_api_analysis(env: None) -> None:
    r = Bot().send(PIN)
    assert "Aiud (mock) (date demo)" in r
    assert "1. porumb → grâu → porumb (actuală)" in r
    assert "/ro/field?lat=46.07000&lon=23.66000&place=C%C3%A2mp+test" in r


def test_demo_fallback_when_analysis_fails(env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(_request: object) -> None:
        raise RuntimeError("pipeline down")

    monkeypatch.setattr(ac, "run_field_analysis", boom)
    r = Bot().send(PIN)
    assert "Sântimbru" in r and "(date demo)" in r


def test_why_without_pin(env: None) -> None:
    assert "Trimiteți mai întâi locația" in Bot().send(text("de ce 1"))


def test_free_chat_goes_to_llm_with_grounding(env: None) -> None:
    llm = FakeLLM()
    bot = Bot(llm)
    bot.send(PIN)
    assert bot.send(text("Ce înseamnă NDVI?")) == llm.answer
    system, history = llm.calls[0]
    assert "KNOWLEDGE" in system and "Never invent numbers" in system
    assert "Aiud" in system  # field results are in context
    assert history[-1] == {"role": "user", "content": "Ce înseamnă NDVI?"}
    assert any(h["role"] == "assistant" and "Rotații" in h["content"] for h in history)


def test_chat_without_pin_says_no_results(env: None) -> None:
    llm = FakeLLM()
    Bot(llm).send(text("Ce face aplicația voastră?"))
    assert "has not sent a field location" in llm.calls[0][0]


def test_llm_failure_sends_fallback(env: None) -> None:
    assert "Nu pot răspunde" in Bot(BrokenLLM()).send(text("Cum funcționează?"))


def test_no_llm_configured(env: None) -> None:
    assert "Nu pot răspunde" in Bot(None).send(text("Cum funcționează?"))


def test_english(env: None) -> None:
    llm = FakeLLM("NDVI shows how green plants are.")
    bot = Bot(llm)
    assert "English" in bot.send(text("en"))
    assert "Rotations" in bot.send(PIN)
    bot.send(text("what is NDVI"))
    assert "Default: English" in llm.calls[0][0]


def test_history_is_capped(env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BOT_HISTORY_TURNS", "2")
    get_settings.cache_clear()
    llm = FakeLLM()
    bot = Bot(llm)
    for i in range(6):
        bot.send(text(f"întrebarea {i}"))
    assert len(llm.calls[-1][1]) <= 4


def test_split_body() -> None:
    parts = split_body("a" * 1000 + "\n" + "b" * 1000)
    assert len(parts) == 2 and all(len(p) <= 1600 for p in parts)


def test_main_risk_prefers_a_weather_cause() -> None:
    from types import SimpleNamespace as NS

    from api import contracts
    from api.whatsapp.models import _main_risk

    def reason(code: str) -> NS:
        return NS(code=code, label=NS(en=code, ro=code))

    def analysis(*seasons: list[str]) -> Any:
        replay = [
            NS(status=contracts.Status.BAD, reasons=[reason(c) for c in codes]) for codes in seasons
        ]
        return NS(strategies=[NS(is_current=True, replay=replay)])

    assert (
        _main_risk(analysis(["model_yield_index", "heat"], ["model_yield_index"]), "en") == "heat"
    )
    assert _main_risk(analysis(["model_yield_index"]), "en") == "model_yield_index"
