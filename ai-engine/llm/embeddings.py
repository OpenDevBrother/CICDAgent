from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def get_embeddings():
    """Return an embeddings instance based on EMBEDDING_PROVIDER env var.

    Defaults to 'openai' for backward compatibility.
    Set EMBEDDING_PROVIDER=bedrock to use Amazon Titan V2.
    """
    provider = os.getenv("EMBEDDING_PROVIDER", "openai").strip().lower()

    if provider == "bedrock":
        from langchain_aws import BedrockEmbeddings

        model_id = os.getenv("EMBEDDING_BEDROCK_MODEL", "amazon.titan-embed-text-v2:0")
        region = os.getenv("AWS_BEDROCK_REGION", "us-east-1")
        return BedrockEmbeddings(
            model_id=model_id,
            region_name=region,
        )

    from langchain_openai import OpenAIEmbeddings

    return OpenAIEmbeddings(model="text-embedding-3-small")
