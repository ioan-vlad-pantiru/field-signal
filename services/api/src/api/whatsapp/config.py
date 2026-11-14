"""Runtime settings for the Field Signal WhatsApp bot, read from the environment and `.env`."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

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

    # Twilio
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_whatsapp_from: str = "whatsapp:+14155238886"  # sandbox sender
    validate_signature: bool = Field(True, validation_alias="TWILIO_VALIDATE_SIGNATURE")
    # Exact public URL Twilio calls. Signature validation is computed over it,
    # so it must match the sandbox "When a message comes in" field.
    public_webhook_url: str | None = None

    # Web app, for the "Full results" link.
    results_base_url: str = Field(
        "https://fieldsignal.land", validation_alias="FIELDSIGNAL_RESULTS_BASE_URL"
    )

    # Demo safety net: serve the cached analysis if the analysis fails.
    fallback_to_demo: bool = Field(True, validation_alias="BOT_FALLBACK_TO_DEMO")
    demo_analysis_path: Path = Field(
        HERE / "demo_analysis.json", validation_alias="BOT_DEMO_ANALYSIS_PATH"
    )

    # LLM: any OpenAI-compatible chat completions endpoint (Qwen on Alibaba Model Studio
    # by default). The bot answers free-text questions only when LLM_API_KEY is set.
    llm_base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    llm_api_key: str = ""
    llm_model: str = "qwen-flash"
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
