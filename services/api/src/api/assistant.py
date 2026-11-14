"""Field Signal's in-app assistant: an agent on Qwen that answers easy and hard questions.

It sees the knowledge base (the same one the WhatsApp bot uses) and can call tools to look things
up: the fields on screen and in the farmer's account, a field's 25-season analysis, all fields
compared, and the regional feed supply. Answers must come from those; the prompt forbids new
numbers. With `think` on, Qwen reasons before answering (slower, for harder questions).
"""

from __future__ import annotations

import json
import logging
import math
from collections import Counter
from collections.abc import AsyncIterator, Callable
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from api import accounts, sourcing
from api.analysis import run_field_analysis
from api.contracts import (
    Account,
    AssistantField,
    AssistantReply,
    AssistantRequest,
    FieldAnalysis,
    LatLon,
    Localized,
    Status,
)
from api.whatsapp.assistant import _knowledge
from api.whatsapp.config import BotSettings, get_settings

log = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 5
THINK_MAX_TOKENS = 2400
THINK_TIMEOUT_S = 90.0
ANSWER_MAX_TOKENS = 900

SYSTEM_PROMPT = """You are the Field Signal assistant, inside the Field Signal web app for farmers and feed buyers in Romania.
Field Signal replays 25 seasons (2001 to now) of NASA satellite and weather data at a field to show how a crop rotation would have done, compares it with other rotations, and lays the plan out on the field in 1 ha hexagons. A buyer view shows where feed crops are likely to be available.

How to work:
1. Answer easy questions directly and briefly. For questions about the farmer's fields, rotations, risks, seasons or the buyer data, CALL THE TOOLS first; do not guess.
2. For hard questions (comparisons, "which field first", trade-offs, why a rotation wins), gather what you need with the tools, then reason step by step and give a clear answer with the reasons.
3. Use ONLY the KNOWLEDGE below and tool results. Never invent numbers, yields, prices, doses or dates. Quote numbers exactly, with their period and source.
4. If the data does not cover it, say so and suggest a local agronomist or the agricultural office.
5. Advice on what to plant: an option to discuss, not an instruction; remind them to check with an agronomist.
6. Tool results with "demo_data": true are demonstration data: say so plainly once.
7. Reply in {lang_name}; in Romanian address the farmer formally (dumneavoastră) and write with correct diacritics. Plain words; explain a technical term the first time. Short paragraphs; use "- " bullets for lists; **bold** only for the key number or name. No tables, no headings. Keep most answers under 150 words unless asked for detail.
8. Never ask for personal data. Never claim NASA endorses Field Signal.

The farmer is on the {page} page. Fields on screen or saved: {field_names}.

KNOWLEDGE:
{knowledge}
"""

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_fields",
            "description": "List the farmer's fields (on screen and saved in the account) with area, place and current rotation.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_field",
            "description": "25-season analysis of one field: every rotation compared with fit score, poor and watch seasons, poor years and main reasons, why the best one fits, local indicators and soil.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "field name from list_fields"}
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_fields",
            "description": "One line per field: best rotation, its poor seasons against the current rotation's, and area. Use for questions across several fields.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "regional_supply",
            "description": "Buyer view for a season: feed crop availability and quality risk by commune, the sourcing recommendation and the adoption scenario.",
            "parameters": {
                "type": "object",
                "properties": {
                    "season": {"type": "integer", "description": "harvest year, default 2025"}
                },
            },
        },
    },
]


def _loc(text: Localized, lang: str) -> str:
    return text.ro if lang == "ro" else text.en


