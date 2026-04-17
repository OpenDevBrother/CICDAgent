from __future__ import annotations

import logging

from langgraph.graph import END, StateGraph

from graph.state import SentinelState
from nodes.architect import architect_node
from nodes.courier_execute import courier_execute_node
from nodes.courier_decision import courier_decision_node
from nodes.decision import decision_node
from nodes.healer import healer_node
from nodes.run_tests import run_tests_node

logger = logging.getLogger(__name__)


def quarantine_node(state: SentinelState) -> dict:
    """Log flaky tests and skip healing."""
    quarantined = state.get("quarantined_tests", [])
    logger.info("Quarantining %d flaky test(s)", len(quarantined))
    return {
        "dispatch_action": "quarantine",
        "dispatch_result_type": "quarantined",
    }


def route_after_decision(state: SentinelState) -> str:
    decision = state.get("decision")
    if decision == "all_pass":
        return "done"
    if decision in ("bug", "bad_test", "has_failures"):
        return "healer"
    if decision == "flaky":
        return "quarantine"
    return "healer"


def build_phase1_graph():
    builder = StateGraph(SentinelState)

    builder.add_node("architect", architect_node)
    builder.add_node("run_tests", run_tests_node)
    builder.add_node("decision", decision_node)
    builder.add_node("healer", healer_node)
    builder.add_node("courier_decision", courier_decision_node)
    builder.add_node("courier_execute", courier_execute_node)
    builder.add_node("quarantine", quarantine_node)

    builder.set_entry_point("architect")
    builder.add_edge("architect", "run_tests")
    builder.add_edge("run_tests", "decision")
    builder.add_conditional_edges(
        "decision",
        route_after_decision,
        {
            "healer": "healer",
            "quarantine": "quarantine",
            "done": END,
        },
    )
    builder.add_edge("healer", "courier_decision")
    builder.add_edge("courier_decision", "courier_execute")
    builder.add_edge("courier_execute", END)
    builder.add_edge("quarantine", END)

    return builder.compile()


def build_healer_graph():
    """Graph that starts at decision — used when test results are pre-supplied."""
    builder = StateGraph(SentinelState)

    builder.add_node("decision", decision_node)
    builder.add_node("healer", healer_node)
    builder.add_node("courier_decision", courier_decision_node)
    builder.add_node("courier_execute", courier_execute_node)
    builder.add_node("quarantine", quarantine_node)

    builder.set_entry_point("decision")
    builder.add_conditional_edges(
        "decision",
        route_after_decision,
        {
            "healer": "healer",
            "quarantine": "quarantine",
            "done": END,
        },
    )
    builder.add_edge("healer", "courier_decision")
    builder.add_edge("courier_decision", "courier_execute")
    builder.add_edge("courier_execute", END)
    builder.add_edge("quarantine", END)

    return builder.compile()


def build_healer_only_graph():
    """Healer-only graph: decision → healer → END.

    Returns RCA + proposed patch without executing courier actions, so the
    caller (Next.js orchestrator) can bundle fixes into a unified PR.
    """
    builder = StateGraph(SentinelState)

    builder.add_node("decision", decision_node)
    builder.add_node("healer", healer_node)
    builder.add_node("quarantine", quarantine_node)

    builder.set_entry_point("decision")
    builder.add_conditional_edges(
        "decision",
        route_after_decision,
        {
            "healer": "healer",
            "quarantine": "quarantine",
            "done": END,
        },
    )
    builder.add_edge("healer", END)
    builder.add_edge("quarantine", END)

    return builder.compile()
