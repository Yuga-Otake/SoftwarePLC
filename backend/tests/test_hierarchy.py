"""Tests for the group/hierarchy loader-time flattening (`plc/graph.py:flatten_program`).

The runtime engine itself has no concept of hierarchy: `type: "group"` nodes
are expanded into a flat, path-qualified execution graph at load time (see
docs/HIERARCHY.md for the JSON format). These tests verify:

  1. Child node ids are namespaced by path and stay unique after flattening.
  2. A group's boundary In/Out ports are resolved as pure wiring
     passthroughs (no group node survives into the flattened graph).
  3. Two levels of nesting resolve correctly end-to-end, including fan-out
     from a single internal output to multiple external targets.
  4. The bundled hierarchical example (`examples/conveyor_machine.json`)
     loads, flattens, and runs correctly through the full engine (E2E), and
     `GET`-equivalent `runtime.get_program()` still returns the original
     nested structure (not the flattened one).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

REPO_ROOT = BACKEND_DIR.parent
EXAMPLES_DIR = REPO_ROOT / "examples"

from plc.graph import flatten_program, PLCGraph  # noqa: E402
from plc.models import ProgramGraph, NodeDefinition, EdgeDefinition, GroupPort  # noqa: E402
from tests.conftest import make_program, Harness  # noqa: E402


def group_node(
    id: str,
    label: str,
    kind: str,
    inputs: list[dict],
    outputs: list[dict],
    children: ProgramGraph,
    position: dict | None = None,
) -> NodeDefinition:
    return NodeDefinition(
        id=id,
        type="group",
        label=label,
        kind=kind,
        inputs=[GroupPort(**p) for p in inputs],
        outputs=[GroupPort(**p) for p in outputs],
        children=children,
        position=position or {"x": 0, "y": 0},
    )


def test_flatten_simple_group_qualifies_child_ids():
    """A single group's children get path-prefixed ids in the flattened graph,
    and the group node itself does not appear."""
    inner = make_program(
        nodes=[
            {"id": "sr1", "type": "SR", "position": {"x": 0, "y": 0}},
        ],
        edges=[
            {"id": "e1", "source": "$parent", "source_handle": "s_in", "target": "sr1", "target_handle": "S"},
            {"id": "e2", "source": "$parent", "source_handle": "r_in", "target": "sr1", "target_handle": "R"},
            {"id": "e3", "source": "sr1", "source_handle": "Q", "target": "$parent", "target_handle": "q_out"},
        ],
    )
    g = group_node(
        "grp1", "Latch Group", "動作",
        inputs=[{"id": "s_in"}, {"id": "r_in"}],
        outputs=[{"id": "q_out"}],
        children=inner,
    )
    program = ProgramGraph(
        nodes=[
            NodeDefinition(id="in_start", type="DigitalInput", position={"x": 0, "y": 0}),
            NodeDefinition(id="in_stop", type="DigitalInput", position={"x": 0, "y": 0}),
            g,
            NodeDefinition(id="out_motor", type="DigitalOutput", position={"x": 0, "y": 0}),
        ],
        edges=[
            EdgeDefinition(id="oe1", source="in_start", source_handle="OUT", target="grp1", target_handle="s_in"),
            EdgeDefinition(id="oe2", source="in_stop", source_handle="OUT", target="grp1", target_handle="r_in"),
            EdgeDefinition(id="oe3", source="grp1", source_handle="q_out", target="out_motor", target_handle="IN"),
        ],
    )

    flat = flatten_program(program)

    flat_ids = {n.id for n in flat.nodes}
    # Group node itself must not survive.
    assert "grp1" not in flat_ids
    # Child node id is namespaced by path.
    assert "grp1/sr1" in flat_ids
    assert {"in_start", "in_stop", "out_motor"} <= flat_ids

    # Boundary ports resolved as direct passthrough wiring: in_start -> sr1.S,
    # in_stop -> sr1.R, sr1.Q -> out_motor.IN.
    edge_tuples = {(e.source, e.source_handle, e.target, e.target_handle) for e in flat.edges}
    assert ("in_start", "OUT", "grp1/sr1", "S") in edge_tuples
    assert ("in_stop", "OUT", "grp1/sr1", "R") in edge_tuples
    assert ("grp1/sr1", "Q", "out_motor", "IN") in edge_tuples


def test_flatten_two_level_nesting_and_fanout():
    """A group nested inside another group resolves through both levels, and
    a single internal signal fanning out to multiple external targets (via
    the group's output port feeding two different consumers) produces
    multiple flattened edges from the same leaf source."""
    innermost = make_program(
        nodes=[{"id": "sr1", "type": "SR", "position": {"x": 0, "y": 0}}],
        edges=[
            {"id": "ie1", "source": "$parent", "source_handle": "s_in", "target": "sr1", "target_handle": "S"},
            {"id": "ie2", "source": "$parent", "source_handle": "r_in", "target": "sr1", "target_handle": "R"},
            {"id": "ie3", "source": "sr1", "source_handle": "Q", "target": "$parent", "target_handle": "q_out"},
        ],
    )
    action = group_node(
        "action1", "Start/Stop Action", "動作",
        inputs=[{"id": "s_in"}, {"id": "r_in"}],
        outputs=[{"id": "q_out"}],
        children=innermost,
    )
    process_children = ProgramGraph(
        nodes=[action, NodeDefinition(id="local_out", type="DigitalOutput", position={"x": 0, "y": 0})],
        edges=[
            EdgeDefinition(id="pe1", source="$parent", source_handle="p_start", target="action1", target_handle="s_in"),
            EdgeDefinition(id="pe2", source="$parent", source_handle="p_stop", target="action1", target_handle="r_in"),
            EdgeDefinition(id="pe3", source="action1", source_handle="q_out", target="local_out", target_handle="IN"),
            EdgeDefinition(id="pe4", source="action1", source_handle="q_out", target="$parent", target_handle="p_running"),
        ],
    )
    process = group_node(
        "process1", "Feed Process", "工程",
        inputs=[{"id": "p_start"}, {"id": "p_stop"}],
        outputs=[{"id": "p_running"}],
        children=process_children,
    )
    program = ProgramGraph(
        nodes=[
            NodeDefinition(id="x_start", type="DigitalInput", position={"x": 0, "y": 0}),
            NodeDefinition(id="x_stop", type="DigitalInput", position={"x": 0, "y": 0}),
            process,
            NodeDefinition(id="y_running", type="DigitalOutput", position={"x": 0, "y": 0}),
        ],
        edges=[
            EdgeDefinition(id="oe1", source="x_start", source_handle="OUT", target="process1", target_handle="p_start"),
            EdgeDefinition(id="oe2", source="x_stop", source_handle="OUT", target="process1", target_handle="p_stop"),
            EdgeDefinition(id="oe3", source="process1", source_handle="p_running", target="y_running", target_handle="IN"),
        ],
    )

    flat = flatten_program(program)
    flat_ids = {n.id for n in flat.nodes}

    assert "process1" not in flat_ids
    assert "process1/action1" not in flat_ids  # nested group also gone
    assert "process1/action1/sr1" in flat_ids
    assert "process1/local_out" in flat_ids

    edge_tuples = {(e.source, e.source_handle, e.target, e.target_handle) for e in flat.edges}
    # External inputs reach all the way down to the innermost SR.
    assert ("x_start", "OUT", "process1/action1/sr1", "S") in edge_tuples
    assert ("x_stop", "OUT", "process1/action1/sr1", "R") in edge_tuples

    # Fan-out: sr1.Q feeds BOTH the process-local output AND (through two
    # levels of output-port passthrough) the outer y_running output.
    sr_q_targets = {
        (e.target, e.target_handle)
        for e in flat.edges
        if e.source == "process1/action1/sr1" and e.source_handle == "Q"
    }
    assert ("process1/local_out", "IN") in sr_q_targets
    assert ("y_running", "IN") in sr_q_targets
    assert len(sr_q_targets) == 2


def test_flatten_preserves_plain_program_unchanged():
    """A flat (non-hierarchical) program with no group nodes passes through
    flatten_program with ids/edges intact (backward compatibility)."""
    data = json.loads((EXAMPLES_DIR / "start_stop.json").read_text(encoding="utf-8"))
    program = ProgramGraph(**data)
    flat = flatten_program(program)

    assert {n.id for n in flat.nodes} == {n.id for n in program.nodes}
    assert len(flat.edges) == len(program.edges)
    original_tuples = {(e.source, e.source_handle, e.target, e.target_handle) for e in program.edges}
    flat_tuples = {(e.source, e.source_handle, e.target, e.target_handle) for e in flat.edges}
    assert original_tuples == flat_tuples


def test_plcgraph_uses_flattened_ids_for_execution():
    """PLCGraph (the execution-facing wrapper) exposes flattened node ids,
    not the original group ids."""
    data = json.loads((EXAMPLES_DIR / "conveyor_machine.json").read_text(encoding="utf-8"))
    program = ProgramGraph(**data)
    g = PLCGraph(program)

    assert "machine1" not in g.nodes
    assert "machine1/process_feed/startstop_action/sr1" in g.nodes
    assert "machine1/process_transport/timer_action/ton1" in g.nodes


@pytest.mark.asyncio
async def test_conveyor_hierarchy_e2e():
    """Load the bundled 3-level hierarchical example and drive it through a
    full start -> timer-elapses -> stop cycle, verifying outputs at every
    nesting depth update correctly."""
    data = json.loads((EXAMPLES_DIR / "conveyor_machine.json").read_text(encoding="utf-8"))
    program = ProgramGraph(**data)
    h = Harness(program, scan_interval_ms=100.0)

    await h.scan()
    assert h.out("y_running") is False
    assert h.out("y_done") is False

    h.set_io("x_start", True)
    await h.scan()
    assert h.out("y_running") is True
    assert h.out("machine1/process_feed/y_feed") is True
    assert h.out("machine1/process_transport/y_transport") is True
    assert h.out("y_done") is False

    # TON in machine1/process_transport/timer_action fires after 3000ms.
    await h.advance(2900)
    assert h.out("y_done") is False
    await h.advance(100)
    assert h.out("y_done") is True
    assert h.out("machine1/process_transport/timer_action/ton1", "Q") is True

    # Release start (x_stop defaults False -> NOT -> R=True resets, same
    # set-dominant SR quirk as examples/start_stop.json).
    h.set_io("x_start", False)
    await h.scan()
    assert h.out("y_running") is False
    assert h.out("machine1/process_feed/y_feed") is False
    assert h.out("machine1/process_transport/y_transport") is False
    assert h.out("y_done") is False


def test_get_program_returns_nested_structure_not_flattened():
    """`PLCRuntime.get_program()` (backing `GET /api/program`) must return the
    original nested tree for frontend display, even though the internal
    execution graph is flattened."""
    from plc.runtime import PLCRuntime
    from plc.clock import VirtualClock

    data = json.loads((EXAMPLES_DIR / "conveyor_machine.json").read_text(encoding="utf-8"))
    program = ProgramGraph(**data)

    rt = PLCRuntime(clock=VirtualClock())
    rt.load_program(program)

    returned = rt.get_program()
    top_level_ids = {n.id for n in returned.nodes}
    assert "machine1" in top_level_ids  # group node preserved, not flattened

    machine1 = next(n for n in returned.nodes if n.id == "machine1")
    assert machine1.type == "group"
    assert machine1.kind == "装置"
    assert machine1.children is not None
    child_ids = {n.id for n in machine1.children.nodes}
    assert "process_feed" in child_ids
    assert "process_transport" in child_ids
