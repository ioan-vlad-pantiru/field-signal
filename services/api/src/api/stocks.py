"""Buyer stocks tab: the management summary of the procurement brief, written by the LLM.

The web app computes every number (`BriefFacts`, apps/web/src/lib/stocks.ts) and has its own
template summary. This endpoint only turns those facts into prose. A reply quoting any number
that is not in the facts is dropped (`source: "none"`), so the app falls back to its template.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from api.whatsapp.assistant import CompatibleChatModel
from api.whatsapp.config import get_settings

log = logging.getLogger(__name__)

MAX_FACTS_CHARS = 20_000

SYSTEM = """\
You write the executive summary of a feed procurement report for Transavia's management.
The user message is a JSON object of facts: stock cover, shortfalls and a purchase split.
Rules:
- One paragraph, at most 150 words, plain business tone. No headings, lists or markdown.
- Use ONLY numbers present in the facts, written exactly as given. Do not compute new ones.
- No new figures, prices, dates or company names.
- Say that the figures are illustrative.
- Answer in {lang}."""

# A grouped number ("26.000", "26,000", "26 000") or a plain digit run; "67, 66" stays two.
_REPLY_NUMBER = re.compile(r"\d{1,3}(?:[.,\s\u00a0]\d{3})+|\d+")
_SEPARATORS = re.compile(r"[.,\s\u00a0]")

router = APIRouter()


class BriefRequest(BaseModel):
    lang: Literal["ro", "en"] = "ro"
    facts: dict[str, Any]

    @field_validator("facts")
    @classmethod
    def _small(cls, facts: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(facts, ensure_ascii=False)) > MAX_FACTS_CHARS:
            raise ValueError(f"facts exceed {MAX_FACTS_CHARS} characters")
        return facts


class BriefReply(BaseModel):
    text: str | None = None
    source: Literal["llm", "none"] = "none"
    reason: str | None = None


def unknown_numbers(text: str, facts_json: str) -> set[str]:
    """Numbers above 10 in `text` that appear nowhere in the facts (digits in strings count)."""
    allowed = set(re.findall(r"\d+", facts_json))
    found = {_SEPARATORS.sub("", n) for n in _REPLY_NUMBER.findall(text)}
    return {n for n in found if int(n) > 10 and n not in allowed}


@router.post("/v1/sourcing/brief", tags=["buyer"])
async def sourcing_brief(body: BriefRequest) -> BriefReply:
    """Executive summary of the stocks brief from the given facts only, or why there is none."""
    s = get_settings()
    if not s.llm_api_key:
        return BriefReply(reason="no_llm")
    facts_json = json.dumps(body.facts, ensure_ascii=False)
    lang = "Romanian, with correct diacritics" if body.lang == "ro" else "English"
    system = SYSTEM.format(lang=lang)
    try:
        text = await CompatibleChatModel(s).complete(
            system, [{"role": "user", "content": facts_json}]
        )
        if not text:
            raise ValueError("empty reply")
    except Exception as exc:
        log.warning("sourcing brief failed: %s", exc)
        return BriefReply(reason="llm_error")
    if unknown := unknown_numbers(text, facts_json):
        log.warning("sourcing brief dropped, numbers not in facts: %s", sorted(unknown))
        return BriefReply(reason="unverified_number")
    return BriefReply(text=text, source="llm")
