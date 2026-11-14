"""Outbound WhatsApp messages through the Meta WhatsApp Cloud API.

Every reply is sent this way, from a background task, so the webhook can answer Meta
with 200 straight away; slow analyses or LLM calls never cause Meta to retry.
Replies inside the 24-hour window after the farmer's last message are free.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

from .config import BotSettings
from .messages import MAX_BODY

log = logging.getLogger(__name__)


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


class CloudApiSender:
    def __init__(self, s: BotSettings) -> None:
        self._url = (
            f"https://graph.facebook.com/{s.whatsapp_graph_version}"
            f"/{s.whatsapp_phone_number_id}/messages"
        )
        self._client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {s.whatsapp_token}"}, timeout=15
        )

    async def send(self, to: str, body: str) -> None:
        for chunk in split_body(body):
            r = await self._client.post(
                self._url,
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": to,
                    "type": "text",
                    "text": {"body": chunk, "preview_url": True},
                },
            )
            if r.is_error:
                # Meta's error JSON says what is wrong (expired token, number not allowed, ...).
                log.error("WhatsApp send failed: %s %s", r.status_code, r.text[:500])
                r.raise_for_status()
