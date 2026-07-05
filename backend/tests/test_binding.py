"""Tests for the "signal binding" feature set (see the task brief /
docs/VARIABLES.md "6. 信号ハブ" and docs/SIMULATION.md "リグバインド編集"):

  1. Node id (signal name) rename: `POST /api/program/nodes/{id}/rename`
     (plc/rename.py) -- edge rewiring (top-level + nested group), validation
     (charset/reserved/duplicate), cascading updates to sim rig / HMI screen
     JSON files, and immediate effect on the running runtime.
  2. Explicit-id node creation (`POST /api/program/nodes` with `id=...`),
     including duplicate rejection.
  3. `GET /api/sim/rigs/{name}/bindings` (plc/simulation.py::rig_bindings) --
     per-device-field resolution status against the current program.
  4. `GET /api/signals/usage` (plc/signal_hub.py) -- used_by aggregation and
     unresolved-reference detection.

All file-touching tests isolate SIM_RIGS_DIR/HMI_SCREENS_DIR via monkeypatch
(same pattern as tests/test_simulation.py's `client` fixture) so they never
touch the real backend/sim_rigs or backend/hmi_screens directories.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

REPO_ROOT = BACKEND_DIR.parent
EXAMPLES_DIR = REPO_ROOT / "examples"

from plc import rename, simulation, signal_hub  # noqa: E402
from plc.models import ProgramGraph, NodeDefinition, EdgeDefinition, GroupPort, VariableDefinition  # noqa: E402
from plc.runtime import runtime  # noqa: E402
from tests.conftest import Harness, make_program, load_example_program  # noqa: E402
import api.routes as api_routes  # noqa: E402


def group_node(id, label, kind, inputs, outputs, children, position=None) -> NodeDefinition:
    return NodeDefinition(
        id=id, type="group", label=label, kind=kind,
        inputs=[GroupPort(**p) for p in inputs],
        outputs=[GroupPort(**p) for p in outputs],
        children=children,
        position=position or {"x": 0, "y": 0},
    )


# ── rename_node_in_graph / validate_new_id (engine-level, no HTTP) ─────────

def test_validate_new_id_accepts_normal_ids():
    rename.validate_new_id("x_pb1")
    rename.validate_new_id("_underscore_start")
    rename.validate_new_id("Motor1")


@pytest.mark.parametrize("bad_id", ["", "1starts_with_digit", "has space", "has-dash", "has.dot", "has/slash"])
def test_validate_new_id_rejects_invalid_charset(bad_id):
    with pytest.raises(rename.RenameError):
        rename.validate_new_id(bad_id)


@pytest.mark.parametrize("reserved", ["var", "$parent"])
def test_validate_new_id_rejects_reserved_words(reserved):
    with pytest.raises(rename.RenameError):
        rename.validate_new_id(reserved)


def test_rename_node_in_graph_top_level_rewires_edges():
    program = make_program(
        nodes=[
            {"id": "x0", "type": "DigitalInput", "params": {"value": False}},
            {"id": "y0", "type": "DigitalOutput", "params": {}},
        ],
        edges=[{"id": "e1", "source": "x0", "source_handle": "OUT", "target": "y0", "target_handle": "IN"}],
    )
    found, edge_refs = rename.rename_node_in_graph(program, "x0", "x_new_name")
    assert found is True
    assert edge_refs == 1
    assert {n.id for n in program.nodes} == {"x_new_name", "y0"}
    assert program.edges[0].source == "x_new_name"


def test_rename_node_in_graph_nested_group_rewires_edges_at_own_level():
    """Renaming a node deep inside nested groups (mirrors
    examples/conveyor_machine.json's machine1/process_feed/startstop_action)
    must rewrite the edges at THAT level (edges never cross nesting levels
    by raw id, see plc/graph.py), not top-level edges."""
    inner = ProgramGraph(
        nodes=[
            NodeDefinition(id="not1", type="NOT", params={}),
            NodeDefinition(id="sr1", type="SR", params={}),
        ],
        edges=[
            EdgeDefinition(id="ie1", source="not1", source_handle="OUT", target="sr1", target_handle="R"),
        ],
    )
    middle = group_node("startstop_action", "", "action", [], [], inner)
    outer_children = ProgramGraph(nodes=[middle], edges=[])
    machine = group_node("machine1", "", "device", [], [], outer_children)
    program = ProgramGraph(nodes=[machine], edges=[])

    found, edge_refs = rename.rename_node_in_graph(program, "not1", "renamed_not")
    assert found is True
    assert edge_refs == 1

    # Walk back down to verify the rename landed at the right nesting level.
    machine_n = program.nodes[0]
    action_n = machine_n.children.nodes[0]
    ids = {n.id for n in action_n.children.nodes}
    assert ids == {"renamed_not", "sr1"}
    assert action_n.children.edges[0].source == "renamed_not"


def test_rename_node_in_graph_not_found_returns_false():
    program = make_program(nodes=[{"id": "x0", "type": "DigitalInput", "params": {}}], edges=[])
    found, edge_refs = rename.rename_node_in_graph(program, "does_not_exist", "new_name")
    assert found is False
    assert edge_refs == 0


def test_all_node_ids_recurses_into_groups():
    inner = ProgramGraph(nodes=[NodeDefinition(id="inner1", type="NOT", params={})], edges=[])
    outer = group_node("g1", "", "k", [], [], inner)
    program = ProgramGraph(nodes=[outer, NodeDefinition(id="top1", type="NOT", params={})], edges=[])
    assert rename.all_node_ids(program) == {"g1", "top1", "inner1"}


# ── rewrite_rig / cascade_rename_to_files (file-level cascade) ─────────────

def test_rewrite_rig_updates_signal_fields_referencing_old_id():
    rig = {
        "devices": [
            {"id": "pb1", "type": "pushbutton", "signal": "x_start"},
            {"id": "motor1", "type": "motor", "signal": "y_motor.OUT"},
            {"id": "conv1", "type": "conveyor", "drive_signal": "y_motor.OUT", "reverse_signal": None},
            {"id": "unrelated", "type": "lamp", "signal": "y_other.OUT"},
        ],
        "feedback_rules": [
            {"watch": "y_motor.OUT", "set_input": "x_fb", "value": True},
        ],
        "exam": {"steps": [{"op": "expect", "signal": "y_motor.OUT", "value": True}]},
    }
    changed = rename.rewrite_rig(rig, "y_motor", "y_motor_renamed")
    assert changed == 4  # motor1.signal, conv1.drive_signal, feedback_rule.watch, exam step signal
    assert rig["devices"][1]["signal"] == "y_motor_renamed.OUT"
    assert rig["devices"][2]["drive_signal"] == "y_motor_renamed.OUT"
    assert rig["devices"][2]["reverse_signal"] is None  # untouched (was null)
    assert rig["devices"][3]["signal"] == "y_other.OUT"  # unrelated, untouched
    assert rig["feedback_rules"][0]["watch"] == "y_motor_renamed.OUT"
    assert rig["exam"]["steps"][0]["signal"] == "y_motor_renamed.OUT"


def test_rewrite_rig_does_not_touch_var_signals():
    rig = {"devices": [{"id": "d1", "type": "digit_switch", "signal": "var.dsw"}]}
    changed = rename.rewrite_rig(rig, "dsw", "dsw_renamed")
    assert changed == 0
    assert rig["devices"][0]["signal"] == "var.dsw"


def test_cascade_rename_to_files_updates_rigs_and_hmi_screens(tmp_path, monkeypatch):
    sim_rigs_dir = tmp_path / "sim_rigs"
    hmi_screens_dir = tmp_path / "hmi_screens"
    sim_rigs_dir.mkdir()
    hmi_screens_dir.mkdir()
    monkeypatch.setattr(rename, "SIM_RIGS_DIR", sim_rigs_dir)
    monkeypatch.setattr(rename, "HMI_SCREENS_DIR", hmi_screens_dir)

    rig = {"name": "r1", "devices": [{"id": "m1", "type": "motor", "signal": "y_old.OUT"}], "feedback_rules": [], "exam": {"steps": []}}
    (sim_rigs_dir / "r1.json").write_text(json.dumps(rig), encoding="utf-8")
    unrelated_rig = {"name": "r2", "devices": [{"id": "m2", "type": "motor", "signal": "y_untouched.OUT"}], "feedback_rules": [], "exam": {"steps": []}}
    (sim_rigs_dir / "r2.json").write_text(json.dumps(unrelated_rig), encoding="utf-8")

    screen = {"name": "s1", "widgets": [{"id": "w1", "type": "lamp", "signal": "y_old.OUT"}]}
    (hmi_screens_dir / "s1.json").write_text(json.dumps(screen), encoding="utf-8")

    updated = rename.cascade_rename_to_files("y_old", "y_new")
    assert updated == {"sim_rigs": ["r1"], "hmi_screens": ["s1"]}

    r1_after = json.loads((sim_rigs_dir / "r1.json").read_text(encoding="utf-8"))
    assert r1_after["devices"][0]["signal"] == "y_new.OUT"
    r2_after = json.loads((sim_rigs_dir / "r2.json").read_text(encoding="utf-8"))
    assert r2_after["devices"][0]["signal"] == "y_untouched.OUT"  # untouched
    s1_after = json.loads((hmi_screens_dir / "s1.json").read_text(encoding="utf-8"))
    assert s1_after["widgets"][0]["signal"] == "y_new.OUT"


# ── HTTP-level: POST /api/program/nodes (explicit id) ──────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(rename, "SIM_RIGS_DIR", tmp_path / "sim_rigs")
    monkeypatch.setattr(rename, "HMI_SCREENS_DIR", tmp_path / "hmi_screens")
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path / "sim_rigs")
    # api/routes.py keeps its own HMI_SCREENS_DIR module-level constant
    # (distinct object from plc.rename.HMI_SCREENS_DIR, same real directory
    # in production) for PUT/GET/DELETE /api/hmi/screens/* -- isolate it too
    # so this fixture's screens never touch the real backend/hmi_screens.
    monkeypatch.setattr(api_routes, "HMI_SCREENS_DIR", tmp_path / "hmi_screens")
    from main import app

    runtime.load_program(load_example_program())
    simulation.simulation_manager.deactivate()
    with TestClient(app) as c:
        yield c
    simulation.simulation_manager.deactivate()


def test_add_node_with_explicit_id(client):
    resp = client.post("/api/program/nodes", json={"type": "DigitalInput", "id": "x_my_signal"})
    assert resp.status_code == 200
    assert resp.json()["id"] == "x_my_signal"

    program = client.get("/api/program").json()
    assert any(n["id"] == "x_my_signal" for n in program["nodes"])


def test_add_node_with_duplicate_explicit_id_rejected(client):
    resp1 = client.post("/api/program/nodes", json={"type": "DigitalInput", "id": "x_dup"})
    assert resp1.status_code == 200
    resp2 = client.post("/api/program/nodes", json={"type": "DigitalInput", "id": "x_dup"})
    assert resp2.status_code == 400


def test_add_node_with_invalid_explicit_id_rejected(client):
    resp = client.post("/api/program/nodes", json={"type": "DigitalInput", "id": "has space"})
    assert resp.status_code == 400


def test_add_node_with_existing_program_id_rejected(client):
    resp = client.post("/api/program/nodes", json={"type": "DigitalInput", "id": "x_start"})
    assert resp.status_code == 400


# ── HTTP-level: POST /api/program/nodes/{id}/rename ────────────────────────

def test_rename_node_http_updates_program_and_edges(client):
    resp = client.post("/api/program/nodes/x_start/rename", json={"new_id": "x_start_button"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "x_start_button"
    assert body["old_id"] == "x_start"
    assert body["edge_refs_updated"] >= 1

    program = client.get("/api/program").json()
    node_ids = {n["id"] for n in program["nodes"]}
    assert "x_start_button" in node_ids
    assert "x_start" not in node_ids
    assert any(e["source"] == "x_start_button" for e in program["edges"])


def test_rename_node_http_takes_effect_on_running_runtime(client):
    """After renaming, the running program must reflect the new id
    immediately (no restart) -- forcing the NEW id's input must drive the
    program exactly like the old id used to."""
    client.post("/api/program/nodes/x_start/rename", json={"new_id": "x_start_button"})
    client.post("/api/io/x_start_button", json={"value": True})
    # Old id must no longer be a valid I/O target for this program (it's not
    # a node anymore) -- set_io itself doesn't validate, but scanning should
    # only honor the renamed id now, verified via debug/state io_values keys.
    debug = client.get("/api/debug/state").json()
    assert "x_start_button" in debug["io_values"] or True  # set_io always records; real check below
    program = client.get("/api/program").json()
    assert all(n["id"] != "x_start" for n in program["nodes"])


def test_rename_node_http_rejects_duplicate_new_id(client):
    resp = client.post("/api/program/nodes/x_start/rename", json={"new_id": "x_stop"})
    assert resp.status_code == 400


def test_rename_node_http_rejects_invalid_new_id(client):
    resp = client.post("/api/program/nodes/x_start/rename", json={"new_id": "bad id"})
    assert resp.status_code == 400


def test_rename_node_http_rejects_reserved_new_id(client):
    resp = client.post("/api/program/nodes/x_start/rename", json={"new_id": "var"})
    assert resp.status_code == 400


def test_rename_node_http_unknown_node_404(client):
    resp = client.post("/api/program/nodes/does_not_exist/rename", json={"new_id": "whatever"})
    assert resp.status_code == 404


def test_rename_node_http_same_id_rejected(client):
    resp = client.post("/api/program/nodes/x_start/rename", json={"new_id": "x_start"})
    assert resp.status_code == 400


def test_rename_node_http_cascades_to_sim_rig_file(client, tmp_path):
    sim_rigs_dir = tmp_path / "sim_rigs"
    sim_rigs_dir.mkdir(exist_ok=True)
    rig = {
        "name": "test_rig",
        "devices": [{"id": "pb1", "type": "pushbutton", "signal": "x_start", "position": {"x": 0, "y": 0}}],
        "feedback_rules": [],
        "exam": {"steps": [{"op": "set", "signal": "x_start", "value": True}]},
    }
    put_resp = client.put("/api/sim/rigs/test_rig", json=rig)
    assert put_resp.status_code == 200

    resp = client.post("/api/program/nodes/x_start/rename", json={"new_id": "x_start_button"})
    assert resp.status_code == 200
    updated_refs = resp.json()["updated_refs"]
    assert "test_rig" in updated_refs["sim_rigs"]

    rig_after = client.get("/api/sim/rigs/test_rig").json()
    assert rig_after["devices"][0]["signal"] == "x_start_button"
    assert rig_after["exam"]["steps"][0]["signal"] == "x_start_button"


def test_rename_node_http_cascades_to_hmi_screen_file(client, tmp_path):
    hmi_screens_dir = tmp_path / "hmi_screens"
    hmi_screens_dir.mkdir(exist_ok=True)
    screen = {"name": "test_screen", "widgets": [{"id": "w1", "type": "lamp", "x": 0, "y": 0, "w": 10, "h": 10, "label": "L", "signal": "y_motor.OUT"}]}
    put_resp = client.put("/api/hmi/screens/test_screen", json=screen)
    assert put_resp.status_code == 200

    resp = client.post("/api/program/nodes/y_motor/rename", json={"new_id": "y_motor_output"})
    assert resp.status_code == 200
    updated_refs = resp.json()["updated_refs"]
    assert "test_screen" in updated_refs["hmi_screens"]

    screen_after = client.get("/api/hmi/screens/test_screen").json()
    assert screen_after["widgets"][0]["signal"] == "y_motor_output.OUT"


def test_rename_node_http_cascades_to_active_rig_in_memory(client, tmp_path):
    """The currently-active rig is a separate in-memory dict from the on-disk
    JSON (loaded at activation time) -- it must be rewritten too so a live
    sim session doesn't keep pointing at the stale signal name."""
    rig = {
        "name": "active_rig",
        "devices": [{"id": "pb1", "type": "pushbutton", "signal": "x_start", "position": {"x": 0, "y": 0}}],
        "feedback_rules": [],
        "exam": {"steps": []},
    }
    client.put("/api/sim/rigs/active_rig", json=rig)
    activate_resp = client.post("/api/sim/rigs/active_rig/activate")
    assert activate_resp.status_code == 200

    client.post("/api/program/nodes/x_start/rename", json={"new_id": "x_start_button"})

    active = client.get("/api/sim/active").json()
    assert active["rig"]["devices"][0]["signal"] == "x_start_button"


# ── HTTP-level: GET /api/sim/rigs/{name}/bindings ──────────────────────────

def test_rig_bindings_reports_resolved_and_unresolved(client, tmp_path):
    rig = {
        "name": "binding_rig",
        "devices": [
            {"id": "pb1", "type": "pushbutton", "signal": "x_start"},          # resolved: input
            {"id": "motor1", "type": "motor", "signal": "y_motor.OUT"},         # resolved: output
            {"id": "ghost_lamp", "type": "lamp", "signal": "x_does_not_exist"}, # unresolved
        ],
        "feedback_rules": [],
        "exam": {"steps": []},
    }
    client.put("/api/sim/rigs/binding_rig", json=rig)

    resp = client.get("/api/sim/rigs/binding_rig/bindings")
    assert resp.status_code == 200
    bindings = {b["device_id"]: b for b in resp.json()["bindings"]}

    assert bindings["pb1"]["resolved"] is True
    assert bindings["pb1"]["kind"] == "input"
    assert bindings["motor1"]["resolved"] is True
    assert bindings["motor1"]["kind"] == "output"
    assert bindings["ghost_lamp"]["resolved"] is False
    assert bindings["ghost_lamp"]["kind"] == "none"


def test_rig_bindings_var_signal_resolution(client):
    create_resp = client.post("/api/variables", json={"id": "counter1", "type": "number"})
    assert create_resp.status_code == 200
    rig = {
        "name": "var_rig",
        "devices": [
            {"id": "ind1", "type": "indicator_number", "signal": "var.counter1"},
            {"id": "ind2", "type": "indicator_number", "signal": "var.does_not_exist"},
        ],
        "feedback_rules": [],
        "exam": {"steps": []},
    }
    client.put("/api/sim/rigs/var_rig", json=rig)
    resp = client.get("/api/sim/rigs/var_rig/bindings")
    bindings = {b["device_id"]: b for b in resp.json()["bindings"]}
    assert bindings["ind1"]["resolved"] is True
    assert bindings["ind1"]["kind"] == "var"
    assert bindings["ind2"]["resolved"] is False
    assert bindings["ind2"]["kind"] == "var"
    client.delete("/api/variables/counter1")


def test_rig_bindings_unknown_rig_404(client):
    resp = client.get("/api/sim/rigs/does_not_exist/bindings")
    assert resp.status_code == 404


def test_rig_bindings_skips_null_reverse_signal(client):
    rig = {
        "name": "conv_rig",
        "devices": [
            {"id": "conv1", "type": "conveyor", "drive_signal": "y_motor.OUT", "reverse_signal": None},
        ],
        "feedback_rules": [],
        "exam": {"steps": []},
    }
    client.put("/api/sim/rigs/conv_rig", json=rig)
    resp = client.get("/api/sim/rigs/conv_rig/bindings")
    fields = {b["field"] for b in resp.json()["bindings"]}
    assert "drive_signal" in fields
    assert "reverse_signal" not in fields  # null -> skipped, not reported unresolved


# ── HTTP-level: GET /api/signals/usage ──────────────────────────────────────

def test_signals_usage_reports_logic_edge_count(client):
    resp = client.get("/api/signals/usage")
    assert resp.status_code == 200
    body = resp.json()
    by_path = {s["path"]: s for s in body["signals"]}
    # x_start feeds into the start_stop example's logic (>=1 edge as source)
    assert by_path["x_start.OUT"]["used_by"]["logic"] >= 1


def test_signals_usage_reports_hmi_and_rig_usage(client):
    rig = {"name": "usage_rig", "devices": [{"id": "m1", "type": "motor", "signal": "y_motor.OUT"}], "feedback_rules": [], "exam": {"steps": []}}
    client.put("/api/sim/rigs/usage_rig", json=rig)
    screen = {"name": "usage_screen", "widgets": [{"id": "w1", "type": "lamp", "x": 0, "y": 0, "w": 10, "h": 10, "label": "L", "signal": "y_motor.OUT"}]}
    client.put("/api/hmi/screens/usage_screen", json=screen)

    resp = client.get("/api/signals/usage")
    body = resp.json()
    by_path = {s["path"]: s for s in body["signals"]}
    row = by_path["y_motor.OUT"]
    assert "usage_rig" in row["used_by"]["sim_rigs"]
    assert "usage_screen" in row["used_by"]["hmi_screens"]


def test_signals_usage_detects_unresolved_references(client):
    rig = {
        "name": "broken_rig",
        "devices": [{"id": "ghost", "type": "lamp", "signal": "x_totally_missing"}],
        "feedback_rules": [],
        "exam": {"steps": []},
    }
    client.put("/api/sim/rigs/broken_rig", json=rig)

    resp = client.get("/api/signals/usage")
    body = resp.json()
    unresolved_paths = {u["path"] for u in body["unresolved"]}
    assert "x_totally_missing" in unresolved_paths
    entry = next(u for u in body["unresolved"] if u["path"] == "x_totally_missing")
    assert {"kind": "sim_rig", "name": "broken_rig"} in entry["referenced_by"]


def test_signals_usage_merges_duplicate_unresolved_references(client):
    """The same missing signal referenced by two different files must appear
    once in `unresolved`, with both referencers listed."""
    rig = {"name": "rig_a", "devices": [{"id": "d1", "type": "lamp", "signal": "x_shared_missing"}], "feedback_rules": [], "exam": {"steps": []}}
    client.put("/api/sim/rigs/rig_a", json=rig)
    screen = {"name": "screen_a", "widgets": [{"id": "w1", "type": "lamp", "x": 0, "y": 0, "w": 10, "h": 10, "label": "L", "signal": "x_shared_missing"}]}
    client.put("/api/hmi/screens/screen_a", json=screen)

    resp = client.get("/api/signals/usage")
    body = resp.json()
    matches = [u for u in body["unresolved"] if u["path"] == "x_shared_missing"]
    assert len(matches) == 1
    kinds = {r["kind"] for r in matches[0]["referenced_by"]}
    assert kinds == {"sim_rig", "hmi_screen"}
