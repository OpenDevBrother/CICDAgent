from __future__ import annotations

import datetime
import logging
import os
import uuid
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models

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


def _get_embeddings_client():
    from llm.embeddings import get_embeddings

    return get_embeddings()


def _generate_embedding(text: str) -> list[float]:
    embeddings = _get_embeddings_client()
    vector = embeddings.embed_documents([text])[0]
    return [float(value) for value in vector]


def _read_collection_vector_size(collection_info: Any) -> int | None:
    vectors = getattr(getattr(getattr(collection_info, "config", None), "params", None), "vectors", None)
    if vectors is None:
        return None

    size = getattr(vectors, "size", None)
    if isinstance(size, int):
        return size

    if isinstance(vectors, dict):
        for vector_config in vectors.values():
            nested_size = getattr(vector_config, "size", None)
            if isinstance(nested_size, int):
                return nested_size

    return None


def _ensure_collection(client: QdrantClient, collection_name: str, vector_size: int) -> None:
    try:
        if client.collection_exists(collection_name):
            info = client.get_collection(collection_name)
            existing_size = _read_collection_vector_size(info)
            if existing_size is not None and existing_size != vector_size:
                raise RuntimeError(
                    f"Qdrant collection '{collection_name}' has vector size {existing_size}, "
                    f"but the current embedding provider returned size {vector_size}."
                )
            return

        client.create_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
        )
        logger.info("Created Qdrant collection %s with vector size %s", collection_name, vector_size)
    except RuntimeError:
        raise
    except Exception as exc:
        logger.error("Failed to ensure Qdrant collection %s: %s", collection_name, exc)
        raise


def _upsert_memory(kind: str, text: str, payload: dict[str, Any]) -> bool:
    client = _get_client()
    if not client:
        return False

    try:
        vector = _generate_embedding(text)
        collection_name = _get_collection_name(kind)
        _ensure_collection(client, collection_name, len(vector))

        point = models.PointStruct(
            id=f"{kind}-{uuid.uuid4().hex[:12]}",
            vector=vector,
            payload={**payload, "memory_text": text},
        )

        client.upsert(collection_name=collection_name, points=[point], wait=True)
        logger.info("Stored %s memory in Qdrant collection %s", kind, collection_name)
        return True
    except Exception as exc:
        logger.error("Failed to store %s memory in Qdrant: %s", kind, exc)
        return False


def store_fix_from_api(data: dict[str, Any]) -> bool:
    failed_tests = data.get("failed_tests", [])
    error_snippets = [item.get("error", "")[:200] for item in failed_tests[:5]]

    text = "\n".join(
        [
            str(data.get("git_diff", ""))[:3000],
            str(data.get("changed_files", [])),
            str(data.get("proposed_fix", "")),
            *error_snippets,
        ]
    )

    payload = {
        "rca_type": str(data.get("rca_type", "")),
        "rca_report": str(data.get("rca_report", "")),
        "proposed_fix": str(data.get("proposed_fix", "")),
        "proposed_patch": str(data.get("proposed_patch", "")),
        "file_edits": data.get("file_edits", []),
        "target_files": data.get("target_files", []),
        "fix_branch": str(data.get("fix_branch", "")),
        "confidence_score": float(data.get("confidence_score", 0)),
        "repo_url": str(data.get("repo_url", "")),
        "changed_files": data.get("changed_files", []),
        "test_plan": str(data.get("test_plan", "")),
        "session_id": str(data.get("session_id", "")),
        "pr_url": str(data.get("pr_url", "")),
        "pr_number": data.get("pr_number"),
        "created_at": datetime.datetime.utcnow().isoformat(),
    }

    return _upsert_memory("healer", text, payload)


def store_test_plan(data: dict[str, Any]) -> bool:
    test_plan = str(data.get("test_plan", ""))
    if not test_plan.strip():
        return False

    text = "\n".join(
        [
            str(data.get("changed_files", [])),
            str(data.get("git_diff", ""))[:3000],
            test_plan[:3000],
        ]
    )

    payload = {
        "test_plan": test_plan,
        "changed_files": data.get("changed_files", []),
        "repo_url": str(data.get("repo_url", "")),
        "total_tests": int(data.get("total_tests", 0)),
        "passed_tests": int(data.get("passed_tests", 0)),
        "session_id": str(data.get("session_id", "")),
        "created_at": datetime.datetime.utcnow().isoformat(),
    }

    return _upsert_memory("architect", text, payload)
