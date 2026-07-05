"""Tests for the /api/debug/* endpoints added to api/routes.py, plus a
sanity check that pre-existing endpoints (program/catalog) still respond,
using FastAPI's TestClient (in-process, no real server/socket needed).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from plc.models import ProgramGraph  # noqa: E402
from plc.runtime import runtime  # noqa: E402
from tests.conftest import load_example_program  # noqa: E402


@pytest.fixture
def client():
    # main.py's lifespan starts background tasks (sandbox pool, scan loop)
    # that aren't needed for these synchronous route tests, so import the
    # app directly and drive the shared `runtime` singleton without
    # triggering the lifespan context.
    from main import app

    runtime.load_program(load_example_program())
    with TestClient(app) as c:
        yield c


def test_catalog_endpoint_unaffected(client):
    resp = client.get("/api/catalog")
    assert resp.status_code == 200
    body = resp.json()
    assert "TON" in body
    assert "SR" in body


def test_program_endpoint_unaffected(client):
    resp = client.get("/api/program")
    assert resp.status_code == 200
    body = resp.json()
    node_ids = {n["id"] for n in body["nodes"]}
    assert {"x_start", "x_stop", "sr1", "ton1", "y_motor", "y_done"} <= node_ids


def test_debug_state_shape(client):
    resp = client.get("/api/debug/state")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) >= {"scan_index", "now_ms", "io_values", "outputs", "node_states"}
    assert isinstance(body["scan_index"], int)
    # After TestClient's startup lifespan has run at least one scan cycle,
    # node outputs should be populated for the loaded program.
    assert "y_motor" in body["outputs"]
    assert "ton1" in body["node_states"]


def test_debug_state_reflects_io_change(client):
    client.post("/api/io/x_start", json={"value": True})
    # Give the running scan loop a moment to pick up the change: poll the
    # debug endpoint until either it flips or we hit a generous cap. This
    # uses the *real* server scan loop (not a virtual clock), so a short
    # real wait is unavoidable here -- unlike the rest of the suite, which
    # uses VirtualClock exclusively.
    import time as _time
    deadline = _time.time() + 2.0
    motor_on = False
    while _time.time() < deadline:
        state = client.get("/api/debug/state").json()
        if state["outputs"].get("y_motor", {}).get("OUT") is True:
            motor_on = True
            break
        _time.sleep(0.05)
    assert motor_on, "expected y_motor.OUT to become True after setting x_start"


def test_debug_events_since_zero_returns_events(client):
    resp = client.get("/api/debug/events", params={"since": 0})
    assert resp.status_code == 200
    body = resp.json()
    assert "events" in body and "last_seq" in body
    assert isinstance(body["events"], list)


def test_debug_events_incremental_since_last_seq(client):
    first = client.get("/api/debug/events", params={"since": 0}).json()
    last_seq = first["last_seq"]
    second = client.get("/api/debug/events", params={"since": last_seq}).json()
    # No events strictly newer than last_seq should be returned.
    assert all(e["seq"] > last_seq for e in second["events"])


def test_program_switch_clears_stale_events_and_history(client):
    """Regression test for BUG-004: switching the loaded program (e.g.
    start_stop -> conveyor_machine) must not leave the previous program's
    node-id transitions mixed into /api/debug/events or /api/history/events.
    Both are ring buffers keyed by node id, which is only unique within one
    program's flattened graph."""
    import time as _time

    client.post("/api/program/examples/start_stop/load")
    client.post("/api/io/x_start", json={"value": True})
    # Let the real scan loop pick up the change and log a transition.
    deadline = _time.time() + 2.0
    while _time.time() < deadline:
        ev = client.get("/api/debug/events", params={"since": 0}).json()
        if any(e["signal"].startswith("y_motor") for e in ev["events"]):
            break
        _time.sleep(0.05)

    seq_before_switch = client.get("/api/debug/events", params={"since": 0}).json()["last_seq"]

    client.post("/api/program/examples/conveyor_machine/load")
    _time.sleep(0.3)  # let a couple of real scans run against the new program

    after = client.get("/api/debug/events", params={"since": 0}).json()
    signal_node_ids = {e["signal"].split(".")[0] for e in after["events"]}
    assert "y_motor" not in signal_node_ids, "stale start_stop node id leaked into debug/events after program switch"
    # last_seq must stay monotonically increasing across the switch (clients
    # polling with since=<seq> shouldn't see it jump backwards to 0).
    assert after["last_seq"] >= seq_before_switch

    hist = client.get("/api/history/events", params={"from_ts": 0}).json()
    hist_node_ids = set()
    for e in hist:
        hist_node_ids |= set(e["changes"].keys())
    assert "y_motor" not in hist_node_ids, "stale start_stop node id leaked into history/events after program switch"

    # Restore start_stop so later tests in the module see the expected program.
    client.post("/api/program/examples/start_stop/load")
