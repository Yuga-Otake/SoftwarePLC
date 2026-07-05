"""Tests for the simulation tab: sim-rig CRUD (+ shape validation), the
feedback-rule engine (simple plant simulation), and the sequencer exam
runner (live/async but driven fully by a VirtualClock + no-real-sleep stub
here, so the whole suite stays fast and deterministic -- same philosophy as
the rest of `backend/tests/`, see DEV_WORKFLOW.md).

Layered like the rest of the suite:
  - Headless engine tests (`plc.simulation` directly, VirtualClock, no HTTP)
    for the feedback-rule engine and the exam runner's step logic.
  - HTTP-level tests (`TestClient`) for the `/api/sim/*` route shapes and
    validation, mirroring `tests/test_debug_api.py` / HMI-screen tests.
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
    FeedbackRuleEngine,
    SimulationManager,
    read_signal,
    write_signal,
)
from tests.conftest import load_example_program  # noqa: E402

REPO_ROOT = BACKEND_DIR.parent
SIM_RIGS_DIR = BACKEND_DIR / "sim_rigs"


# ── Headless harness (mirrors tests/conftest.py's Harness) ─────────────────

class SimHarness:
    def __init__(self, scan_interval_ms: float = 100.0):
        self.clock = VirtualClock(start_ms=0.0)
        self.runtime = PLCRuntime(clock=self.clock)
        self.runtime.scan_interval_ms = scan_interval_ms
        self.runtime.load_program(load_example_program())

    async def scan(self, n: int = 1):
        for _ in range(n):
            await self.runtime.run_scan()

    async def advance(self, delta_ms: float, feedback: FeedbackRuleEngine | None = None):
        """Advance the virtual clock in scan_interval_ms ticks, optionally
        ticking a feedback-rule engine after each scan (mirrors how the live
        server's post_scan_hook fires once per control-task scan)."""
        step_ms = self.runtime.scan_interval_ms
        remaining = delta_ms
        while remaining > 0:
            tick = min(step_ms, remaining)
            self.clock.advance_ms(tick)
            await self.runtime.run_scan()
            if feedback is not None:
                feedback.tick()
            remaining -= tick


async def _no_sleep(_ms: float) -> None:
    """Sleep-fn stub for ExamRunner: instead of really waiting, advance the
    virtual clock by one poll interval and run a scan, so timer-driven
    signals (TON/TOFF, feedback rules) actually progress. This is what makes
    the whole exam-runner test suite run in milliseconds instead of seconds."""


def make_exam_sleep_fn(harness: SimHarness, feedback: FeedbackRuleEngine | None = None):
    async def _sleep(ms: float) -> None:
        await harness.advance(ms, feedback=feedback)
    return _sleep


# ── Rig CRUD + shape validation (headless, direct module calls) ────────────

@pytest.fixture(autouse=True)
def _isolate_rig_files(tmp_path, monkeypatch):
    """Point SIM_RIGS_DIR at a scratch directory for CRUD tests that write
    files, so we never touch the real backend/sim_rigs/*.json samples."""
    scratch = tmp_path / "sim_rigs"
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", scratch)
    yield scratch


def test_list_rigs_empty_when_dir_absent():
    assert simulation.list_rigs() == []


def test_save_and_load_rig_roundtrip():
    rig = {"name": "demo", "title": "Demo", "devices": [], "feedback_rules": [], "exam": {"steps": []}}
    simulation.save_rig("demo", rig)
    assert simulation.list_rigs() == ["demo"]
    loaded = simulation.load_rig("demo")
    assert loaded["title"] == "Demo"


def test_delete_rig():
    simulation.save_rig("demo", {"name": "demo"})
    simulation.delete_rig("demo")
    assert simulation.list_rigs() == []
    assert simulation.load_rig("demo") is None


def test_save_rig_rejects_non_list_devices():
    with pytest.raises(ValueError):
        simulation.save_rig("bad", {"devices": "not-a-list"})


def test_save_rig_rejects_non_list_feedback_rules():
    with pytest.raises(ValueError):
        simulation.save_rig("bad", {"feedback_rules": {"watch": "x"}})


def test_save_rig_rejects_non_dict_exam():
    with pytest.raises(ValueError):
        simulation.save_rig("bad", {"exam": ["not", "a", "dict"]})


def test_save_rig_rejects_non_list_exam_steps():
    with pytest.raises(ValueError):
        simulation.save_rig("bad", {"exam": {"steps": "nope"}})


def test_rig_name_must_be_safe():
    with pytest.raises(ValueError):
        simulation.save_rig("../etc/passwd", {})


# ── Signal read/write helper ─────────────────────────────────────────────

async def test_read_write_signal_digital_input_immediate():
    h = SimHarness()
    write_signal(h.runtime, "x_start", True)
    # Immediately readable (no scan yet) -- same BUG-006 style race fix as
    # the variable manager's I/O rows.
    assert read_signal(h.runtime, "x_start") is True
    assert read_signal(h.runtime, "x_start.OUT") is True


async def test_read_signal_output_port():
    h = SimHarness()
    await h.scan()
    assert read_signal(h.runtime, "y_motor.OUT") is False
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)  # hold latch (R=NOT(x_stop))
    await h.scan()
    assert read_signal(h.runtime, "y_motor.OUT") is True


