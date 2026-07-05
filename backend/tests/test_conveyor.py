"""Tests for the conveyor/jig/position_sensor "physics engine" extension to
the simulation tab (see docs/SIMULATION.md "コンベア/ジグ/センサー" section
and `plc/simulation.py::PhysicsEngine`).

Same philosophy as `test_simulation.py`: a `VirtualClock` drives every test
so position integration (mm = speed_mm_s * dt_s) is deterministic and the
whole suite runs in milliseconds, not real seconds. No `time.sleep`/
`asyncio.sleep` anywhere in this file.
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

from plc.clock import VirtualClock  # noqa: E402
from plc.runtime import PLCRuntime, runtime  # noqa: E402
from plc import simulation  # noqa: E402
from plc.simulation import (  # noqa: E402
    ExamRunner,
    PhysicsEngine,
    SimulationManager,
    read_signal,
    write_signal,
)
from tests.conftest import load_example_program  # noqa: E402
from tests.test_simulation import SimHarness, make_exam_sleep_fn  # noqa: E402

REPO_ROOT = BACKEND_DIR.parent
SIM_RIGS_DIR = BACKEND_DIR / "sim_rigs"


def _bundled_conveyor_exam() -> dict:
    return json.loads((SIM_RIGS_DIR / "conveyor_exam.json").read_text(encoding="utf-8"))


# ── PhysicsEngine: position integration (drive on/off, reverse, at_end) ────

CONVEYOR = {"id": "conv1", "type": "conveyor", "drive_signal": "y_motor.OUT",
            "reverse_signal": None, "length_mm": 1000, "speed_mm_s": 200}
JIG = {"id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 0, "size_mm": 120,
       "features": [{"id": "screw1", "type": "screw", "offset_mm": 100}]}
SENSOR = {"id": "sens1", "type": "position_sensor", "conveyor": "conv1", "at_mm": 800,
          "window_mm": 12, "detect": "feature", "signal": "x_screw_det"}


async def test_jig_does_not_move_while_drive_signal_off():
    h = SimHarness()
    devices = [CONVEYOR, JIG, SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    phys.tick()  # prime _last_ms
    h.clock.advance_ms(2000)
    phys.tick()
    assert phys.positions["jig1"] == 0.0


async def test_jig_advances_at_speed_while_drive_signal_on():
    h = SimHarness()
    devices = [CONVEYOR, JIG, SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    # y_motor is a DigitalOutput node computed by the program's SR latch --
    # drive it via x_start/x_stop (same convention as test_simulation.py).
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.scan()
    assert read_signal(h.runtime, "y_motor.OUT") is True

    phys.tick()  # prime _last_ms at t=0 (post scan clock still 0 until advance)
    h.clock.advance_ms(1000)
    await h.scan()
    phys.tick()
    # 1000ms at 200mm/s => 200mm
    assert phys.positions["jig1"] == pytest.approx(200.0)


async def test_jig_stops_at_conveyor_end_when_at_end_stop():
    h = SimHarness()
    jig = dict(JIG, home_mm=950)
    devices = [CONVEYOR, jig, SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.scan()

    phys.tick()
    h.clock.advance_ms(2000)  # would be 950 + 400 = 1350mm without clamping
    await h.scan()
    phys.tick()
    assert phys.positions["jig1"] == 1000.0  # clamped to conveyor length


async def test_jig_wraps_at_conveyor_end_when_at_end_wrap():
    h = SimHarness()
    jig = dict(JIG, home_mm=950, at_end="wrap")
    devices = [CONVEYOR, jig, SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.scan()

    phys.tick()
    h.clock.advance_ms(500)  # 950 + 100 = 1050 -> wraps to 50
    await h.scan()
    phys.tick()
    assert phys.positions["jig1"] == pytest.approx(50.0)


async def test_jig_reverses_direction_with_reverse_signal():
    h = SimHarness()
    conveyor = dict(CONVEYOR, reverse_signal="x_reverse")
    jig = dict(JIG, home_mm=500)
    devices = [conveyor, jig, SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    write_signal(h.runtime, "x_reverse", True)
    await h.scan()

    phys.tick()
    h.clock.advance_ms(1000)  # 1000ms at 200mm/s reversed => -200mm
    await h.scan()
    phys.tick()
    assert phys.positions["jig1"] == pytest.approx(300.0)


# ── PhysicsEngine: sensor detection (feature/jig, window on/off) ──────────

async def test_position_sensor_detects_feature_inside_window():
    h = SimHarness()
    devices = [CONVEYOR, dict(JIG, home_mm=700), SENSOR]  # screw at 700+100=800, sensor at 800
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    phys.tick()
    assert phys.sensor_active["sens1"] is True
    assert read_signal(h.runtime, "x_screw_det") is True


async def test_position_sensor_off_when_feature_outside_window():
    h = SimHarness()
    devices = [CONVEYOR, dict(JIG, home_mm=0), SENSOR]  # screw at 100, far from sensor at 800
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    phys.tick()
    assert phys.sensor_active["sens1"] is False
    # Never having gone True, the write_signal("...", False) branch never
    # actually runs (the engine's edge-triggered write only fires on a
    # detected != was_active transition, and both start False) -- so the
    # forced I/O store has no entry yet, same "unset -> None" convention as
    # read_signal's other virtual-IO fallback tests in test_simulation.py.
    assert read_signal(h.runtime, "x_screw_det") is None


async def test_position_sensor_turns_off_after_jig_passes_through():
    h = SimHarness()
    devices = [CONVEYOR, dict(JIG, home_mm=700), SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.scan()
    phys.tick()
    assert phys.sensor_active["sens1"] is True  # screw at 800, dead center

    # Advance in small (20ms) steps so the swept-segment check (see
    # PhysicsEngine._evaluate_sensors) sees the screw actually leave the
    # window rather than jumping clean over-and-past it in one big stride
    # (a single 1000ms/200mm-per-100ms-scan tick's sweep would itself
    # re-overlap the window and stay "detected", which is correct behavior
    # for a fast pass-through but not what this test wants to exercise).
    for _ in range(20):  # 20 * 20ms = 400ms -> screw moves from 800 to 880mm
        h.clock.advance_ms(20)
        await h.scan()
        phys.tick()
    assert phys.sensor_active["sens1"] is False
    assert read_signal(h.runtime, "x_screw_det") is False


async def test_position_sensor_detect_jig_mode_detects_body_not_just_feature():
    h = SimHarness()
    sensor = dict(SENSOR, detect="jig", at_mm=50)
    devices = [CONVEYOR, dict(JIG, home_mm=0, size_mm=120), sensor]  # body spans 0..120
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    phys.tick()
    assert phys.sensor_active["sens1"] is True  # sensor at 50 is within jig body 0..120

    phys2 = PhysicsEngine(h.runtime, h.clock, [CONVEYOR, dict(JIG, home_mm=500, size_mm=120), sensor])
    phys2.tick()
    assert phys2.sensor_active["sens1"] is False  # body 500..620, far from sensor at 50


# ── reset_jig (engine method + exam op + API) ──────────────────────────────

async def test_reset_jig_returns_to_home_mm():
    h = SimHarness()
    devices = [CONVEYOR, dict(JIG, home_mm=0), SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.scan()
    phys.tick()
    h.clock.advance_ms(1000)
    await h.scan()
    phys.tick()
    assert phys.positions["jig1"] != 0.0

    assert phys.reset_jig("jig1") is True
    assert phys.positions["jig1"] == 0.0


async def test_reset_jig_unknown_id_returns_false():
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [CONVEYOR, JIG, SENSOR])
    assert phys.reset_jig("does_not_exist") is False


async def test_reset_all_clears_sensor_flags_and_jig_positions():
    h = SimHarness()
    devices = [CONVEYOR, dict(JIG, home_mm=700), SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    phys.tick()
    assert phys.sensor_active["sens1"] is True

    phys.reset_all()
    # reset_all() returns each jig to its *configured* home_mm (700 here),
    # not necessarily 0 -- distinct from reset_jig()'s per-jig home reset
    # tested elsewhere with home_mm=0.
    assert phys.positions["jig1"] == 700.0
    assert phys.sensor_active["sens1"] is False


async def test_exam_runner_reset_jig_op():
    h = SimHarness()
    devices = [CONVEYOR, dict(JIG, home_mm=0), SENSOR]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.scan()
    phys.tick()
    h.clock.advance_ms(1000)
    await h.scan()
    phys.tick()
    assert phys.positions["jig1"] != 0.0

    exam = {"title": "reset-check", "steps": [{"op": "reset_jig", "jig": "jig1"}]}
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h), physics=phys)
    result = await runner.run()
    assert result["state"] == "passed"
    assert phys.positions["jig1"] == 0.0


async def test_exam_runner_reset_jig_unknown_jig_fails():
    h = SimHarness()
    exam = {"title": "reset-fail", "steps": [{"op": "reset_jig", "jig": "nope"}]}
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h), physics=None)
    result = await runner.run()
    assert result["state"] == "failed"
    assert result["steps"][0]["status"] == "fail"


# ── SimulationManager integration: activate/deactivate/state/reset ─────────

async def test_simulation_manager_sim_state_empty_when_no_rig_active(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    assert mgr.sim_state() == {"jigs": {}, "sensors": {}, "relays": {}}


async def test_simulation_manager_activate_wires_physics_engine(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    rig = _bundled_conveyor_exam()
    simulation.save_rig("conveyor_exam", rig)

    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    mgr.activate("conveyor_exam")

    state = mgr.sim_state()
    assert "jig1" in state["jigs"]
    assert state["jigs"]["jig1"]["position_mm"] == 0.0
    assert state["sensors"]["sens1"] is False

    mgr.deactivate()
    assert mgr.sim_state() == {"jigs": {}, "sensors": {}, "relays": {}}


async def test_simulation_manager_feedback_tick_advances_physics_and_feedback(tmp_path, monkeypatch):
    """feedback_tick() (the post_scan_hook target) must drive BOTH the
    physics engine and the feedback-rule engine every call -- this is what
    lets a position_sensor's output feed a feedback_rule (as conveyor_exam.json
    does: x_screw_det -> x_stop)."""
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    rig = _bundled_conveyor_exam()
    simulation.save_rig("conveyor_exam", rig)

    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    mgr.activate("conveyor_exam")

    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.scan()
    mgr.feedback_tick()
    assert read_signal(h.runtime, "y_motor.OUT") is True

    write_signal(h.runtime, "x_start", False)
    # Advance until the jig's screw (home 0 + offset 100) reaches the sensor
    # at 800mm: needs 700mm / 200mm/s = 3.5s = 3500ms.
    for _ in range(36):  # 36 * 100ms = 3600ms, past the 3500ms theoretical arrival
        h.clock.advance_ms(100)
        await h.scan()
        mgr.feedback_tick()

    assert mgr.sim_state()["sensors"]["sens1"] is True
    # The feedback_rule (x_screw_det -> x_stop=False) should have fired --
    # examples/start_stop.json's SR latch takes R=NOT(x_stop), so dropping
    # x_stop back to False is what actually resets the latch and stops the
    # motor (same "held-open" latch convention as motor_exam.json/
    # conveyor_exam.json, see docs/SIMULATION.md wiring note).
    assert read_signal(h.runtime, "x_stop") is False
    assert read_signal(h.runtime, "y_motor.OUT") is False


async def test_activate_resets_physics_state_from_previous_run(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    simulation.save_rig("conveyor_exam", _bundled_conveyor_exam())

    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    mgr.activate("conveyor_exam")
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.scan()
    mgr.feedback_tick()
    h.clock.advance_ms(1000)
    await h.scan()
    mgr.feedback_tick()
    assert mgr.sim_state()["jigs"]["jig1"]["position_mm"] != 0.0

    # Reactivating (e.g. switching away and back) should reset the jig home.
    mgr.activate("conveyor_exam")
    assert mgr.sim_state()["jigs"]["jig1"]["position_mm"] == 0.0
    assert mgr.sim_state()["sensors"]["sens1"] is False


async def test_reset_jig_via_manager_unknown_jig_returns_false(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    simulation.save_rig("conveyor_exam", _bundled_conveyor_exam())
    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    mgr.activate("conveyor_exam")
    assert mgr.reset_jig("nope") is False
    assert mgr.reset_jig("jig1") is True


async def test_reset_jig_via_manager_no_rig_active_returns_false(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    assert mgr.reset_jig("jig1") is False


# ── conveyor_exam.json: headless full exam pass (the "sample cert machine") ─

async def test_conveyor_exam_bundled_rig_passes_headless():
    h = SimHarness()
    rig = _bundled_conveyor_exam()
    await h.scan()  # prime, mirrors scenario runner / server startup

    mgr = SimulationManager(h.runtime)
    mgr.active_rig = rig
    mgr.active_rig_name = "conveyor_exam"
    from plc.simulation import FeedbackRuleEngine
    mgr._feedback_engine = FeedbackRuleEngine(h.runtime, h.clock, rig["feedback_rules"])
    mgr._physics_engine = PhysicsEngine(h.runtime, h.clock, rig["devices"])
    mgr._reset_devices_to_default()

    runner = ExamRunner(
        h.runtime, h.clock, rig["exam"],
        sleep_fn=make_exam_sleep_fn(h, feedback=None),
        physics=mgr._physics_engine,
    )
    # make_exam_sleep_fn only ticks the feedback engine; wrap sleep_fn so it
    # also ticks the physics engine each poll (mirrors SimulationManager's
    # combined feedback_tick() sequencing physics-then-feedback each scan).
    async def _sleep(ms: float) -> None:
        step_ms = h.runtime.scan_interval_ms
        remaining = ms
        while remaining > 0:
            tick = min(step_ms, remaining)
            h.clock.advance_ms(tick)
            await h.runtime.run_scan()
            mgr._physics_engine.tick()
            mgr._feedback_engine.tick()
            remaining -= tick
    runner.sleep_fn = _sleep

    result = await runner.run()
    assert result["state"] == "passed", json.dumps(result, ensure_ascii=False, indent=2)
    assert all(s["status"] == "pass" for s in result["steps"])


async def test_conveyor_exam_bundled_rig_via_simulation_manager_activate(tmp_path, monkeypatch):
    """Same pass-criteria as above, but exercised through the public
    SimulationManager.activate()/start_exam() path (closer to how the live
    server drives it) rather than poking private engine attributes."""
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    rig = _bundled_conveyor_exam()
    simulation.save_rig("conveyor_exam", rig)

    h = SimHarness()
    await h.scan()
    mgr = SimulationManager(h.runtime)
    mgr.activate("conveyor_exam")

    async def _sleep(ms: float) -> None:
        step_ms = h.runtime.scan_interval_ms
        remaining = ms
        while remaining > 0:
            tick = min(step_ms, remaining)
            h.clock.advance_ms(tick)
            await h.runtime.run_scan()
            mgr.feedback_tick()
            remaining -= tick

    runner = mgr.start_exam(sleep_fn=_sleep)
    result = await runner.run()
    assert result["state"] == "passed", json.dumps(result, ensure_ascii=False, indent=2)


# ── HTTP-level route tests (TestClient) ────────────────────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path / "sim_rigs")
    from main import app

    runtime.load_program(load_example_program())
    simulation.simulation_manager.deactivate()
    with TestClient(app) as c:
        yield c
    simulation.simulation_manager.deactivate()


def test_api_sim_state_empty_when_no_rig_active(client):
    resp = client.get("/api/sim/state")
    assert resp.status_code == 200
    assert resp.json() == {"jigs": {}, "sensors": {}, "relays": {}}


def test_api_sim_state_reflects_active_rig_jigs(client):
    rig = _bundled_conveyor_exam()
    client.put("/api/sim/rigs/conveyor_exam", json=rig)
    client.post("/api/sim/rigs/conveyor_exam/activate")

    resp = client.get("/api/sim/state")
    assert resp.status_code == 200
    body = resp.json()
    assert body["jigs"]["jig1"]["position_mm"] == 0.0
    assert body["sensors"]["sens1"] is False


def test_api_reset_jig_endpoint(client):
    rig = _bundled_conveyor_exam()
    client.put("/api/sim/rigs/conveyor_exam", json=rig)
    client.post("/api/sim/rigs/conveyor_exam/activate")

    resp = client.post("/api/sim/jigs/jig1/reset")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "jig": "jig1"}


def test_api_reset_jig_unknown_jig_404(client):
    rig = _bundled_conveyor_exam()
    client.put("/api/sim/rigs/conveyor_exam", json=rig)
    client.post("/api/sim/rigs/conveyor_exam/activate")

    resp = client.post("/api/sim/jigs/nope/reset")
    assert resp.status_code == 404


def test_api_reset_jig_without_active_rig_404(client):
    resp = client.post("/api/sim/jigs/jig1/reset")
    assert resp.status_code == 404


def test_bundled_conveyor_exam_rig_exists_and_loads():
    names = sorted(p.stem for p in SIM_RIGS_DIR.glob("*.json"))
    assert "conveyor_exam" in names
    rig = _bundled_conveyor_exam()
    assert rig["exam"]["steps"]
    assert any(d["type"] == "conveyor" for d in rig["devices"])
    assert any(d["type"] == "jig" for d in rig["devices"])
    assert any(d["type"] == "position_sensor" for d in rig["devices"])