def summarize_analysis(a: FieldAnalysis, lang: str) -> dict[str, Any]:
    """What the model needs from an analysis, small enough for the context window."""
    rotations = []
    for s in sorted(a.strategies, key=lambda s: -s.score.total):
        bad = [o for o in s.replay if o.status == Status.BAD]
        watch = [o for o in s.replay if o.status == Status.WATCH]
        reasons = Counter(_loc(r.label, lang) for o in bad + watch for r in o.reasons)
        rotations.append(
            {
                "name": _loc(s.name, lang),
                "is_current": s.is_current,
                "crops": [str(c) for c in s.sequence],
                "fit_score_of_100": round(s.score.total),
                "score_range": [round(s.score_range.low), round(s.score_range.high)],
                "poor_seasons": len(bad),
                "watch_seasons": len(watch),
                "poor_years": [o.year for o in bad],
                "main_reasons": [f"{label} ({n})" for label, n in reasons.most_common(3)],
                "why": _loc(s.explanation.why, lang),
                "benefits": [_loc(b, lang) for b in s.explanation.benefits][:3],
                "risks": [_loc(r.text, lang) for r in s.explanation.risks][:3],
            }
        )
    indicators = []
    for ind in a.indicators:
        values = [p.value for p in ind.series if p.value is not None]
        indicators.append(
            {
                "label": _loc(ind.label, lang),
                "unit": ind.unit,
                "higher_is_worse": ind.higher_is_worse,
                "first_10y_mean": round(sum(values[:10]) / len(values[:10]), 2) if values else None,
                "last_5y_mean": round(sum(values[-5:]) / len(values[-5:]), 2) if values else None,
                "source": ind.source.dataset,
            }
        )
    return {
        "demo_data": a.mock,
        "place": a.location.commune or a.location.label,
        "county": a.location.county,
        "period": f"{a.period_start}-{a.period_end}",
        "rotations_best_first": rotations,
        "indicators": indicators,
        "soil": a.soil.model_dump(mode="json", exclude={"source"}, exclude_none=True),
        "caveats": [_loc(c, lang) for c in a.caveats][:4],
        "sources": sorted({s.dataset for s in a.sources}),
    }


class Toolbox:
    """The tools for one request, over the fields it knows about."""

    def __init__(self, fields: list[AssistantField], lang: str) -> None:
        self.fields = fields
        self.lang = lang
        self.used: list[str] = []
        self.demo = False
        self._cache: dict[str, FieldAnalysis] = {}

    def _find(self, name: str) -> AssistantField | None:
        wanted = name.strip().casefold()
        for f in self.fields:
            if f.name.casefold() == wanted:
                return f
        return next((f for f in self.fields if wanted and wanted in f.name.casefold()), None)

    def _analysis(self, f: AssistantField) -> FieldAnalysis:
        if f.name not in self._cache:
            self._cache[f.name] = run_field_analysis(f.request)
        a = self._cache[f.name]
        self.demo = self.demo or a.mock
        return a

    def list_fields(self) -> Any:
        if not self.fields:
            return {"fields": [], "note": "No fields yet: the farmer can draw one under My field."}
        return {
            "fields": [
                {
                    "name": f.name,
                    "area_ha": round(f.area_ha, 1) if f.area_ha else None,
                    "near": f.near,
                    "current_rotation": [str(c) for c in f.request.current_rotation],
                    "irrigated": f.request.irrigated,
                }
                for f in self.fields
            ]
        }

    def analyze_field(self, name: str = "") -> Any:
        # With one field and no name given, it is that field.
        only = self.fields[0] if len(self.fields) == 1 else None
        f = self._find(name) if name.strip() else only
        if f is None:
            return {"error": f"No field called '{name}'.", "fields": [x.name for x in self.fields]}
        return {"field": f.name, **summarize_analysis(self._analysis(f), self.lang)}

    def compare_fields(self) -> Any:
        rows = []
        for f in self.fields:
            a = self._analysis(f)
            best = max(a.strategies, key=lambda s: s.score.total)
            current = next((s for s in a.strategies if s.is_current), best)

            def poor(s: Any) -> int:
                return sum(o.status == Status.BAD for o in s.replay)

            rows.append(
                {
                    "field": f.name,
                    "area_ha": round(f.area_ha, 1) if f.area_ha else None,
                    "best_rotation": _loc(best.name, self.lang),
                    "best_poor_seasons": poor(best),
                    "current_poor_seasons": poor(current),
                    "current_is_best": best is current,
                    "best_fit": round(best.score.total),
                    "current_fit": round(current.score.total),
                }
            )
        return {"demo_data": self.demo, "period": "2001-2025", "fields": rows}

    def regional_supply(self, season: int = 2025) -> Any:
        region = sourcing.sourcing_region(season)
        self.demo = self.demo or region.mock
        data = region.model_dump(mode="json", exclude={"sources", "schema_version"})
        data["zones"] = data["zones"][:15]
        return data

    def call(self, name: str, raw_args: str) -> str:
        self.used.append(name)
        try:
            args = json.loads(raw_args or "{}")
        except json.JSONDecodeError:
            args = {}
        handlers: dict[str, Callable[..., Any]] = {
            "list_fields": self.list_fields,
            "analyze_field": self.analyze_field,
            "compare_fields": self.compare_fields,
            "regional_supply": self.regional_supply,
        }
        handler = handlers.get(name)
        if handler is None:
            return json.dumps({"error": f"unknown tool {name}"})
        try:
            result = handler(**{k: v for k, v in args.items() if isinstance(k, str)})
        except Exception as exc:  # a tool failure is something the model can explain
            log.warning("assistant tool %s failed: %s", name, exc)
            result = {"error": "This look-up failed. Answer without it and say so."}
        return json.dumps(result, ensure_ascii=False, default=str)


