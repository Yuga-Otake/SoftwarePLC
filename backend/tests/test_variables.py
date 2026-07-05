"""Tests for internal variables (M/D-style work variables), the VAR_READ /
VAR_WRITE nodes, the /api/variables* endpoints, and backward compatibility
with program JSON that predates the `variables` section. See
docs/VARIABLES.md.

Engine-level tests use the same VirtualClock harness as the rest of the
fast suite (tests/conftest.py); API-level tests use FastAPI's TestClient,
mirroring tests/test_debug_api.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from plc.models import ProgramGraph, NodeDefinition, EdgeDefinition, VariableDefinition  # noqa: E402
from plc.runtime import runtime  # noqa: E402
from tests.conftest import Harness, load_example_program  # noqa: E402


def make_var_program(variables: list[dict], nodes: list[dict], edges: list[dict]) -> ProgramGraph:
    return ProgramGraph(
        nodes=[NodeDefinition(**n) for n in nodes],
        edges=[EdgeDefinition(**e) for e in edges],
        variables=[VariableDefinition(**v) for v in variables],
    )


# ── Backward compatibility: programs without a `variables` key ─────────────

def test_program_graph_defaults_variables_to_empty_list():
    """A ProgramGraph built from JSON with no `variables` key at all (e.g.
    examples/start_stop.json) must not error and must expose variables=[]."""
    program = load_example_program()
    assert program.variables == []


@pytest.mark.asyncio
async def test_existing_example_program_loads_and_runs_unaffected(harness_factory):
    """Loading a variables-less program must behave exactly as before:
    no crash, no phantom variables registered, scans run fine."""
    h = harness_factory(load_example_program())
    assert h.runtime.list_variable_defs() == []
    await h.scan(1)
    assert h.runtime.get_broadcast_state().get("var") is None


# ── Variable initialization ──────────────────────────────────────────────

def test_variables_initialize_with_declared_initial_values(harness_factory):
    program = make_var_program(
        variables=[
            {"id": "m1", "name": "counter", "type": "number", "initial": 5, "comment": "test"},
            {"id": "m2", "name": "flag", "type": "bool", "initial": True},
        ],
        nodes=[],
        edges=[],
    )
    h = harness_factory(program)
    assert h.runtime.get_variable_value("m1") == 5.0
    assert h.runtime.get_variable_value("m2") is True


def test_variable_initial_defaults_when_omitted(harness_factory):
    program = make_var_program(
        variables=[{"id": "m1", "type": "bool"}],
        nodes=[],
        edges=[],
    )
    h = harness_factory(program)
    assert h.runtime.get_variable_value("m1") is False


# ── VAR_READ / VAR_WRITE scan evaluation ────────────────────────────────

@pytest.mark.asyncio
async def test_var_write_then_var_read_sees_value_next_scan(harness_factory):
    """A VAR_WRITE fed by a DigitalInput should make its value visible to a
    VAR_READ node -- on the NEXT scan at the latest (same-scan visibility is
    also acceptable/better, but must not require more than one extra scan)."""
    program = make_var_program(
        variables=[{"id": "m1", "type": "bool", "initial": False}],
        nodes=[
            {"id": "x0", "type": "DigitalInput", "params": {"value": False}},
            {"id": "vw1", "type": "VAR_WRITE", "params": {"VAR_ID": "m1"}},
            {"id": "vr1", "type": "VAR_READ", "params": {"VAR_ID": "m1"}},
            {"id": "y0", "type": "DigitalOutput", "params": {}},
        ],
        edges=[
            {"id": "e1", "source": "x0", "source_handle": "OUT", "target": "vw1", "target_handle": "IN"},
            {"id": "e2", "source": "vr1", "source_handle": "OUT", "target": "y0", "target_handle": "IN"},
        ],
    )
    h = harness_factory(program)
    h.set_io("x0", True)
    await h.scan(1)  # x0 -> vw1 writes m1=True this scan
    await h.scan(1)  # vr1 reads m1=True, feeds y0
    assert h.runtime.get_variable_value("m1") is True
    assert h.out("y0") is True


@pytest.mark.asyncio
async def test_var_write_number_type(harness_factory):
    program = make_var_program(
        variables=[{"id": "d1", "type": "number", "initial": 0}],
        nodes=[
            {"id": "cmp1", "type": "COMP", "params": {"LIMIT": 5, "OP": ">="}},
            {"id": "vw1", "type": "VAR_WRITE", "params": {"VAR_ID": "d1"}},
        ],
        edges=[],
    )
    h = harness_factory(program)
    # Directly force the variable (simulating an upstream numeric source)
    # and confirm VAR_READ downstream would observe it -- exercised via the
    # runtime API directly here, full wiring covered in the bool test above.
    h.runtime.force_variable_value("d1", 42)
    assert h.runtime.get_variable_value("d1") == 42.0


@pytest.mark.asyncio
async def test_var_read_unknown_id_does_not_crash_and_warns(harness_factory):
    program = make_var_program(
        variables=[],
        nodes=[
            {"id": "vr1", "type": "VAR_READ", "params": {"VAR_ID": "does_not_exist"}},
            {"id": "y0", "type": "DigitalOutput", "params": {}},
        ],
        edges=[
            {"id": "e1", "source": "vr1", "source_handle": "OUT", "target": "y0", "target_handle": "IN"},
        ],
    )
    h = harness_factory(program)
    await h.scan(1)  # must not raise
    assert h.out("vr1") is False
    assert h.out("y0") is False
    state = h.node_state("vr1")
    assert "_warning" in state


@pytest.mark.asyncio
async def test_var_write_unknown_id_is_noop_and_warns(harness_factory):
    program = make_var_program(
        variables=[],
        nodes=[
            {"id": "x0", "type": "DigitalInput", "params": {"value": True}},
            {"id": "vw1", "type": "VAR_WRITE", "params": {"VAR_ID": "ghost"}},
        ],
        edges=[
            {"id": "e1", "source": "x0", "source_handle": "OUT", "target": "vw1", "target_handle": "IN"},
        ],
    )
    h = harness_factory(program)
    await h.scan(1)  # must not raise, must not create a phantom variable
    assert h.runtime.list_variable_defs() == []
    assert h.out("vw1") is True  # OUT still mirrors IN even though the write was a no-op
    state = h.node_state("vw1")
    assert "_warning" in state


@pytest.mark.asyncio
async def test_var_read_write_appear_in_catalog():
    from plc.nodes import NODE_CATALOG
    assert "VAR_READ" in NODE_CATALOG
    assert "VAR_WRITE" in NODE_CATALOG
    assert NODE_CATALOG["VAR_READ"]["output_ports"][0]["name"] == "OUT"
    assert NODE_CATALOG["VAR_WRITE"]["input_ports"][0]["name"] == "IN"


# ── Variable signals integrate with /api/signals, viz history, events ──────

@pytest.mark.asyncio
async def test_variable_appears_in_list_signals_even_without_var_nodes(harness_factory):
    program = make_var_program(
        variables=[{"id": "m1", "name": "flag", "type": "bool", "initial": True}],
        nodes=[],
        edges=[],
    )
    h = harness_factory(program)
    signals = h.runtime.list_signals()
    paths = {s["path"] for s in signals}
    assert "var.m1" in paths
    m1_signal = next(s for s in signals if s["path"] == "var.m1")
    assert m1_signal["value"] is True
    assert m1_signal["data_type"] == "bool"


@pytest.mark.asyncio
async def test_variable_transition_logged_as_event(harness_factory):
    program = make_var_program(
        variables=[{"id": "m1", "type": "bool", "initial": False}],
        nodes=[
            {"id": "x0", "type": "DigitalInput", "params": {"value": False}},
            {"id": "vw1", "type": "VAR_WRITE", "params": {"VAR_ID": "m1"}},
        ],
        edges=[
            {"id": "e1", "source": "x0", "source_handle": "OUT", "target": "vw1", "target_handle": "IN"},
        ],
    )
    h = harness_factory(program)
    h.set_io("x0", True)
    await h.scan(1)
    events = h.runtime.get_recent_events(since=0)
    var_events = [e for e in events if e["signal"] == "var.m1"]
    assert len(var_events) == 1
    assert var_events[0]["old"] is False
    assert var_events[0]["new"] is True


@pytest.mark.asyncio
async def test_variable_appears_in_broadcast_state(harness_factory):
    program = make_var_program(
        variables=[{"id": "m1", "type": "bool", "initial": True}],
        nodes=[],
        edges=[],
    )
    h = harness_factory(program)
    state = h.runtime.get_broadcast_state()
    assert state.get("var", {}).get("m1") is True


# ── /api/variables* endpoints ────────────────────────────────────────────

@pytest.fixture
def client():
    from main import app
    runtime.load_program(load_example_program())
    with TestClient(app) as c:
        yield c


def test_list_variables_includes_io_nodes(client):
    resp = client.get("/api/variables")
    assert resp.status_code == 200
    rows = resp.json()
    by_id = {r["id"]: r for r in rows}
    assert "x_start" in by_id
    assert by_id["x_start"]["kind"] == "input"
    assert "y_motor" in by_id
    assert by_id["y_motor"]["kind"] == "output"
    assert by_id["y_motor"]["editable_value"] is False  # outputs are read-only


def test_create_internal_variable(client):
    resp = client.post("/api/variables", json={"name": "my_counter", "type": "number", "initial": 3})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "my_counter"
    var_id = body["id"]

    listing = client.get("/api/variables").json()
    by_id = {r["id"]: r for r in listing}
    assert var_id in by_id
    assert by_id[var_id]["kind"] == "internal"
    assert by_id[var_id]["value"] == 3.0

    client.delete(f"/api/variables/{var_id}")


def test_create_variable_duplicate_id_rejected(client):
    resp = client.post("/api/variables", json={"id": "dup1", "type": "bool"})
    assert resp.status_code == 200
    resp2 = client.post("/api/variables", json={"id": "dup1", "type": "bool"})
    assert resp2.status_code == 400
    client.delete("/api/variables/dup1")


def test_update_variable_definition(client):
    created = client.post("/api/variables", json={"id": "upd1", "name": "old", "type": "bool"}).json()
    resp = client.put(f"/api/variables/{created['id']}", json={"name": "new_name", "comment": "updated"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "new_name"
    assert body["comment"] == "updated"
    client.delete("/api/variables/upd1")


def test_update_unknown_variable_404(client):
    resp = client.put("/api/variables/does_not_exist", json={"name": "x"})
    assert resp.status_code == 404


def test_delete_variable(client):
    client.post("/api/variables", json={"id": "del1", "type": "bool"})
    resp = client.delete("/api/variables/del1")
    assert resp.status_code == 200
    listing = client.get("/api/variables").json()
    assert not any(r["id"] == "del1" for r in listing)


def test_delete_unknown_variable_404(client):
    resp = client.delete("/api/variables/does_not_exist")
    assert resp.status_code == 404


def test_force_internal_variable(client):
    client.post("/api/variables", json={"id": "force1", "type": "bool", "initial": False})
    resp = client.post("/api/variables/force1/force", json={"value": True})
    assert resp.status_code == 200
    assert resp.json()["value"] is True

    debug_state = client.get("/api/debug/state").json()
    # variable values aren't part of debug/state's node "outputs" -- verify
    # via /api/variables instead, which is the variable manager's own view.
    listing = client.get("/api/variables").json()
    row = next(r for r in listing if r["id"] == "force1")
    assert row["value"] is True
    client.delete("/api/variables/force1")


def test_force_input_node_via_variables_endpoint(client):
    resp = client.post("/api/variables/x_start/force", json={"value": True})
    assert resp.status_code == 200
    assert resp.json()["kind"] == "input"
    io = client.get("/api/io").json()
    assert io.get("x_start") is True
    client.post("/api/variables/x_start/force", json={"value": False})  # reset for other tests


def test_force_input_then_immediate_list_reflects_new_value_no_race(client):
    """Regression test for BUG-006: GET /api/variables must reflect an
    input's just-forced value immediately, without waiting for the live
    scan loop to catch up. Before the fix, `_variable_view_rows()` read the
    DigitalInput's value from `_current_outputs` (last *completed* scan's
    outputs), which raced against the background scan loop and could read
    back the stale pre-write value depending on timing -- flaky, and
    confusing for a variable manager UI whose whole point is showing what
    you just set. The fix reads `_io_values` (the just-written I/O value)
    directly for input rows instead."""
    for expected in (True, False, True, False):
        client.post("/api/variables/x_start/force", json={"value": expected})
        listing = client.get("/api/variables").json()
        row = next(r for r in listing if r["id"] == "x_start")
        assert row["value"] is expected
    client.post("/api/variables/x_start/force", json={"value": False})  # reset for other tests


def test_force_output_node_rejected(client):
    resp = client.post("/api/variables/y_motor/force", json={"value": True})
    assert resp.status_code == 400


def test_force_unknown_id_404(client):
    resp = client.post("/api/variables/nope/force", json={"value": True})
    assert resp.status_code == 404


def test_rename_internal_variable(client):
    client.post("/api/variables", json={"id": "ren1", "name": "old_name", "type": "bool"})
    resp = client.put("/api/variables/ren1/rename", json={"name": "renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "renamed"
    client.delete("/api/variables/ren1")


def test_rename_io_node_label(client):
    resp = client.put("/api/variables/x_start/rename", json={"name": "Start Button"})
    assert resp.status_code == 200
    listing = client.get("/api/variables").json()
    row = next(r for r in listing if r["id"] == "x_start")
    assert row["name"] == "Start Button"
    # restore for other tests that may depend on default label
    client.put("/api/variables/x_start/rename", json={"name": "X0 Start"})


def test_rename_unknown_id_404(client):
    resp = client.put("/api/variables/nope/rename", json={"name": "x"})
    assert resp.status_code == 404
