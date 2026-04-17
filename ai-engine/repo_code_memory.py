from __future__ import annotations

import logging
import os
import uuid
from typing import Any

from qdrant_client.http import models

from llm.embeddings import get_embeddings
from memory.store_qdrant import _ensure_collection, _get_client, _read_collection_vector_size

logger = logging.getLogger(__name__)


def _get_collection_name() -> str:
    return os.getenv("QDRANT_CODE_COLLECTION", "repo-code-chunks").strip() or "repo-code-chunks"


def _normalize_point_id(raw_id: Any) -> str:
    value = str(raw_id or "").strip()
    if not value:
        return str(uuid.uuid4())

    try:
        return str(uuid.UUID(value))
    except ValueError:
        # Qdrant accepts uint64 or UUID point IDs. We derive a stable UUID from
        # the human-readable chunk identifier so repeat indexing upserts cleanly.
        return str(uuid.uuid5(uuid.NAMESPACE_URL, value))


def _ensure_repo_indexes(client: Any, collection_name: str) -> None:
    # Qdrant requires a payload index for efficient keyword filtering on repo_key.
    client.create_payload_index(
        collection_name=collection_name,
        field_name="repo_key",
        field_schema="keyword",
        wait=True,
    )


def _repo_filter(repo_key: str) -> models.Filter:
    return models.Filter(
        must=[
            models.FieldCondition(
                key="repo_key",
                match=models.MatchValue(value=repo_key),
            )
        ]
    )


def _embed_documents(texts: list[str]) -> list[list[float]]:
    embeddings = get_embeddings()
    vectors = embeddings.embed_documents(texts)
    return [[float(value) for value in vector] for vector in vectors]


def _embed_query(text: str) -> list[float]:
    embeddings = get_embeddings()
    vector = embeddings.embed_query(text)
    return [float(value) for value in vector]


def get_repo_code_status(repo_key: str) -> dict[str, Any]:
    client = _get_client()
    if not client:
        return {
            "qdrant_configured": False,
            "collection_exists": False,
            "code_index_ready": False,
            "code_index_count": 0,
            "collection_name": _get_collection_name(),
        }

    collection_name = _get_collection_name()
    collection_exists = False
    code_index_count = 0

    try:
        collection_exists = client.collection_exists(collection_name)
        if collection_exists:
            _ensure_repo_indexes(client, collection_name)
            count_result = client.count(
                collection_name=collection_name,
                count_filter=_repo_filter(repo_key),
                exact=True,
            )
            code_index_count = int(getattr(count_result, "count", 0) or 0)
    except Exception as exc:
        logger.error("Failed to read repo-code status from Qdrant: %s", exc)

    return {
        "qdrant_configured": True,
        "collection_exists": collection_exists,
        "code_index_ready": code_index_count > 0,
        "code_index_count": code_index_count,
        "collection_name": collection_name,
    }


def upsert_repo_code_chunks(repo_key: str, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    client = _get_client()
    if not client:
        raise RuntimeError("Qdrant client is not configured. Set QDRANT_URL and QDRANT_API_KEY.")

    if not chunks:
        return {"stored": 0, "collection_name": _get_collection_name()}

    texts = [str(chunk.get("text", "")).strip() for chunk in chunks]
    texts = [text for text in texts if text]
    if not texts:
        return {"stored": 0, "collection_name": _get_collection_name()}

    vectors = _embed_documents(texts)
    if not vectors:
        return {"stored": 0, "collection_name": _get_collection_name()}

    collection_name = _get_collection_name()
    _ensure_collection(client, collection_name, len(vectors[0]))
    _ensure_repo_indexes(client, collection_name)

    points: list[models.PointStruct] = []
    for chunk, vector in zip(chunks, vectors):
        payload = {
            "repo_key": repo_key,
            "source_id": str(chunk.get("id") or ""),
            "relative_path": str(chunk.get("relative_path", "")),
            "language": str(chunk.get("language", "text")),
            "chunk_type": str(chunk.get("chunk_type", "code")),
            "start_line": int(chunk.get("start_line", 1) or 1),
            "end_line": int(chunk.get("end_line", chunk.get("start_line", 1)) or 1),
            "symbol_hints": chunk.get("symbol_hints", []),
            "text": str(chunk.get("text", "")),
            "snippet": str(chunk.get("text", ""))[:800],
        }
        points.append(
            models.PointStruct(
                id=_normalize_point_id(chunk.get("id") or payload["relative_path"]),
                vector=vector,
                payload=payload,
            )
        )

    client.upsert(collection_name=collection_name, points=points, wait=True)
    return {"stored": len(points), "collection_name": collection_name}


def search_repo_code(repo_key: str, query: str, limit: int = 6) -> list[dict[str, Any]]:
    client = _get_client()
    if not client:
        return []

    collection_name = _get_collection_name()

    try:
        if not client.collection_exists(collection_name):
            return []

        _ensure_repo_indexes(client, collection_name)
        response = client.query_points(
            collection_name=collection_name,
            query=_embed_query(query),
            query_filter=_repo_filter(repo_key),
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )

        points = getattr(response, "points", response)
        results: list[dict[str, Any]] = []
        for point in points or []:
            payload = dict(getattr(point, "payload", {}) or {})
            results.append(
                {
                    "relative_path": payload.get("relative_path"),
                    "start_line": payload.get("start_line"),
                    "end_line": payload.get("end_line"),
                    "language": payload.get("language"),
                    "symbol_hints": payload.get("symbol_hints", []),
                    "snippet": payload.get("snippet") or payload.get("text", ""),
                    "text": payload.get("text", ""),
                    "score": float(getattr(point, "score", 0.0) or 0.0),
                }
            )
        return results
    except Exception as exc:
        logger.error("Failed to search repo-code collection in Qdrant: %s", exc)
        return []
