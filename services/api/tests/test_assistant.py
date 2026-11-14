import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api import assistant
from api.contracts import AssistantField, AssistantRequest
from api.main import app
from api.whatsapp.config import get_settings

FIELD = {
    "name": "North field",
    "area_ha": 82,
    "near": "Rădești",
    "request": {
        "location": {"lat": 46.36, "lon": 23.74},
        "current_rotation": ["maize", "wheat", "maize"],
        "priorities": {"yield": 0.6, "water": 0.5},
        "irrigated": False,
    },
}


def test_tools_answer_from_the_analysis() -> None:
    tools = assistant.Toolbox([AssistantField.model_validate(FIELD)], "en")
    listed = json.loads(tools.call("list_fields", "{}"))
    assert listed["fields"][0]["current_rotation"] == ["maize", "wheat", "maize"]
    analysis = json.loads(tools.call("analyze_field", '{"name": "north FIELD"}'))
    assert analysis["field"] == "North field"
    assert analysis["rotations_best_first"][0]["fit_score_of_100"] >= 0
    assert analysis["demo_data"] is True
    compared = json.loads(tools.call("compare_fields", "{}"))
    assert compared["fields"][0]["field"] == "North field"
    assert "zones" in json.loads(tools.call("regional_supply", '{"season": 2025}'))
    assert "error" in json.loads(tools.call("analyze_field", '{"name": "nowhere"}'))
    assert tools.used == [
        "list_fields",
        "analyze_field",
        "compare_fields",
        "regional_supply",
        "analyze_field",
    ]


def sse(*deltas: dict[str, Any]) -> list[str]:
    lines = [f"data: {json.dumps({'choices': [{'delta': d}]})}" for d in deltas]
    return [*lines, "data: [DONE]"]


class FakeStream:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    async def __aenter__(self) -> "FakeStream":
        return self

    async def __aexit__(self, *_: Any) -> None: ...

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self) -> Any:
        for line in self._lines:
            yield line


def test_agent_streams_tools_then_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[dict[str, Any]] = []
    rounds = [
        sse(
            {
                "tool_calls": [
                    {"index": 0, "id": "1", "function": {"name": "compare_", "arguments": ""}}
                ]
            },
            {"tool_calls": [{"index": 0, "function": {"name": "fields", "arguments": "{}"}}]},
        ),
        sse(
            {"reasoning_content": "weighing"},
            {"content": "<thi"},
            {"content": "nk>hidden</think>Change "},
            {"content": "**North field** first."},
        ),
    ]

    class FakeClient:
        def __init__(self, **_: Any) -> None: ...

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_: Any) -> None: ...

        def stream(
            self, method: str, url: str, json: dict[str, Any], headers: dict[str, str]
        ) -> FakeStream:
            sent.append(json)
            return FakeStream(rounds[len(sent) - 1])

    monkeypatch.setattr("api.assistant.httpx.AsyncClient", FakeClient)
    settings = get_settings().model_copy(update={"llm_api_key": "test"})
    body = AssistantRequest.model_validate(
        {
            "messages": [{"role": "user", "content": "Which field first?"}],
            "fields": [FIELD],
            "think": True,
        }
    )

    async def collect() -> list[dict[str, Any]]:
        return [e async for e in assistant.agent_events(body, body.fields, settings)]

    events = asyncio.run(collect())
    kinds = [e["type"] for e in events]
    assert kinds[0] == "tool" and events[0]["name"] == "compare_fields"
    assert "reasoning" in kinds
    text = "".join(e["text"] for e in events if e["type"] == "delta")
    assert text == "Change **North field** first."
    assert events[-1] == {"type": "done", "tools_used": ["compare_fields"], "demo_data": True}
    assert sent[0]["stream"] is True
    assert sent[0]["chat_template_kwargs"]["enable_thinking"] is True
    assert sent[1]["messages"][-1]["role"] == "tool"

    sent.clear()
    reply = asyncio.run(assistant.run_agent(body, body.fields, settings))
    assert reply.reply == "Change **North field** first."


def test_think_filter_handles_split_tags() -> None:
    f = assistant._ThinkFilter()
    out = "".join(f.feed(c) for c in ["Hi <th", "ink>secret</th", "ink> there <", "b>"])
    assert out + f.feed("") == "Hi  there <b>"


def test_chat_is_off_without_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        assistant, "get_settings", lambda: get_settings().model_copy(update={"llm_api_key": ""})
    )
    client = TestClient(app)
    response = client.post(
        "/v1/assistant/chat", json={"messages": [{"role": "user", "content": "Hi"}]}
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "assistant_off"
