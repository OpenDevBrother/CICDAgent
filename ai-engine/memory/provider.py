import os

VECTOR_PROVIDER = os.getenv("VECTOR_PROVIDER", "mongodb").strip().lower()

if VECTOR_PROVIDER == "qdrant":
    from memory.store_qdrant import store_fix_from_api, store_test_plan
    from memory.retriever_qdrant import get_similar_past_fixes, get_similar_past_test_plans
else:
    from memory.store import store_fix_from_api, store_test_plan
    from memory.retriever import get_similar_past_fixes, get_similar_past_test_plans

__all__ = [
    "store_fix_from_api",
    "store_test_plan",
    "get_similar_past_fixes",
    "get_similar_past_test_plans",
]
