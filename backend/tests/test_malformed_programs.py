"""Robustness tests for malformed / pathological program graphs.

The engine has no schema-level rejection of nonsensical graphs (unknown node
types, dangling edges, self-loops, duplicate ids, empty groups, mismatched
group ports) -- `PUT /api/program` accepts any well-typed `ProgramGraph`.
These tests document and lock in the current (intentionally permissive)
behavior: such graphs must never crash a scan cycle, either through the
in-process API route or the bare PLCGraph/flatten_program path. Where a
malformed load should be REJECTED with a clean HTTP error rather than
silently accepted, that is called out explicitly.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from plc.models import ProgramGraph, NodeDefinition, EdgeDefinition, GroupPort  # noqa: E402
from plc.runtime import runtime  # noqa: E402
from tests.conftest import Harness, make_program  # noqa: E402


@pytest.fixture
def client():
    from main import app
    with TestClient(app) as c:
        yield c


# ── Dangling / malformed references (engine-level, no HTTP) ────────────────

async def test_edge_to_nonexistent_node_does_not_crash():
    prog = make_program(
        nodes=[{"id": "a", "type": "DigitalInput", "params": {"value": True}}],
        edges=[{"id": "e1", "source": "a", "source_handle": "OUT", "target": "ghost", "target_handle": "IN"}],
    )
    h = Harness(prog)
    await h.scan()
    assert h.out("a") is True  # existing node unaffected


async def test_edge_from_nonexistent_node_does_not_crash():
    prog = make_program(
        nodes=[{"id": "b", "type": "DigitalOutput"}],
        edges=[{"id": "e1", "source": "ghost", "source_handle": "OUT", "target": "b", "target_handle": "IN"}],
    )
    h = Harness(prog)
    await h.scan()
    # Missing source -> input never resolves -> DigitalOutput defaults False.
    assert h.out("b") is False


async def test_unknown_node_type_is_skipped_not_crashed():
    """A node whose `type` isn't in NODE_CATALOG or CUSTOM_BLOCKS (e.g. saved
    with a typo, or a custom block that was later deleted) must be silently
    skipped during execution rather than raising."""
    prog = make_program(
        nodes=[{"id": "a", "type": "NoSuchBlockType"}],
        edges=[],
    )
    h = Harness(prog)
    await h.scan()
    assert h.runtime.get_current_state().get("a") is None


async def test_duplicate_top_level_node_ids_last_one_wins_no_crash():
    """Two top-level nodes sharing the same id: PLCGraph indexes nodes in a
    dict keyed by id, so the later one silently wins. Documents current
    behavior (no crash) -- true duplicate-id rejection would need to happen
    earlier, at save time, which is a product decision left open (see
    QA_LOG.md)."""
    prog = ProgramGraph(nodes=[
        NodeDefinition(id="dup", type="DigitalInput", params={"value": True}),
        NodeDefinition(id="dup", type="DigitalInput", params={"value": False}),
    ], edges=[])
    h = Harness(prog)
    await h.scan()
    assert h.out("dup") is False  # last node with this id wins


async def test_self_loop_edge_does_not_hang_or_crash():
    """A node wired back into its own input (e.g. SR.Q -> SR.S) must not
    infinite-loop or crash the topological sort; the cycle-fallback path in
    PLCGraph.topological_sort must still produce a deterministic scan."""
    prog = make_program(
        nodes=[{"id": "sr1", "type": "SR"}],
        edges=[{"id": "e1", "source": "sr1", "source_handle": "Q", "target": "sr1", "target_handle": "S"}],
    )
    h = Harness(prog)
    await h.scan(5)
    # No assertion on the specific value (a same-node feedback edge reads
    # last scan's output due to topo-sort ordering, since the node can't
    # both come before and after itself) -- the key property under test is
    # that repeated scans complete without raising.
    assert isinstance(h.out("sr1", "Q"), bool)


async def test_feedback_loop_across_two_nodes_does_not_diverge():
    """A -> NOT -> B -> NOT -> A style feedback ring across multiple nodes:
    must settle into a stable (if arbitrary, due to one-scan-delayed
    feedback) oscillation rather than raising or growing unbounded state."""
    prog = make_program(
        nodes=[
            {"id": "not_a", "type": "NOT"},
            {"id": "not_b", "type": "NOT"},
        ],
        edges=[
            {"id": "e1", "source": "not_a", "source_handle": "OUT", "target": "not_b", "target_handle": "IN"},
            {"id": "e2", "source": "not_b", "source_handle": "OUT", "target": "not_a", "target_handle": "IN"},
        ],
    )
    h = Harness(prog)
    for _ in range(20):
        await h.scan()
    # Values must remain plain booleans (no NaN/None/exception) after many
    # scans -- the loop doesn't crash or corrupt state.
    assert isinstance(h.out("not_a"), bool)
    assert isinstance(h.out("not_b"), bool)


def test_empty_group_children_flattens_to_nothing():
    from plc.graph import flatten_program
    prog = ProgramGraph(nodes=[
        NodeDefinition(id="g1", type="group", children=ProgramGraph(nodes=[], edges=[]), inputs=[], outputs=[]),
    ], edges=[])
    flat = flatten_program(prog)
    assert flat.nodes == []
    assert flat.edges == []


def test_group_parent_edge_referencing_undeclared_port_is_ignored():
    """An edge inside a group's `children` that routes through `$parent` with
    a handle id that was never declared in the group's `inputs`/`outputs`
    list still resolves mechanically (flatten_program keys wiring purely by
    handle string, independent of the declared GroupPort list) -- it just
    produces a flat edge that nothing external ever drives, rather than
    raising KeyError. This documents that GroupPort declarations are
    metadata for the UI, not a runtime-enforced contract."""
    from plc.graph import flatten_program
    prog = ProgramGraph(nodes=[
        NodeDefinition(
            id="g1", type="group",
            inputs=[GroupPort(id="in_a", name="A", data_type="bool")],
            outputs=[GroupPort(id="out_a", name="A", data_type="bool")],
            children=ProgramGraph(
                nodes=[NodeDefinition(id="not1", type="NOT")],
                edges=[
                    EdgeDefinition(id="ie1", source="$parent", source_handle="in_a", target="not1", target_handle="IN"),
                    EdgeDefinition(id="ie2", source="not1", source_handle="OUT", target="$parent", target_handle="out_a"),
                    EdgeDefinition(id="ie3", source="$parent", source_handle="undeclared_port", target="not1", target_handle="IN"),
                ],
            ),
        ),
    ], edges=[])
    flat = flatten_program(prog)  # must not raise
    assert {n.id for n in flat.nodes} == {"g1/not1"}


async def test_duplicate_id_across_group_boundary_is_fine_due_to_qualification():
    """A leaf node id reused inside a group (e.g. both a top-level `not1` and
    a `not1` nested inside `g1`) is safe because flatten_program namespaces
    child ids by path -- `g1/not1` never collides with the top-level `not1`."""
    prog = ProgramGraph(nodes=[
        NodeDefinition(id="not1", type="NOT"),
        NodeDefinition(
            id="g1", type="group",
            children=ProgramGraph(nodes=[NodeDefinition(id="not1", type="NOT")], edges=[]),
        ),
    ], edges=[])
    h = Harness(prog)
    await h.scan()
    assert set(h.runtime._graph.nodes.keys()) == {"not1", "g1/not1"}


# ── HTTP-level: PUT /api/program with malformed graphs must not 500 ────────

def test_put_program_with_unknown_node_type_returns_200_not_500(client):
    """Loading a program with an unrecognized node type via the real API
    route must not crash the server with an unhandled 500; the engine
    tolerates unknown types by skipping them at execution time (see
    test_unknown_node_type_is_skipped_not_crashed above), so the load itself
    should succeed."""
    body = {
        "nodes": [{"id": "a", "type": "NoSuchBlockType", "params": {}, "position": {"x": 0, "y": 0}}],
        "edges": [],
    }
    resp = client.put("/api/program", json=body)
    assert resp.status_code == 200
    # Restore a sane program for any tests that run after this one in the
    # same session (TestClient shares the module-level `runtime` singleton).
    client.post("/api/program/examples/start_stop/load")


def test_put_program_with_dangling_edge_returns_200_not_500(client):
    body = {
        "nodes": [{"id": "a", "type": "DigitalInput", "params": {"value": True}, "position": {"x": 0, "y": 0}}],
        "edges": [{"id": "e1", "source": "a", "source_handle": "OUT", "target": "ghost", "target_handle": "IN"}],
    }
    resp = client.put("/api/program", json=body)
    assert resp.status_code == 200
    client.post("/api/program/examples/start_stop/load")


def test_put_program_with_self_loop_returns_200_not_500(client):
    body = {
        "nodes": [{"id": "sr1", "type": "SR", "params": {}, "position": {"x": 0, "y": 0}}],
        "edges": [{"id": "e1", "source": "sr1", "source_handle": "Q", "target": "sr1", "target_handle": "S"}],
    }
    resp = client.put("/api/program", json=body)
    assert resp.status_code == 200
    client.post("/api/program/examples/start_stop/load")


def test_load_nonexistent_example_returns_404_not_500(client):
    resp = client.post("/api/program/examples/does_not_exist/load")
    assert resp.status_code == 404
    client.post("/api/program/examples/start_stop/load")
