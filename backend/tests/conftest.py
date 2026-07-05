"""Shared fixtures/helpers for the fast (virtual-clock) pytest suite.

All tests here avoid real-time sleeping: they build a `PLCRuntime` wired to a
`VirtualClock` and advance time explicitly via `advance()`. This mirrors what
`scripts/scenario_runner.py` does, so behavior verified here matches the
headless scenario runner exactly.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# The general pytest suite (route smoke tests, scheduler tests) spins up
# `TestClient(app)` against the full `main.py` lifespan, which would
# otherwise also bind the real 8010/8020 sub-server ports (see
# plc/subservers.py) on every such test -- slow and needless for tests that
# aren't about networking. `tests/test_network.py` exercises the sub-server
# lifecycle directly (with its own isolated ports) and unsets this.
os.environ.setdefault("PLC_DISABLE_SUBSERVERS", "1")

REPO_ROOT = BACKEND_DIR.parent
EXAMPLES_DIR = REPO_ROOT / "examples"

from plc.clock import VirtualClock  # noqa: E402
from plc.models import ProgramGraph, NodeDefinition, EdgeDefinition  # noqa: E402
from plc.runtime import PLCRuntime  # noqa: E402


class Harness:
    """Thin wrapper around PLCRuntime + VirtualClock for concise tests."""

    def __init__(self, program: ProgramGraph, scan_interval_ms: float = 100.0):
        self.clock = VirtualClock(start_ms=0.0)
        self.runtime = PLCRuntime(clock=self.clock)
        self.runtime.scan_interval_ms = scan_interval_ms
        self.runtime.load_program(program)

    async def scan(self, n: int = 1):
        for _ in range(n):
            await self.runtime.run_scan()

    async def advance(self, delta_ms: float):
        """Advance the virtual clock by delta_ms, one scan per
        scan_interval_ms tick (same semantics as the scenario runner)."""
        step_ms = self.runtime.scan_interval_ms
        remaining = delta_ms
        while remaining > 0:
            tick = min(step_ms, remaining)
            self.clock.advance_ms(tick)
            await self.runtime.run_scan()
            remaining -= tick

    def set_io(self, node_id: str, value: bool):
        self.runtime.set_io(node_id, value)

    def out(self, node_id: str, port: str = "OUT") -> Any:
        return self.runtime.get_current_state().get(node_id, {}).get(port)

    def node_state(self, node_id: str) -> dict:
        return self.runtime.get_node_states().get(node_id, {})


def make_program(nodes: list[dict], edges: list[dict]) -> ProgramGraph:
    return ProgramGraph(
        nodes=[NodeDefinition(**n) for n in nodes],
        edges=[EdgeDefinition(**e) for e in edges],
    )


def load_example_program() -> ProgramGraph:
    data = json.loads((EXAMPLES_DIR / "start_stop.json").read_text(encoding="utf-8"))
    return ProgramGraph(**data)


@pytest.fixture
def harness_factory():
    """Returns a factory so tests can control scan_interval_ms per-case."""
    def _make(program: ProgramGraph, scan_interval_ms: float = 100.0) -> Harness:
        return Harness(program, scan_interval_ms=scan_interval_ms)
    return _make


@pytest.fixture
def start_stop_harness() -> Harness:
    return Harness(load_example_program(), scan_interval_ms=100.0)
