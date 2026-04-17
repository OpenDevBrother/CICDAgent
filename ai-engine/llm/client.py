from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

Provider = Literal["openai", "anthropic", "bedrock"]

# Ensure .env is loaded even when modules are invoked directly (e.g. python -c ...)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def get_provider() -> Provider:
    provider = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    if provider not in {"openai", "anthropic", "bedrock"}:
        raise ValueError(f"Unsupported LLM_PROVIDER '{provider}'. Use 'openai', 'anthropic', or 'bedrock'.")
    return provider  # type: ignore[return-value]


def is_real_only_mode() -> bool:
    raw = os.getenv("LLM_REAL_ONLY", "false").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _get_bedrock_llm(model_env_var: str, default_model: str) -> object:
    from langchain_aws import ChatBedrockConverse

    region = os.getenv("AWS_BEDROCK_REGION", "us-east-1")
    model_id = os.getenv(model_env_var, default_model)
    return ChatBedrockConverse(
        model=model_id,
        region_name=region,
        temperature=0,
    )


def get_architect_llm() -> Optional[object]:
    provider = get_provider()

    if provider == "bedrock":
        return _get_bedrock_llm("ARCHITECT_BEDROCK_MODEL", "qwen.qwen3-coder-next")

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            return None
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        return ChatOpenAI(model=model, temperature=0)

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    return ChatAnthropic(model=model, temperature=0)


def get_healer_llm() -> Optional[object]:
    provider = get_provider()

    if provider == "bedrock":
        return _get_bedrock_llm("HEALER_BEDROCK_MODEL", "deepseek.v3.2")

    return get_architect_llm()


def get_judge_llm() -> Optional[object]:
    provider = get_provider()

    if provider == "bedrock":
        return _get_bedrock_llm("JUDGE_BEDROCK_MODEL", "zai.glm-5")

    return get_architect_llm()