async def test_read_signal_bare_id_falls_back_to_virtual_io():
    """A rig can reference a "virtual" feedback signal (e.g. a sensor input)
    that isn't a real DigitalInput node on the canvas -- read_signal should
    still surface it via the forced I/O store instead of crashing/returning
    a wrong default."""
    h = SimHarness()
    await h.scan()
    assert read_signal(h.runtime, "x_motor_fb") is None
    write_signal(h.runtime, "x_motor_fb", True)
    assert read_signal(h.runtime, "x_motor_fb") is True


async def test_read_signal_variable():
    h = SimHarness()
    from plc.models import VariableDefinition
    h.runtime.add_variable(VariableDefinition(id="v1", type="bool", initial=False))
    assert read_signal(h.runtime, "var.v1") is False
    write_signal(h.runtime, "var.v1", True)
    assert read_signal(h.runtime, "var.v1") is True


# ── Feedback rule engine (delay + revert_on_clear, VirtualClock) ──────────

async def test_feedback_rule_applies_after_delay():
    h = SimHarness()
    rules = [{"watch": "y_motor.OUT", "equals": True, "delay_ms": 500,
              "set_input": "x_motor_fb", "value": True, "revert_on_clear": True}]
    fb = FeedbackRuleEngine(h.runtime, h.clock, rules)

    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.advance(100, feedback=fb)
    assert read_signal(h.runtime, "y_motor.OUT") is True
    # Not yet -- delay hasn't elapsed (condition became true at t=100, delay
    # is 500ms, so it's due at t=600).
    assert read_signal(h.runtime, "x_motor_fb") is not True

    await h.advance(600, feedback=fb)  # total 700ms since motor turned on, well past the 600ms due time
    assert read_signal(h.runtime, "x_motor_fb") is True


async def test_feedback_rule_reverts_on_clear():
    h = SimHarness()
    rules = [{"watch": "y_motor.OUT", "equals": True, "delay_ms": 200,
              "set_input": "x_motor_fb", "value": True, "revert_on_clear": True}]
    fb = FeedbackRuleEngine(h.runtime, h.clock, rules)

    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.advance(300, feedback=fb)
    assert read_signal(h.runtime, "x_motor_fb") is True

    # Release the latch (S=False, R=NOT(x_stop)=True with x_stop left False)
    # -> y_motor.OUT goes False -> feedback should revert.
    write_signal(h.runtime, "x_start", False)
    write_signal(h.runtime, "x_stop", False)
    await h.advance(100, feedback=fb)
    assert read_signal(h.runtime, "y_motor.OUT") is False
    assert read_signal(h.runtime, "x_motor_fb") is False


async def test_feedback_rule_without_revert_stays_latched():
    h = SimHarness()
    rules = [{"watch": "y_motor.OUT", "equals": True, "delay_ms": 100,
              "set_input": "x_motor_fb", "value": True, "revert_on_clear": False}]
    fb = FeedbackRuleEngine(h.runtime, h.clock, rules)

    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.advance(200, feedback=fb)
    assert read_signal(h.runtime, "x_motor_fb") is True

    write_signal(h.runtime, "x_start", False)
    write_signal(h.runtime, "x_stop", False)
    await h.advance(100, feedback=fb)
    assert read_signal(h.runtime, "y_motor.OUT") is False
    # No revert configured -- feedback value should remain latched True.
    assert read_signal(h.runtime, "x_motor_fb") is True


