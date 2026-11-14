"""The chat assistant: explains Field Signal and the farmer's own results.

Grounding: the model only sees knowledge.md plus the computed analysis for the
farmer's field (if a pin was sent). The prompt forbids new numbers and pushes
anything uncertain to an agronomist.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Protocol

from openai import AsyncAzureOpenAI, AsyncOpenAI

from .config import BotSettings
from .models import FieldAnalysis, Lang

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Field Signal's WhatsApp assistant for farmers in Romania.
Your job: help farmers understand what Field Signal does, what their results mean, and the words and data behind them. Be warm, patient and plain, like a helpful neighbour who knows the data.

Rules:
1. Use ONLY the KNOWLEDGE and FIELD RESULTS below. Never invent numbers, sources, yields, prices, doses or dates. Quote numbers exactly as given, with their period and source.
2. If you don't know or the data doesn't cover it, say so plainly and suggest asking a local agronomist or the agricultural office.
3. Any advice about what to plant or do: present it as an option to discuss, never an instruction, and add "Verificați cu un agronom" / "Check with an agronomist".
4. Values marked [mock] or results marked demo are demonstration data: say so if asked about them.
5. If there are no field results yet and the question is about their field, ask them to send the location (📎 → Locație).
6. WhatsApp style: short (max ~5 short lines or 600 characters), no tables, no markdown headers; at most a few "•" bullets. One idea per message; offer to say more.
7. Reply in the farmer's language. Default: {lang_name}. Simple words; explain any technical term the first time.
8. Off-topic questions: answer briefly if harmless, then steer back to the farm. Never ask for personal data (name, ID, address, money).
9. Never claim NASA or Transavia made or endorse Field Signal.

KNOWLEDGE:
{knowledge}

FIELD RESULTS:
{results}
"""


class ChatModel(Protocol):
    async def complete(self, system: str, history: list[dict[str, str]]) -> str: ...


class OpenAIChatModel:
    def __init__(self, s: BotSettings) -> None:
        if s.azure_openai_endpoint:
            self._client: AsyncOpenAI = AsyncAzureOpenAI(
                azure_endpoint=s.azure_openai_endpoint,
                api_key=s.llm_api_key,
                api_version=s.azure_openai_api_version,
            )
        else:
            self._client = AsyncOpenAI(api_key=s.llm_api_key)
        self._s = s

    async def complete(self, system: str, history: list[dict[str, str]]) -> str:
        resp = await self._client.chat.completions.create(
            model=self._s.llm_model,
            messages=[{"role": "system", "content": system}, *history],  # type: ignore[list-item]
            max_completion_tokens=self._s.llm_max_tokens,
            timeout=self._s.llm_timeout_s,
        )
        return (resp.choices[0].message.content or "").strip()


@lru_cache
def _knowledge(path: str) -> str:
    from pathlib import Path

    return Path(path).read_text(encoding="utf-8")


def build_system_prompt(s: BotSettings, lang: Lang, analysis: FieldAnalysis | None) -> str:
    results = (
        analysis.model_dump_json(exclude_none=True)
        if analysis
        else "None yet: the farmer has not sent a field location."
    )
    return SYSTEM_PROMPT.format(
        lang_name="Romanian" if lang == "ro" else "English",
        knowledge=_knowledge(str(s.knowledge_path)),
        results=results,
    )