class _ThinkFilter:
    """Drops a `<think>…</think>` block from streamed text, even when tags split across chunks."""

    def __init__(self) -> None:
        self._buf = ""
        self._inside = False

    def feed(self, chunk: str) -> str:
        self._buf += chunk
        out = []
        while self._buf:
            if self._inside:
                end = self._buf.find("</think>")
                if end < 0:
                    self._buf = self._buf[-len("</think>") :]
                    break
                self._buf = self._buf[end + len("</think>") :]
                self._inside = False
                continue
            start = self._buf.find("<think>")
            if start >= 0:
                out.append(self._buf[:start])
                self._buf = self._buf[start + len("<think>") :]
                self._inside = True
                continue
            # Hold back a possible partial "<think>" at the end.
            keep = next(
                (
                    n
                    for n in range(min(len("<think>") - 1, len(self._buf)), 0, -1)
                    if "<think>".startswith(self._buf[-n:])
                ),
                0,
            )
            out.append(self._buf[: len(self._buf) - keep])
            self._buf = self._buf[len(self._buf) - keep :]
            break
        return "".join(out)


Event = dict[str, Any]


async def agent_events(
    body: AssistantRequest, fields: list[AssistantField], s: BotSettings
) -> AsyncIterator[Event]:
    """Runs the agent with streamed completions. Yields `tool` (a look-up started), `reasoning`
    (the model is thinking), `delta` (answer text), `reset` (drop text shown so far) and finally
    `done` with the tools used and whether demo data was involved."""
    tools = Toolbox(fields, body.lang)
    system = SYSTEM_PROMPT.format(
        lang_name="Romanian" if body.lang == "ro" else "English",
        page=body.page or "start",
        field_names=", ".join(f.name for f in fields) or "none yet",
        knowledge=_knowledge(str(s.knowledge_path)),
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        *({"role": m.role, "content": m.content} for m in body.messages[-12:]),
    ]
    extra = dict(s.llm_extra_body)
    extra["chat_template_kwargs"] = {
        **extra.get("chat_template_kwargs", {}),
        "enable_thinking": body.think,
    }
    url = f"{s.llm_base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {s.llm_api_key}"}
    timeout = THINK_TIMEOUT_S if body.think else max(s.llm_timeout_s, 30.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        for round_ in range(MAX_TOOL_ROUNDS + 1):
            payload = {
                **extra,
                "model": s.llm_model,
                "messages": messages,
                "max_tokens": THINK_MAX_TOKENS if body.think else ANSWER_MAX_TOKENS,
                "stream": True,
            }
            if round_ < MAX_TOOL_ROUNDS:
                payload["tools"] = TOOLS
            text: list[str] = []
            calls: dict[int, dict[str, Any]] = {}
            think = _ThinkFilter()
            reasoning_sent = False
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    choices = json.loads(data).get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    if delta.get("reasoning_content") and not reasoning_sent:
                        reasoning_sent = True
                        yield {"type": "reasoning"}
                    for tc in delta.get("tool_calls") or []:
                        slot = calls.setdefault(
                            tc.get("index", 0), {"id": "", "name": "", "arguments": ""}
                        )
                        slot["id"] = tc.get("id") or slot["id"]
                        fn = tc.get("function") or {}
                        slot["name"] += fn.get("name") or ""
                        slot["arguments"] += fn.get("arguments") or ""
                    piece = think.feed(delta.get("content") or "")
                    if piece:
                        if not text and not piece.strip():
                            continue
                        text.append(piece)
                        yield {"type": "delta", "text": piece}
            if not calls:
                yield {"type": "done", "tools_used": tools.used, "demo_data": tools.demo}
                return
            if text:
                # Words before a look-up are a preamble, not the answer.
                yield {"type": "reset"}
            ordered = [calls[i] for i in sorted(calls)]
            messages.append(
                {
                    "role": "assistant",
                    "content": "".join(text),
                    "tool_calls": [
                        {
                            "id": c["id"],
                            "type": "function",
                            "function": {"name": c["name"], "arguments": c["arguments"] or "{}"},
                        }
                        for c in ordered
                    ],
                }
            )
            for c in ordered:
                yield {"type": "tool", "name": c["name"]}
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": c["id"],
                        "content": tools.call(c["name"], c["arguments"]),
                    }
                )
    yield {"type": "done", "tools_used": tools.used, "demo_data": tools.demo}