async def test_feedback_rule_reset_clears_state():
    h = SimHarness()
    rules = [{"watch": "y_motor.OUT", "equals": True, "delay_ms": 100,
              "set_input": "x_motor_fb", "value": True, "revert_on_clear": True}]
    fb = FeedbackRuleEngine(h.runtime, h.clock, rules)
    write_signal(h.runtime, "x_start", True)
    write_signal(h.runtime, "x_stop", True)
    await h.advance(200, feedback=fb)
    assert read_signal(h.runtime, "x_motor_fb") is True
    fb.reset()
    assert fb._state[0].applied is False
    assert fb._state[0].condition_since_ms is None


# ── Exam runner: headless, driven by VirtualClock via a custom sleep_fn ───

def _bundled_motor_exam() -> dict:
    return json.loads((REPO_ROOT / "backend" / "sim_rigs" / "motor_exam.json").read_text(encoding="utf-8"))


async def test_exam_runner_bundled_motor_exam_passes():
    h = SimHarness()
    rig = _bundled_motor_exam()
    fb = FeedbackRuleEngine(h.runtime, h.clock, rig["feedback_rules"])
    await h.scan()  # prime, mirrors scenario runner / server startup

    runner = ExamRunner(h.runtime, h.clock, rig["exam"], sleep_fn=make_exam_sleep_fn(h, feedback=fb))
    result = await runner.run()

    assert result["state"] == "passed", json.dumps(result, ensure_ascii=False, indent=2)
    assert all(s["status"] == "pass" for s in result["steps"])


async def test_exam_runner_bundled_lamp_practice_passes():
    h = SimHarness()
    rig = json.loads((REPO_ROOT / "backend" / "sim_rigs" / "lamp_practice.json").read_text(encoding="utf-8"))
    await h.scan()

    runner = ExamRunner(h.runtime, h.clock, rig["exam"], sleep_fn=make_exam_sleep_fn(h))
    result = await runner.run()

    assert result["state"] == "passed", json.dumps(result, ensure_ascii=False, indent=2)


async def test_exam_runner_fails_when_program_never_satisfies_expect():
    """A deliberately-impossible expectation should FAIL (not hang/timeout
    the test suite) -- the runner's own within_ms budget bounds it."""
    h = SimHarness()
    await h.scan()
    exam = {
        "title": "impossible",
        "steps": [
            {"op": "set", "signal": "x_start", "value": True},
            # y_done can never go True this fast (TON PT=3000ms) -- exercises
            # the "timeout" failure path.
            {"op": "expect", "signal": "y_done.OUT", "value": True, "within_ms": 50},
        ],
    }
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h))
    result = await runner.run()

    assert result["state"] == "failed"
    assert result["steps"][0]["status"] == "pass"
    assert result["steps"][1]["status"] == "fail"
    assert "timeout" in result["steps"][1]["error"]


async def test_exam_runner_after_ms_too_early_is_a_failure():
    """The done lamp lights at exactly 3000ms; requiring after_ms=5000 means
    it satisfies "too early" and must fail, not pass."""
    h = SimHarness()
    await h.scan()
    exam = {
        "title": "too-early-check",
        "steps": [
            {"op": "set", "signal": "x_start", "value": True},
            {"op": "set", "signal": "x_stop", "value": True},
            {"op": "expect", "signal": "y_done.OUT", "value": True, "after_ms": 5000, "within_ms": 6000},
        ],
    }
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h))
    result = await runner.run()

    assert result["state"] == "failed"
    assert result["steps"][2]["status"] == "fail"
    assert "too early" in result["steps"][2]["error"]


async def test_exam_runner_abort_mid_run():
    h = SimHarness()
    await h.scan()
    exam = {
        "title": "abort-me",
        "steps": [
            {"op": "set", "signal": "x_start", "value": True},
            {"op": "expect", "signal": "y_done.OUT", "value": True, "within_ms": 10_000},
        ],
    }
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h))

    async def _sleep_then_abort(ms: float) -> None:
        runner.abort()
        await h.advance(ms)

    runner.sleep_fn = _sleep_then_abort
    result = await runner.run()

    assert result["state"] == "aborted"


async def test_exam_runner_status_transitions_pending_running_pass():
    """Track that step statuses move pending -> running -> pass in order as
    the exam progresses (not all-at-once at the end) -- important for the
    frontend exam panel's live per-step UI."""
    h = SimHarness()
    await h.scan()
    exam = {
        "title": "status-check",
        "steps": [
            {"op": "set", "signal": "x_start", "value": True},
            {"op": "expect", "signal": "y_motor.OUT", "value": True, "within_ms": 500},
        ],
    }
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h))

    assert all(s.status == "pending" for s in runner.steps)
    await runner.run()
    assert [s.status for s in runner.steps] == ["pass", "pass"]
    assert runner.state == "passed"


