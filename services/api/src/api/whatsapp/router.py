"""Twilio WhatsApp webhook for Field Signal.

- Location pin       → exact results summary (fixed template, instant)
- "de ce N" / "why N" → exact explanation of rotation N (fixed template, instant)
- "en" / "ro"         → language switch
- greeting / "ajutor" → welcome text (fixed, instant)
- anything else       → grounded chat assistant (LLM, sent via Twilio REST in the background)

Mount:  app.include_router(router)
Twilio sandbox "When a message comes in": POST https://<public-host>/v1/whatsapp/webhook
"""

from __future__ import annotations

import logging
import re
import unicodedata
from functools import lru_cache
from typing import Annotated

import anyio
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse

from . import messages as m
from .analysis_client import AnalysisUnavailable, analyze
from .assistant import ChatModel, OpenAIChatModel, build_system_prompt
from .config import BotSettings, get_settings
from .models import Lang
from .sender import Sender, TwilioSender
from .sessions import Session, SessionStore

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/whatsapp", tags=["whatsapp"])

MAX_USER_CHARS = 1000

_store: SessionStore | None = None


Settings = Annotated[BotSettings, Depends(get_settings)]


def get_store(settings: Settings) -> SessionStore:
    global _store
    if _store is None:
        lang: Lang = "en" if settings.default_lang == "en" else "ro"
        _store = SessionStore(settings.session_ttl_s, lang)
    return _store


@lru_cache
def _llm_singleton() -> ChatModel:
    return OpenAIChatModel(get_settings())


def get_llm(settings: Settings) -> ChatModel | None:
    return _llm_singleton() if settings.llm_api_key else None


@lru_cache
def _sender_singleton() -> Sender:
    return TwilioSender(get_settings())


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


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().lower().strip(".!?")


def _twiml(body: str | None = None) -> Response:
    r = MessagingResponse()
    if body:
        r.message(body)
    return Response(content=str(r), media_type="application/xml")


async def _validated_form(request: Request, settings: BotSettings) -> dict[str, str]:
    form = {k: str(v) for k, v in (await request.form()).items()}
    if not settings.validate_signature:
        return form
    if not settings.twilio_auth_token:
        raise HTTPException(500, "TWILIO_AUTH_TOKEN not set")
    url = settings.public_webhook_url or str(request.url)
    signature = request.headers.get("X-Twilio-Signature", "")
    if not RequestValidator(settings.twilio_auth_token).validate(url, form, signature):
        raise HTTPException(403, "Invalid Twilio signature")
    return form


def _reply(session: Session, settings: BotSettings, body: str) -> Response:
    """Fixed-template reply, also recorded so the assistant knows what was said."""
    session.remember("assistant", body, settings.history_turns)
    return _twiml(body)


async def _chat_reply(
    to: str, text: str, session: Session, settings: BotSettings, llm: ChatModel, sender: Sender
) -> None:
    async with session.lock:
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
        session.remember("assistant", answer, settings.history_turns)
        try:
            await sender.send(to, answer)
        except Exception:
            log.exception("Twilio send failed")


@router.post("/webhook")
async def webhook(
    request: Request,
    background: BackgroundTasks,
    settings: Settings,
    store: Annotated[SessionStore, Depends(get_store)],
    llm: Annotated[ChatModel | None, Depends(get_llm)],
    sender: Annotated[Sender, Depends(get_sender)],
) -> Response:
    form = await _validated_form(request, settings)
    from_ = form.get("From", "")
    session = store.get(from_)
    lang = session.lang

    # 1) Location pin → exact results
    lat, lon = form.get("Latitude"), form.get("Longitude")
    if lat and lon:
        try:
            lat_f, lon_f = float(lat), float(lon)
        except ValueError:
            return _twiml(m.t("error", lang))
        label = form.get("Label") or form.get("Address") or None
        try:
            session.analysis = await analyze(settings, lat_f, lon_f, lang, label)
        except AnalysisUnavailable:
            return _twiml(m.t("error", lang))
        session.remember("user", "[sent field location]", settings.history_turns)
        return _reply(session, settings, m.summary(session.analysis, lang))

    raw = form.get("Body", "").strip()[:MAX_USER_CHARS]
    text = _normalize(raw)

    # 2) Language switch
    if text in {"en", "english", "engleza"}:
        session.lang = "en"
        return _reply(session, settings, m.t("lang_set", "en"))
    if text in {"ro", "romana", "romanian"}:
        session.lang = "ro"
        return _reply(session, settings, m.t("lang_set", "ro"))

    # 3) "de ce N" → exact explanation
    match = _WHY.match(text)
    if match and (match.group(1) or session.analysis):
        a = session.analysis
        if a is None:
            return _reply(session, settings, m.t("need_pin_first", lang))
        n = int(match.group(1) or match.group(2))
        strategy = next((s for s in a.strategies if s.id == n), None)
        if strategy is None:
            return _reply(session, settings, m.t("bad_number", lang, n=len(a.strategies)))
        session.remember("user", raw, settings.history_turns)
        return _reply(session, settings, m.explain(a, strategy, lang))

    # 4) Greeting / help / empty → welcome
    if not text or text in _GREETINGS:
        return _reply(session, settings, m.t("welcome", lang))

    # 5) Free chat → grounded assistant, answered in the background
    if llm is None:
        return _twiml(m.t("llm_down", lang))
    background.add_task(_chat_reply, from_, raw, session, settings, llm, sender)
    return _twiml()  # empty TwiML: the answer arrives as a separate message
