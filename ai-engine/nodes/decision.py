from __future__ import annotations

import json
import logging
import re
from textwrap import dedent

from graph.state import SentinelState
from llm.client import get_judge_llm

logger = logging.getLogger(__name__)

JUDGE_SYSTEM_PROMPT = dedent("""\
    You are a test failure classifier for MindFlayer.
    Given failed test results, classify EACH failure as one of:
    - "bug": The application code has a real bug causing this test to fail.
    - "bad_test": The test itself is wrong (wrong selector, wrong assertion, stale test).
    - "flaky": The failure is intermittent (timing, network, race condition).

    Return strict JSON with no extra text:
    {
      "classifications": [
        { "test_name": "...", "category": "bug", "reason": "..." }
      ],
      "overall": "bug"
    }

    "overall" must be the dominant category — the one that applies to the most failures.
""")


def decision_node(state: SentinelState) -> dict:
    results = state.get("test_results")
    if results is None:
        raise ValueError("state.test_results is required before decision step")
    if not isinstance(results, list):
        raise ValueError("state.test_results must be a list")

    non_passing = []
    for item in results:
        if not isinstance(item, dict):
            raise ValueError("each item in state.test_results must be a dict")
        status = item.get("status")
        if status not in {"passed", "failed", "skipped"}:
            raise ValueError(
                "each test result must include status as 'passed', 'failed', or 'skipped'"
            )
        if status in {"failed", "skipped"}:
            non_passing.append(item)

    if not non_passing:
        return {"decision": "all_pass"}

    try:
        llm = get_judge_llm()
        if llm is None:
            return {"decision": "has_failures"}

        failure_text = json.dumps(non_passing[:5], indent=2, default=str)
        response = llm.invoke([
            {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
            {"role": "user", "content": f"Failed tests:\n{failure_text}"},
        ])
        content = response.content if isinstance(response.content, str) else str(response.content)

        payload = _parse_judge_response(content)
        classifications = payload.get("classifications", [])
        overall = payload.get("overall", "bug")

        if overall not in {"bug", "bad_test", "flaky"}:
            overall = "bug"

        quarantined = [c for c in classifications if c.get("category") == "flaky"]

        return {
            "decision": overall,
            "judge_classification": overall,
            "judge_classifications": classifications,
            "quarantined_tests": quarantined,
        }
    except Exception as exc:
        logger.warning("Judge LLM classification failed, falling back: %s", exc)
        return {"decision": "has_failures"}


def _parse_judge_response(content: str) -> dict:
    text = content.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return json.loads(text[start : end + 1])
    raise ValueError("Judge response did not contain valid JSON")