async def run_agent(
    body: AssistantRequest, fields: list[AssistantField], s: BotSettings
) -> AssistantReply:
    """The whole answer at once (the non-streaming endpoint)."""
    text: list[str] = []
    done: Event = {"tools_used": [], "demo_data": False}
    async for event in agent_events(body, fields, s):
        if event["type"] == "delta":
            text.append(event["text"])
        elif event["type"] == "reset":
            text.clear()
        elif event["type"] == "done":
            done = event
    return AssistantReply(
        reply="".join(text).strip(), tools_used=done["tools_used"], demo_data=done["demo_data"]
    )


def _optional_account(fs_session: Annotated[str | None, Cookie()] = None) -> Account | None:
    if not fs_session:
        return None
    try:
        return accounts.current_account(fs_session)
    except HTTPException:
        return None


def _area_ha(boundary: list[LatLon]) -> float:
    """Shoelace area on a local flat projection; good to well under 1 % at field size."""
    if len(boundary) < 3:
        return 0.0
    lat0 = math.radians(boundary[0].lat)
    pts = [(p.lon * 111_320 * math.cos(lat0), p.lat * 111_320) for p in boundary]
    twice = sum(
        x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1], strict=True)
    )
    return abs(twice) / 2 / 10_000


def _saved_fields(account: Account | None) -> list[AssistantField]:
    if account is None:
        return []
    return [
        AssistantField(name=f.name, request=f.request, near=f.near, area_ha=_area_ha(f.boundary))
        for f in accounts.list_fields(account)
    ]


router = APIRouter(prefix="/v1/assistant", tags=["assistant"])


def _gather_fields(body: AssistantRequest, account: Account | None) -> list[AssistantField]:
    """Fields on screen first, then saved ones not already there."""
    fields = list(body.fields)
    names = {f.name.casefold() for f in fields}
    for f in _saved_fields(account):
        if f.name.casefold() not in names and len(fields) < 20:
            fields.append(f)
            names.add(f.name.casefold())
    return fields


def _check(body: AssistantRequest, s: BotSettings) -> None:
    if not s.llm_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "assistant_off")
    if body.messages[-1].role != "user":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "last_message_not_user")


@router.post("/chat")
async def chat(
    body: AssistantRequest,
    account: Annotated[Account | None, Depends(_optional_account)],
) -> AssistantReply:
    s = get_settings()
    _check(body, s)
    try:
        reply = await run_agent(body, _gather_fields(body, account), s)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("assistant failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "assistant_failed") from exc
    if not reply.reply:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "assistant_failed")
    return reply


@router.post("/stream")
async def stream(
    body: AssistantRequest,
    account: Annotated[Account | None, Depends(_optional_account)],
) -> StreamingResponse:
    """The answer as server-sent events, one JSON object per `data:` line (see `agent_events`)."""
    s = get_settings()
    _check(body, s)
    fields = _gather_fields(body, account)

    async def events() -> AsyncIterator[str]:
        try:
            async for event in agent_events(body, fields, s):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            log.warning("assistant stream failed: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'code': 'failed'})}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