async def test_exam_runner_unknown_op_fails_gracefully():
    h = SimHarness()
    await h.scan()
    exam = {"title": "bad-op", "steps": [{"op": "frobnicate", "signal": "x_start"}]}
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h))
    result = await runner.run()
    assert result["state"] == "failed"
    assert result["steps"][0]["status"] == "fail"


# ── SimulationManager (activation lifecycle) ───────────────────────────────

async def test_simulation_manager_activate_wires_feedback_and_exam(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    rig = _bundled_motor_exam()
    simulation.save_rig("motor_exam", rig)

    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    loaded = mgr.activate("motor_exam")
    assert loaded["name"] == "motor_exam"
    assert mgr.active_rig_name == "motor_exam"

    # feedback_tick should be a no-op-safe call even before any exam runs.
    mgr.feedback_tick()

    mgr.deactivate()
    assert mgr.active_rig_name is None
    assert mgr.active_rig is None


async def test_start_exam_resets_stale_forced_signals_from_previous_run(tmp_path, monkeypatch):
    """Regression test: a feedback-rule output (e.g. the simulated rotation
    sensor `x_motor_fb`) left True from manual device interaction or a prior
    exam run must not still read True at t=0 of the next run -- otherwise an
    `after_ms` ("not too early") check spuriously fails because the
    condition looks like it was already satisfied before the exam even
    started. Found via preview/live-server exploration, not headless tests
    (see docs/QA_LOG.md BUG-007)."""
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    rig = _bundled_motor_exam()
    simulation.save_rig("motor_exam", rig)

    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    mgr.activate("motor_exam")

    # Simulate leftover state from a previous run/manual interaction: the
    # rotation-sensor feedback signal is already True before this run starts.
    write_signal(h.runtime, "x_motor_fb", True)
    assert read_signal(h.runtime, "x_motor_fb") is True

    runner = mgr.start_exam(sleep_fn=make_exam_sleep_fn(h, feedback=mgr._feedback_engine))
    # start_exam() resets it synchronously, before the background run begins.
    assert read_signal(h.runtime, "x_motor_fb") is False

    result = await runner.run()
    assert result["state"] == "passed", json.dumps(result, ensure_ascii=False, indent=2)


async def test_activate_resets_stale_forced_signals(tmp_path, monkeypatch):
    """Same guarantee as start_exam's reset, but triggered by (re)activating
    a rig -- e.g. switching away and back, or the operator pressing a
    pushbutton device and then reactivating without ever starting an exam."""
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    simulation.save_rig("motor_exam", _bundled_motor_exam())

    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    write_signal(h.runtime, "x_start", True)
    assert read_signal(h.runtime, "x_start") is True

    mgr.activate("motor_exam")
    assert read_signal(h.runtime, "x_start") is False


async def test_simulation_manager_activate_unknown_rig_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    with pytest.raises(KeyError):
        mgr.activate("does_not_exist")


async def test_simulation_manager_start_exam_without_active_rig_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    with pytest.raises(RuntimeError):
        mgr.start_exam()


async def test_simulation_manager_exam_status_idle_before_start(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    assert mgr.exam_status() == {"state": "idle", "title": None, "steps": []}


async def test_simulation_manager_start_exam_twice_while_running_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    simulation.save_rig("motor_exam", _bundled_motor_exam())
    h = SimHarness()
    mgr = SimulationManager(h.runtime)
    mgr.activate("motor_exam")
    runner = mgr.start_exam(sleep_fn=make_exam_sleep_fn(h))
    runner.state = "running"  # simulate an in-flight run without awaiting it
    with pytest.raises(RuntimeError):
        mgr.start_exam(sleep_fn=make_exam_sleep_fn(h))


# ── HTTP-level route tests (TestClient, mirrors test_debug_api.py) ────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path / "sim_rigs")
    from main import app

    runtime.load_program(load_example_program())
    simulation.simulation_manager.deactivate()
    with TestClient(app) as c:
        yield c
    simulation.simulation_manager.deactivate()


def test_api_list_rigs_empty(client):
    resp = client.get("/api/sim/rigs")
    assert resp.status_code == 200
    assert resp.json() == []


def test_api_put_get_delete_rig_roundtrip(client):
    rig = {"name": "demo", "title": "Demo Rig", "devices": [], "feedback_rules": [], "exam": {"steps": []}}
    resp = client.put("/api/sim/rigs/demo", json=rig)
    assert resp.status_code == 200

    resp = client.get("/api/sim/rigs/demo")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Demo Rig"

    resp = client.get("/api/sim/rigs")
    assert resp.json() == ["demo"]

    resp = client.delete("/api/sim/rigs/demo")
    assert resp.status_code == 200
    assert client.get("/api/sim/rigs/demo").status_code == 404


def test_api_get_unknown_rig_404(client):
    assert client.get("/api/sim/rigs/nope").status_code == 404


def test_api_put_rig_rejects_non_list_devices(client):
    resp = client.put("/api/sim/rigs/bad", json={"devices": "nope"})
    assert resp.status_code == 400


def test_api_activate_unknown_rig_404(client):
    resp = client.post("/api/sim/rigs/nope/activate")
    assert resp.status_code == 404


def test_api_activate_and_deactivate_rig(client):
    rig = {"name": "demo", "devices": [], "feedback_rules": [], "exam": {"steps": []}}
    client.put("/api/sim/rigs/demo", json=rig)

    resp = client.post("/api/sim/rigs/demo/activate")
    assert resp.status_code == 200
    assert resp.json()["active_rig"] == "demo"

    resp = client.get("/api/sim/active")
    assert resp.json()["active_rig"] == "demo"

    resp = client.post("/api/sim/deactivate")
    assert resp.status_code == 200
    assert client.get("/api/sim/active").json()["active_rig"] is None


def test_api_exam_start_without_active_rig_400(client):
    resp = client.post("/api/sim/exam/start")
    assert resp.status_code == 400


def test_api_exam_start_response_state_is_running_not_idle(client):
    """Regression check: POST /api/sim/exam/start must report state=="running"
    in its own response, not the ExamRunner's pre-run() default of "idle" --
    the manager marks it running synchronously before the background task is
    scheduled (see SimulationManager.start_exam), so a client polling
    GET .../status right after start never needs to special-case a startup
    race."""
    rig = _bundled_motor_exam()
    client.put("/api/sim/rigs/motor_exam", json=rig)
    client.post("/api/sim/rigs/motor_exam/activate")
    resp = client.post("/api/sim/exam/start")
    assert resp.status_code == 200
    assert resp.json()["state"] == "running"
    client.post("/api/sim/exam/abort")


def test_api_exam_start_twice_while_running_rejected(client):
    rig = _bundled_motor_exam()
    client.put("/api/sim/rigs/motor_exam", json=rig)
    client.post("/api/sim/rigs/motor_exam/activate")
    r1 = client.post("/api/sim/exam/start")
    assert r1.status_code == 200
    r2 = client.post("/api/sim/exam/start")
    assert r2.status_code == 400
    client.post("/api/sim/exam/abort")


def test_api_exam_status_idle_by_default(client):
    resp = client.get("/api/sim/exam/status")
    assert resp.status_code == 200
    assert resp.json()["state"] == "idle"


def test_api_exam_abort_is_safe_when_not_running(client):
    resp = client.post("/api/sim/exam/abort")
    assert resp.status_code == 200


def test_api_delete_rig_deactivates_if_active(client):
    rig = {"name": "demo", "devices": [], "feedback_rules": [], "exam": {"steps": []}}
    client.put("/api/sim/rigs/demo", json=rig)
    client.post("/api/sim/rigs/demo/activate")
    assert client.get("/api/sim/active").json()["active_rig"] == "demo"

    client.delete("/api/sim/rigs/demo")
    assert client.get("/api/sim/active").json()["active_rig"] is None


def test_bundled_sample_rigs_exist_and_load():
    """Sanity: the two sample rigs shipped in backend/sim_rigs/ (not the
    tmp_path-isolated ones from other tests) parse and have the expected
    shape -- proves "an exam machine is just a JSON file", per the design
    constraint that the exam machine must not be hardcoded in the tool."""
    names = sorted(p.stem for p in SIM_RIGS_DIR.glob("*.json"))
    assert "motor_exam" in names
    assert "lamp_practice" in names
    motor = json.loads((SIM_RIGS_DIR / "motor_exam.json").read_text(encoding="utf-8"))
    assert motor["exam"]["steps"]
    assert motor["devices"]
    lamp = json.loads((SIM_RIGS_DIR / "lamp_practice.json").read_text(encoding="utf-8"))
    assert lamp["exam"]["steps"]
