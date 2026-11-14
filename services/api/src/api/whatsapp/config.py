"""Runtime settings for the Field Signal WhatsApp bot, read from the environment and `.env`."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from api.settings import REPO_ROOT

HERE = Path(__file__).parent


class BotSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    # Meta WhatsApp Cloud API (developers.facebook.com → your app → WhatsApp → API Setup)
    whatsapp_token: str = ""  # System User token (the console's test token expires in 24 h)
    whatsapp_phone_number_id: str = ""  # sender number's ID, not the phone number itself
    whatsapp_app_secret: str = ""  # App settings → Basic; signs every webhook call
    whatsapp_verify_token: str = ""  # any string; must match the webhook config in Meta
    whatsapp_graph_version: str = "v23.0"
    validate_signature: bool = Field(True, validation_alias="WHATSAPP_VALIDATE_SIGNATURE")

    # Web app, for the "Full results" link.
    results_base_url: str = Field(
        "https://fieldsignal.land", validation_alias="FIELDSIGNAL_RESULTS_BASE_URL"
    )

    # Demo safety net: serve the cached analysis if the analysis fails.
    fallback_to_demo: bool = Field(True, validation_alias="BOT_FALLBACK_TO_DEMO")
    demo_analysis_path: Path = Field(
        HERE / "demo_analysis.json", validation_alias="BOT_DEMO_ANALYSIS_PATH"
    )

    # LLM: any OpenAI-compatible chat completions endpoint (Qwen on CCRO Labs inference by
    # default). The bot answers free-text questions only when LLM_API_KEY is set.
    llm_base_url: str = "https://local-inference-api.ccrolabs.com/v1"
    llm_api_key: str = ""
    llm_model: str = "qwen"
    # Extra JSON merged into each request. The default turns off Qwen's thinking step, which
    # otherwise spends the token budget before any answer is written.
    llm_extra_body: dict[str, Any] = {"chat_template_kwargs": {"enable_thinking": False}}
    llm_timeout_s: float = 20
    llm_max_tokens: int = 400
    knowledge_path: Path = Field(HERE / "knowledge.md", validation_alias="BOT_KNOWLEDGE_PATH")

    # Sessions (in memory only; nothing is persisted)
    session_ttl_s: int = Field(7200, validation_alias="BOT_SESSION_TTL_S")
    history_turns: int = Field(8, validation_alias="BOT_HISTORY_TURNS")
    default_lang: str = Field("ro", validation_alias="BOT_DEFAULT_LANG")


@lru_cache
def get_settings() -> BotSettings:
    return BotSettings()
