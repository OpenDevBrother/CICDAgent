from __future__ import annotations

import logging
import os
from typing import Any

from qdrant_client import QdrantClient

logger = logging.getLogger(__name__)


def _get_client() -> QdrantClient | None:
    url = os.getenv("QDRANT_URL", "").strip()
    api_key = os.getenv("QDRANT_API_KEY", "").strip()

    if not url or not api_key:
        logger.warning("Qdrant client not initialized because QDRANT_URL or QDRANT_API_KEY is missing.")
        return None

    try:
        return QdrantClient(url=url, api_key=api_key, timeout=30)
    except Exception as exc:
        logger.error("Failed to initialize Qdrant client: %s", exc)
        return None


def _get_collection_name(kind: str) -> str:
    if kind == "architect":
        return os.getenv("QDRANT_ARCHITECT_COLLECTION", "architect-memory").strip() or "architect-memory"
    return os.getenv("QDRANT_HEALER_COLLECTION", "healer-memory").strip() or "healer-memory"


def _embed_query(text: str) -> list[float]:
    from llm.embeddings import get_embeddings

    embeddings = get_embeddings()
    vector = embeddings.embed_query(text)
    return [float(value) for value in vector]


def _query_collection(kind: str, query_text: str, top_k: int) -> list[dict[str, Any]]:
    client = _get_client()
    if not client:
        return []

    try:
        response = client.query_points(
            collection_name=_get_collection_name(kind),
            query=_embed_query(query_text),
            limit=top_k,
            with_payload=True,
            with_vectors=False,
        )

        points = getattr(response, "points", response)
        results: list[dict[str, Any]] = []
        for point in points or []:
            payload = dict(getattr(point, "payload", {}) or {})
            payload.pop("memory_text", None)
            results.append(payload)

        logger.info("Retrieved %d %s memories from Qdrant", len(results), kind)
        return results
    except Exception as exc:
        logger.error("Failed to query %s memory from Qdrant: %s", kind, exc)
        return []


def get_similar_past_fixes(
    git_diff: str,
    changed_files: list,
    failed_tests: list,
    top_k: int = 3,
) -> list[dict]:
    error_snippets = [item.get("error", "") for item in (failed_tests or [])[:3]]
    query_text = "\n".join([
        git_diff[:2000],
        str(changed_files),
        *error_snippets,
    ])
    return _query_collection("healer", query_text, top_k)


def get_similar_past_test_plans(
    changed_files: list[str],
    git_diff: str,
    top_k: int = 2,
) -> list[dict[str, Any]]:
    query_text = "\n".join([
        str(changed_files),
        git_diff[:3000],
    ])
    return _query_collection("architect", query_text, top_k)
