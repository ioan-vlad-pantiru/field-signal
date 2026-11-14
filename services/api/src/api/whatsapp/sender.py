"""Outbound WhatsApp messages through the Twilio REST API.

Chat replies are sent this way (not as the webhook's TwiML answer) so a slow
LLM call can never hit Twilio's 15-second webhook timeout.
"""

from __future__ import annotations

from functools import partial
from typing import Protocol

import anyio
from twilio.rest import Client

from .config import BotSettings
from .messages import MAX_BODY


class Sender(Protocol):
    async def send(self, to: str, body: str) -> None: ...


def split_body(body: str, limit: int = MAX_BODY) -> list[str]:
    chunks: list[str] = []
    rest = body.strip()
    while len(rest) > limit:
        cut = rest.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = rest.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        chunks.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    if rest:
        chunks.append(rest)
    return chunks


class TwilioSender:
    def __init__(self, s: BotSettings) -> None:
        self._client = Client(s.twilio_account_sid, s.twilio_auth_token)
        self._from = s.twilio_whatsapp_from

    async def send(self, to: str, body: str) -> None:
        for chunk in split_body(body):
            create = partial(self._client.messages.create, from_=self._from, to=to, body=chunk)
            await anyio.to_thread.run_sync(create)
