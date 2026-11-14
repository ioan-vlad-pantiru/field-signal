"""Meta WhatsApp Cloud API webhook for Field Signal.

- Location pin       → exact results summary (fixed template)
- "de ce N" / "why N" → exact explanation of rotation N (fixed template)
- "en" / "ro"         → language switch
- greeting / "ajutor" → welcome text (fixed)
- anything else       → grounded chat assistant (LLM)

Meta wants a fast 200, so the webhook only checks the signature and queues each message;
every reply goes out through the Cloud API from a background task.

Mount:  app.include_router(router)
Meta app → WhatsApp → Configuration → Callback URL: https://<public-host>/v1/whatsapp/webhook
(subscribe to the "messages" field).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from fastapi.responses import PlainTextResponse

from . import messages as m
from .analysis_client import AnalysisUnavailable, analyze
from .assistant import ChatModel, CompatibleChatModel, build_system_prompt
from .config import BotSettings, get_settings
from .models import Lang
from .sender import CloudApiSender, Sender
from .sessions import Session, SessionStore

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/whatsapp", tags=["whatsapp"])

MAX_USER_CHARS = 1000

_store: SessionStore | None = None
# Meta delivers at least once; remember recent message ids so a retry is not answered twice.
_seen: OrderedDict[str, None] = OrderedDict()
_SEEN_MAX = 2000


Settings = Annotated[BotSettings, Depends(get_settings)]


def get_store(settings: Settings) -> SessionStore:
    global _store
    if _store is None:
        lang: Lang = "en" if settings.default_lang == "en" else "ro"
        _store = SessionStore(settings.session_ttl_s, lang)
    return _store


@lru_cache
def _llm_singleton() -> ChatModel:
    return CompatibleChatModel(get_settings())


def get_llm(settings: Settings) -> ChatModel | None:
    return _llm_singleton() if settings.llm_api_key else None


@lru_cache
def _sender_singleton() -> Sender:
    return CloudApiSender(get_settings())


def get_sender() -> Sender:
    return _sender_singleton()


_WHY = re.compile(r"^(?:de\s*ce|dece|why|detalii|details)\s*#?\s*(\d{1,2})\s*\??$|^(\d)$")
_GREETINGS = {
    "buna",
    "buna ziua",
    "salut",
    "alo",
    "hello",
    "hi",
    "hey",
    "start",
    "ajutor",
    "help",
    "meniu",
    "menu",
}


@dataclass(frozen=True)
class Incoming:
    sender: str  # wa_id, digits only, e.g. "40700000000"
    text: str = ""
    lat: float | None = None
    lon: float | None = None
    label: str | None = None


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().lower().strip(".!?")


def _check_signature(raw: bytes, header: str, settings: BotSettings) -> None:
    if not settings.validate_signature:
        return
    if not settings.whatsapp_app_secret:
        raise HTTPException(500, "WHATSAPP_APP_SECRET not set")
    expected = (
        "sha256=" + hmac.new(settings.whatsapp_app_secret.encode(), raw, hashlib.sha256).hexdigest()
    )
    if not hmac.compare_digest(expected, header):
        raise HTTPException(403, "Invalid webhook signature")


def _first_time(message_id: str) -> bool:
    if not message_id:
        return True
    if message_id in _seen:
        return False
    _seen[message_id] = None
    while len(_seen) > _SEEN_MAX:
        _seen.popitem(last=False)
    return True


def parse_messages(payload: dict[str, Any]) -> list[Incoming]:
    """Incoming farmer messages in a Cloud API webhook payload; status updates are skipped."""
    out: list[Incoming] = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            for msg in value.get("messages") or []:
                if not _first_time(str(msg.get("id", ""))):
                    continue
                sender = str(msg.get("from", ""))
                kind = msg.get("type")
                if kind == "location":
                    loc = msg.get("location") or {}
                    try:
                        lat, lon = float(loc["latitude"]), float(loc["longitude"])
                    except (KeyError, TypeError, ValueError):
                        out.append(Incoming(sender))
                        continue
                    label = loc.get("name") or loc.get("address") or None
                    out.append(Incoming(sender, lat=lat, lon=lon, label=label))
                elif kind == "text":
                    out.append(Incoming(sender, text=str((msg.get("text") or {}).get("body", ""))))
                elif kind in {"button", "interactive"}:
                    btn = msg.get("button") or {}
                    inter = msg.get("interactive") or {}
                    reply = inter.get("button_reply") or inter.get("list_reply") or {}
                    label = btn.get("text") or reply.get("title", "")
                    out.append(Incoming(sender, text=str(label)))
                else:
                    # Voice notes, photos, stickers, ...: answer with the welcome/how-to text.
                    out.append(Incoming(sender))
    return out


async def _template_reply(
    msg: Incoming, session: Session, settings: BotSettings
) -> tuple[str | None, str | None]:
    """(fixed reply, free-chat text). Exactly one is set, or neither for nothing to say."""
    lang = session.lang

    # 1) Location pin → exact results
    if msg.lat is not None and msg.lon is not None:
        try:
            session.analysis = await analyze(settings, msg.lat, msg.lon, lang, msg.label)
        except AnalysisUnavailable:
            return m.t("error", lang), None
        session.remember("user", "[sent field location]", settings.history_turns)
        return m.summary(session.analysis, lang), None

    raw = msg.text.strip()[:MAX_USER_CHARS]
    text = _normalize(raw)

    # 2) Language switch
    if text in {"en", "english", "engleza"}:
        session.lang = "en"
        return m.t("lang_set", "en"), None
    if text in {"ro", "romana", "romanian"}:
        session.lang = "ro"
        return m.t("lang_set", "ro"), None

    # 3) "de ce N" → exact explanation
    match = _WHY.match(text)
    if match and (match.group(1) or session.analysis):
        a = session.analysis
        if a is None:
            return m.t("need_pin_first", lang), None
        n = int(match.group(1) or match.group(2))
        strategy = next((s for s in a.strategies if s.id == n), None)
        if strategy is None:
            return m.t("bad_number", lang, n=len(a.strategies)), None
        session.remember("user", raw, settings.history_turns)
        return m.explain(a, strategy, lang), None

    # 4) Greeting / help / empty / unsupported media → welcome
    if not text or text in _GREETINGS:
        return m.t("welcome", lang), None

    # 5) Free chat → grounded assistant
    return None, raw


async def _llm_answer(text: str, session: Session, settings: BotSettings, llm: ChatModel) -> str:
    session.remember("user", text, settings.history_turns)
    system = build_system_prompt(settings, session.lang, session.analysis)
    try:
        with anyio.fail_after(settings.llm_timeout_s + 2):
            answer = await llm.complete(system, list(session.history))
        if not answer:
            raise ValueError("empty LLM answer")
    except Exception:
        log.exception("assistant failed")
        answer = m.t("llm_down", session.lang)
    return answer


async def handle(
    msg: Incoming,
    store: SessionStore,
    settings: BotSettings,
    llm: ChatModel | None,
    sender: Sender,
) -> None:
    session = store.get(msg.sender)
    # One farmer's messages are answered one at a time, in order.
    async with session.lock:
        body, chat = await _template_reply(msg, session, settings)
        if chat is not None:
            body = (
                await _llm_answer(chat, session, settings, llm)
                if llm is not None
                else m.t("llm_down", session.lang)
            )
        if not body:
            return
        session.remember("assistant", body, settings.history_turns)
        try:
            await sender.send(msg.sender, body)
        except Exception:
            log.exception("WhatsApp send failed")


@router.get("/webhook")
def verify(
    settings: Settings,
    mode: Annotated[str, Query(alias="hub.mode")] = "",
    token: Annotated[str, Query(alias="hub.verify_token")] = "",
    challenge: Annotated[str, Query(alias="hub.challenge")] = "",
) -> PlainTextResponse:
    """Meta's one-time subscription handshake when you save the Callback URL."""
    ok = (
        mode == "subscribe"
        and bool(settings.whatsapp_verify_token)
        and hmac.compare_digest(token, settings.whatsapp_verify_token)
    )
    if not ok:
        raise HTTPException(403, "Verification failed")
    return PlainTextResponse(challenge)


@router.post("/webhook")
async def webhook(
    request: Request,
    background: BackgroundTasks,
    settings: Settings,
    store: Annotated[SessionStore, Depends(get_store)],
    llm: Annotated[ChatModel | None, Depends(get_llm)],
    sender: Annotated[Sender, Depends(get_sender)],
) -> Response:
    raw = await request.body()
    _check_signature(raw, request.headers.get("X-Hub-Signature-256", ""), settings)
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid JSON") from None
    if not isinstance(payload, dict):
        raise HTTPException(400, "Invalid payload")
    for msg in parse_messages(payload):
        if msg.sender:
            background.add_task(handle, msg, store, settings, llm, sender)
    return Response(status_code=200)
