"""Tests for the KENTEI-PLC-style panel extension to the simulation tab:
`relay` devices (coil -> contact, driving a conveyor via the contact rather
than the coil directly), jig feature attach/detach (screws that can be
removed so a position_sensor stops detecting them), and the
`examples/kentei_machine.json` program + `backend/sim_rigs/kentei_plc.json`
exam machine built on top of them.

Same philosophy as test_conveyor.py: every test is driven by a
`VirtualClock` (no real `time.sleep`/`asyncio.sleep`), so the whole suite
stays fast and deterministic.
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
from plc.models import ProgramGraph  # noqa: E402
from plc.runtime import PLCRuntime, runtime  # noqa: E402
from plc import simulation  # noqa: E402
from plc.simulation import (  # noqa: E402
    ExamRunner,
    FeedbackRuleEngine,
    PhysicsEngine,
    SimulationManager,
    read_signal,
    write_signal,
)
from tests.conftest import load_example_program  # noqa: E402
from tests.test_simulation import SimHarness, make_exam_sleep_fn  # noqa: E402

REPO_ROOT = BACKEND_DIR.parent
SIM_RIGS_DIR = BACKEND_DIR / "sim_rigs"
EXAMPLES_DIR = REPO_ROOT / "examples"


def _bundled_kentei_plc() -> dict:
    return json.loads((SIM_RIGS_DIR / "kentei_plc.json").read_text(encoding="utf-8"))


def _kentei_machine_program() -> ProgramGraph:
    data = json.loads((EXAMPLES_DIR / "kentei_machine.json").read_text(encoding="utf-8"))
    return ProgramGraph(**data)


class KenteiHarness(SimHarness):
    """Like SimHarness, but loads examples/kentei_machine.json instead of
    start_stop.json (the bundled rig's target_program)."""

    def __init__(self, scan_interval_ms: float = 100.0):
        self.clock = VirtualClock(start_ms=0.0)
        self.runtime = PLCRuntime(clock=self.clock)
        self.runtime.scan_interval_ms = scan_interval_ms
        self.runtime.load_program(_kentei_machine_program())


# ── relay device: coil -> contact mirroring ────────────────────────────────

RELAY = {"id": "ry1", "type": "relay", "coil_signal": "coil_in", "contact_signal": "contact_out"}


async def test_relay_contact_follows_coil_true():
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [RELAY])
    write_signal(h.runtime, "coil_in", True)
    phys.tick()
    assert phys.relay_energized["ry1"] is True
    assert read_signal(h.runtime, "contact_out") is True


async def test_relay_contact_follows_coil_false_no_delay():
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [RELAY])
    write_signal(h.runtime, "coil_in", True)
    phys.tick()
    assert read_signal(h.runtime, "contact_out") is True

    write_signal(h.runtime, "coil_in", False)
    phys.tick()  # no excitation delay -- immediate per spec
    assert phys.relay_energized["ry1"] is False
    assert read_signal(h.runtime, "contact_out") is False


async def test_relay_contact_defaults_false_when_coil_never_asserted():
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [RELAY])
    phys.tick()
    assert phys.relay_energized["ry1"] is False


async def test_conveyor_driven_via_relay_contact_not_coil_directly():
    """The whole point of the relay device: a conveyor's drive_signal points
    at the relay's *contact*, not the PLC output directly (models "PLC
    output -> relay coil -> contact -> motor" real wiring, see
    docs/SIMULATION.md)."""
    h = SimHarness()
    conveyor = {"id": "conv1", "type": "conveyor", "drive_signal": "contact_out",
                "reverse_signal": None, "length_mm": 1000, "speed_mm_s": 200}
    jig = {"id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 0, "size_mm": 100, "features": []}
    devices = [RELAY, conveyor, jig]
    phys = PhysicsEngine(h.runtime, h.clock, devices)

    # Coil off -> contact off -> conveyor must not move even after time passes.
    phys.tick()
    h.clock.advance_ms(1000)
    phys.tick()
    assert phys.positions["jig1"] == 0.0

    # Energize the coil -> contact closes -> conveyor now drives the jig.
    write_signal(h.runtime, "coil_in", True)
    phys.tick()  # relay reacts this tick
    h.clock.advance_ms(1000)
    phys.tick()
    assert phys.positions["jig1"] == pytest.approx(200.0)


async def test_two_relays_drive_forward_and_reverse_independently():
    """kentei_plc.json's actual wiring shape: two relays (fwd/rev), each with
    its own contact, feeding a single conveyor's drive_signal/reverse_signal
    respectively -- either relay alone must be able to move the jig (not just
    "reverse flips direction while drive_signal is also true", the original
    single-relay convention conveyor_exam.json used)."""
    h = SimHarness()
    ry_fwd = {"id": "ry_fwd", "type": "relay", "coil_signal": "coil_fwd", "contact_signal": "contact_fwd"}
    ry_rev = {"id": "ry_rev", "type": "relay", "coil_signal": "coil_rev", "contact_signal": "contact_rev"}
    conveyor = {"id": "conv1", "type": "conveyor", "drive_signal": "contact_fwd",
                "reverse_signal": "contact_rev", "length_mm": 1000, "speed_mm_s": 100}
    jig = {"id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 500, "size_mm": 100, "features": []}
    devices = [ry_fwd, ry_rev, conveyor, jig]
    phys = PhysicsEngine(h.runtime, h.clock, devices)
    phys.tick()

    # Reverse relay alone (forward relay never energized) must still move
    # the jig backwards -- this is the case conveyor_exam.json never
    # exercised (it only ever asserted drive_signal, using reverse_signal
    # purely as a direction flag on top of an already-true drive_signal).
    write_signal(h.runtime, "coil_rev", True)
    phys.tick()
    h.clock.advance_ms(1000)
    phys.tick()
    assert phys.positions["jig1"] == pytest.approx(400.0)  # 500 - 100mm


# ── jig feature attach/detach (screws) ──────────────────────────────────────

SCREW_JIG = {
    "id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 700, "size_mm": 120,
    "features": [{"id": "screw1", "type": "screw", "offset_mm": 100, "attached": True}],
}
SCREW_CONVEYOR = {"id": "conv1", "type": "conveyor", "drive_signal": "y_motor.OUT",
                   "reverse_signal": None, "length_mm": 1000, "speed_mm_s": 200}
SCREW_SENSOR = {"id": "sens1", "type": "position_sensor", "conveyor": "conv1", "at_mm": 800,
                "window_mm": 12, "detect": "feature", "signal": "x_screw_det"}


async def test_attached_screw_is_detected_by_default():
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, SCREW_JIG, SCREW_SENSOR])
    phys.tick()  # screw at 700+100=800, dead-center of the 800mm sensor
    assert phys.sensor_active["sens1"] is True


async def test_detached_screw_is_never_detected():
    h = SimHarness()
    jig = json.loads(json.dumps(SCREW_JIG))  # deep copy
    jig["features"][0]["attached"] = False
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, jig, SCREW_SENSOR])
    phys.tick()
    assert phys.sensor_active["sens1"] is False
    assert read_signal(h.runtime, "x_screw_det") is None  # never toggled True, see test_conveyor.py convention


async def test_set_feature_attached_toggles_detection_live():
    h = SimHarness()
    jig = json.loads(json.dumps(SCREW_JIG))
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, jig, SCREW_SENSOR])
    phys.tick()
    assert phys.sensor_active["sens1"] is True

    assert phys.set_feature_attached("jig1", "screw1", False) is True
    assert phys.sensor_active["sens1"] is False  # re-evaluated synchronously
    assert read_signal(h.runtime, "x_screw_det") is False

    assert phys.set_feature_attached("jig1", "screw1", True) is True
    assert phys.sensor_active["sens1"] is True
    assert read_signal(h.runtime, "x_screw_det") is True


async def test_set_feature_attached_unknown_jig_returns_false():
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, SCREW_JIG, SCREW_SENSOR])
    assert phys.set_feature_attached("nope", "screw1", False) is False


async def test_set_feature_attached_unknown_feature_returns_false():
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, SCREW_JIG, SCREW_SENSOR])
    assert phys.set_feature_attached("jig1", "does_not_exist", False) is False


async def test_exam_runner_set_feature_op():
    h = SimHarness()
    jig = json.loads(json.dumps(SCREW_JIG))
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, jig, SCREW_SENSOR])
    phys.tick()
    assert phys.sensor_active["sens1"] is True

    exam = {"title": "detach-check", "steps": [
        {"op": "set_feature", "jig": "jig1", "feature": "screw1", "attached": False},
        {"op": "expect", "signal": "x_screw_det", "value": False, "within_ms": 300},
    ]}
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h), physics=phys)
    result = await runner.run()
    assert result["state"] == "passed", json.dumps(result, ensure_ascii=False)


async def test_exam_runner_set_feature_op_unknown_fails():
    h = SimHarness()
    exam = {"title": "detach-fail", "steps": [
        {"op": "set_feature", "jig": "nope", "feature": "screw1", "attached": False},
    ]}
    runner = ExamRunner(h.runtime, h.clock, exam, sleep_fn=make_exam_sleep_fn(h), physics=None)
    result = await runner.run()
    assert result["state"] == "failed"
    assert "unknown jig/feature" in result["steps"][0]["error"]


async def test_sim_state_reports_feature_attached_flags():
    h = SimHarness()
    jig = json.loads(json.dumps(SCREW_JIG))
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, jig, SCREW_SENSOR])
    phys.tick()
    state = phys.state()
    assert state["jigs"]["jig1"]["features"]["screw1"]["attached"] is True
    phys.set_feature_attached("jig1", "screw1", False)
    assert phys.state()["jigs"]["jig1"]["features"]["screw1"]["attached"] is False


# ── lanes (width-wise position): features + position_sensor both carry a
# `lane` -- a "feature" sensor only detects features sharing its own lane
# (see docs/SIMULATION.md "レーン" and the KENTEI-PLC-style 4-lane jig this
# was built for). "jig" detectors (limit switches) ignore lane entirely
# (they see the jig body, not any particular row of screw holes). ──────────

LANE_JIG = {
    "id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 700, "size_mm": 120,
    "features": [
        {"id": "screwA", "type": "screw", "offset_mm": 60, "lane": 0, "attached": True},
        {"id": "screwB", "type": "screw", "offset_mm": 60, "lane": 1, "attached": True},
    ],
}
LANE_CONVEYOR = {"id": "conv1", "type": "conveyor", "drive_signal": "y_motor.OUT",
                  "reverse_signal": None, "length_mm": 1000, "speed_mm_s": 200}
LANE_SENSOR_0 = {"id": "sens_lane0", "type": "position_sensor", "conveyor": "conv1", "at_mm": 760,
                  "lane": 0, "window_mm": 12, "detect": "feature", "signal": "x_lane0_det"}
LANE_SENSOR_1 = {"id": "sens_lane1", "type": "position_sensor", "conveyor": "conv1", "at_mm": 760,
                  "lane": 1, "window_mm": 12, "detect": "feature", "signal": "x_lane1_det"}


async def test_lane_sensor_does_not_detect_other_lanes_screw():
    """A lane-0 sensor must not see a screw sitting in lane 1, even though
    both are at the exact same along-belt offset (760mm) and the sensor's
    window would otherwise clearly cover it -- lane is a hard filter, not an
    additional "nice to have" narrowing."""
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [LANE_CONVEYOR, LANE_JIG, LANE_SENSOR_0, LANE_SENSOR_1])
    phys.tick()  # jig1 home_mm=700, both screws at 700+60=760 -- dead-center of both sensors
    assert phys.sensor_active["sens_lane0"] is True   # sees its own lane's screw (screwA, lane 0)
    assert phys.sensor_active["sens_lane1"] is True   # sees its own lane's screw (screwB, lane 1)
    assert read_signal(h.runtime, "x_lane0_det") is True
    assert read_signal(h.runtime, "x_lane1_det") is True


async def test_lane_sensor_ignores_screw_when_only_other_lane_attached():
    """If lane 0's screw is removed but lane 1's stays attached, the lane-0
    sensor must read not-detected even though a screw (lane 1's) is
    physically passing under the same at_mm at the same instant."""
    h = SimHarness()
    jig = json.loads(json.dumps(LANE_JIG))
    jig["features"][0]["attached"] = False  # detach screwA (lane 0)
    phys = PhysicsEngine(h.runtime, h.clock, [LANE_CONVEYOR, jig, LANE_SENSOR_0, LANE_SENSOR_1])
    phys.tick()
    assert phys.sensor_active["sens_lane0"] is False  # lane 0's own screw is gone
    assert phys.sensor_active["sens_lane1"] is True   # lane 1's screw is still there


async def test_four_lane_sensors_detect_only_attached_lanes_simultaneously():
    """The actual KENTEI-PLC shape: 4 sensors at the same at_mm, one per
    lane, with only some lanes' screws attached -- passing the jig through
    must light up exactly the attached lanes' sensors, all in the same
    tick (a real simultaneous multi-input read of the mounting pattern)."""
    h = SimHarness()
    jig = {
        "id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 390, "size_mm": 120,
        "features": [
            {"id": "s0", "type": "screw", "offset_mm": 60, "lane": 0, "attached": True},
            {"id": "s1", "type": "screw", "offset_mm": 60, "lane": 1, "attached": False},
            {"id": "s2", "type": "screw", "offset_mm": 60, "lane": 2, "attached": True},
            {"id": "s3", "type": "screw", "offset_mm": 60, "lane": 3, "attached": False},
        ],
    }
    conveyor = {"id": "conv1", "type": "conveyor", "drive_signal": "y_motor.OUT",
                "reverse_signal": None, "length_mm": 1000, "speed_mm_s": 200}
    sensors = [
        {"id": f"sens{i}", "type": "position_sensor", "conveyor": "conv1", "at_mm": 450,
         "lane": i, "window_mm": 12, "detect": "feature", "signal": f"x_sens{i}"}
        for i in range(4)
    ]
    phys = PhysicsEngine(h.runtime, h.clock, [conveyor, jig, *sensors])
    phys.tick()  # all 4 screws at 390+60=450, dead-center of all 4 sensors (which differ only by lane)
    assert phys.sensor_active["sens0"] is True
    assert phys.sensor_active["sens1"] is False
    assert phys.sensor_active["sens2"] is True
    assert phys.sensor_active["sens3"] is False


async def test_jig_detect_mode_ignores_lane():
    """A `detect: "jig"` sensor (limit switch) sees the jig body regardless
    of any `lane` set on it -- lane only matters for `detect: "feature"`."""
    h = SimHarness()
    jig = {"id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 795, "size_mm": 120, "features": []}
    conveyor = {"id": "conv1", "type": "conveyor", "drive_signal": "y_motor.OUT",
                "reverse_signal": None, "length_mm": 1000, "speed_mm_s": 200}
    ls = {"id": "ls1", "type": "position_sensor", "conveyor": "conv1", "at_mm": 800,
          "lane": 2, "window_mm": 10, "detect": "jig", "signal": "x_ls"}
    phys = PhysicsEngine(h.runtime, h.clock, [conveyor, jig, ls])
    phys.tick()
    assert phys.sensor_active["ls1"] is True


async def test_lane_unspecified_defaults_to_zero_backward_compatible():
    """A feature/sensor pair with no `lane` field at all (every rig authored
    before this extension -- conveyor_exam.json, motor_exam.json, and the
    pre-lane test_conveyor.py fixtures) must keep behaving exactly as if
    both were on an implicit lane 0, i.e. still detect each other."""
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, SCREW_JIG, SCREW_SENSOR])
    phys.tick()
    assert phys.sensor_active["sens1"] is True  # SCREW_JIG/SCREW_SENSOR (test_conveyor-style) have no "lane" key at all


async def test_lane_mismatch_between_unspecified_and_explicit_zero():
    """An unspecified `lane` and an explicit `lane: 0` must be treated
    identically (both resolve to lane 0) -- a sensor with no `lane` key must
    still detect a feature that explicitly declares `lane: 0`, and vice
    versa."""
    h = SimHarness()
    jig = {"id": "jig1", "type": "jig", "conveyor": "conv1", "home_mm": 700, "size_mm": 120,
           "features": [{"id": "screw1", "type": "screw", "offset_mm": 100, "lane": 0, "attached": True}]}
    conveyor = {"id": "conv1", "type": "conveyor", "drive_signal": "y_motor.OUT",
                "reverse_signal": None, "length_mm": 1000, "speed_mm_s": 200}
    # sensor has no "lane" key -- must still match the feature's explicit lane 0
    sensor = {"id": "sens1", "type": "position_sensor", "conveyor": "conv1", "at_mm": 800,
              "window_mm": 12, "detect": "feature", "signal": "x_det"}
    phys = PhysicsEngine(h.runtime, h.clock, [conveyor, jig, sensor])
    phys.tick()
    assert phys.sensor_active["sens1"] is True


async def test_sim_state_echoes_feature_lane():
    """GET /api/sim/state's per-feature entry now includes `lane` (see
    PhysicsEngine.state()) so the frontend can group screws into rows
    without re-fetching the static rig JSON."""
    h = SimHarness()
    jig = json.loads(json.dumps(LANE_JIG))
    phys = PhysicsEngine(h.runtime, h.clock, [LANE_CONVEYOR, jig, LANE_SENSOR_0, LANE_SENSOR_1])
    phys.tick()
    state = phys.state()
    assert state["jigs"]["jig1"]["features"]["screwA"]["lane"] == 0
    assert state["jigs"]["jig1"]["features"]["screwB"]["lane"] == 1


async def test_sim_state_feature_lane_defaults_to_zero_when_unspecified():
    h = SimHarness()
    phys = PhysicsEngine(h.runtime, h.clock, [SCREW_CONVEYOR, SCREW_JIG, SCREW_SENSOR])
    phys.tick()
    assert phys.state()["jigs"]["jig1"]["features"]["screw1"]["lane"] == 0


# ── ADD block: sums 2-4 numeric/bool inputs (backend/plc/nodes.py) ─────────

from plc.nodes import EXECUTORS  # noqa: E402


def test_add_executor_sums_bool_inputs_as_zero_one():
    add = EXECUTORS["ADD"]
    outputs, _ = add.execute({"IN1": True, "IN2": False, "IN3": True, "IN4": True}, {}, {})
    assert outputs["OUT"] == 3


def test_add_executor_sums_numeric_inputs():
    add = EXECUTORS["ADD"]
    outputs, _ = add.execute({"IN1": 2.5, "IN2": 1.5}, {}, {})
    assert outputs["OUT"] == 4


def test_add_executor_two_input_use_ignores_unconnected_ports():
    """Only IN1/IN2 wired (a plain 2-input adder use) -- IN3/IN4 simply
    aren't present in `inputs` at all, same "absent port" convention as
    AND/OR, and must not be treated as anything other than 0."""
    add = EXECUTORS["ADD"]
    outputs, _ = add.execute({"IN1": 5, "IN2": 7}, {}, {})
    assert outputs["OUT"] == 12


def test_add_executor_no_inputs_sums_to_zero():
    add = EXECUTORS["ADD"]
    outputs, _ = add.execute({}, {}, {})
    assert outputs["OUT"] == 0


def test_add_executor_whole_number_sum_stays_int_not_float():
    """A 2+2=4 sum must render as `4`, not `4.0`, so a downstream 7-seg
    display (DPL1) shows a clean integer -- see ADDExecutor's docstring."""
    add = EXECUTORS["ADD"]
    outputs, _ = add.execute({"IN1": 2, "IN2": 2}, {}, {})
    assert outputs["OUT"] == 4
    assert isinstance(outputs["OUT"], int)


def test_add_node_type_is_in_catalog():
    from plc.nodes import NODE_CATALOG
    assert "ADD" in NODE_CATALOG
    assert {p["name"] for p in NODE_CATALOG["ADD"]["input_ports"]} == {"IN1", "IN2", "IN3", "IN4"}
    assert NODE_CATALOG["ADD"]["output_ports"][0]["name"] == "OUT"


# ── digit_switch: pure signal-write device (frontend clicks -> write_signal) ─

async def test_digit_switch_writes_through_to_variable():
    """digit_switch has no dedicated engine logic (see docs/SIMULATION.md) --
    it's purely a `write_signal` target driven by frontend up/down clicks, so
    this just confirms the existing var write-path handles it like any other
    device signal write (same helper DeviceCanvas.tsx calls). Uses
    KenteiHarness because `var.dsw` must be a declared variable (see
    examples/kentei_machine.json) for force_variable_value to take effect --
    start_stop.json (SimHarness) has no such variable."""
    h = KenteiHarness()
    write_signal(h.runtime, "var.dsw", 5)
    assert read_signal(h.runtime, "var.dsw") == 5
    write_signal(h.runtime, "var.dsw", 0)
    assert read_signal(h.runtime, "var.dsw") == 0


# ── examples/kentei_machine.json: PLC program logic (headless) ─────────────

async def test_kentei_machine_pb1_latches_forward_and_lights_pl1():
    h = KenteiHarness()
    await h.scan()
    write_signal(h.runtime, "x_pb1", True)
    await h.scan()
    write_signal(h.runtime, "x_pb1", False)
    await h.scan()
    assert read_signal(h.runtime, "y_ry_fwd.OUT") is True
    assert read_signal(h.runtime, "y_ry_rev.OUT") is False
    assert read_signal(h.runtime, "pl1.OUT") is True
    assert read_signal(h.runtime, "pl2.OUT") is False


async def test_kentei_machine_ls_right_switches_forward_to_reverse():
    h = KenteiHarness()
    await h.scan()
    write_signal(h.runtime, "x_pb1", True)
    await h.scan()
    write_signal(h.runtime, "x_pb1", False)
    await h.scan()
    assert read_signal(h.runtime, "y_ry_fwd.OUT") is True

    write_signal(h.runtime, "x_ls_right", True)
    await h.scan()
    assert read_signal(h.runtime, "y_ry_fwd.OUT") is False
    assert read_signal(h.runtime, "y_ry_rev.OUT") is True
    assert read_signal(h.runtime, "pl1.OUT") is False
    assert read_signal(h.runtime, "pl2.OUT") is True

    # Releasing ls_right must NOT drop the reverse latch (it's an SR latch,
    # not a level-follower) -- reverse should keep running until ls_left.
    write_signal(h.runtime, "x_ls_right", False)
    await h.scan()
    assert read_signal(h.runtime, "y_ry_rev.OUT") is True


async def test_kentei_machine_ls_left_stops_everything():
    h = KenteiHarness()
    await h.scan()
    write_signal(h.runtime, "x_pb1", True)
    await h.scan()
    write_signal(h.runtime, "x_pb1", False)
    write_signal(h.runtime, "x_ls_right", True)
    await h.scan()
    assert read_signal(h.runtime, "y_ry_rev.OUT") is True
    write_signal(h.runtime, "x_ls_right", False)
    await h.scan()

    write_signal(h.runtime, "x_ls_left", True)
    await h.scan()
    assert read_signal(h.runtime, "y_ry_fwd.OUT") is False
    assert read_signal(h.runtime, "y_ry_rev.OUT") is False


async def test_kentei_machine_pb2_stops_and_resets_screw_count():
    """PB2 resets every lane latch (lat_sens1..4) via or_reset_lanes, which
    zeroes the ADD sum written to var.screw_count -- same "stop always
    resets" contract the old single-sensor CTU had, now expressed as a
    latch-per-lane + ADD instead of a counter."""
    h = KenteiHarness()
    await h.scan()
    write_signal(h.runtime, "x_pb1", True)
    await h.scan()
    write_signal(h.runtime, "x_pb1", False)
    await h.scan()

    write_signal(h.runtime, "x_sens1", True)
    write_signal(h.runtime, "x_sens3", True)
    await h.scan()
    write_signal(h.runtime, "x_sens1", False)
    write_signal(h.runtime, "x_sens3", False)
    await h.scan()
    assert read_signal(h.runtime, "var.screw_count") == 2

    write_signal(h.runtime, "x_pb2", True)
    await h.scan()
    assert read_signal(h.runtime, "y_ry_fwd.OUT") is False
    assert read_signal(h.runtime, "var.screw_count") == 0
    write_signal(h.runtime, "x_pb2", False)
    await h.scan()


async def test_kentei_machine_lane_latches_hold_after_sensor_clears():
    """Each lane's SR latch (see docs/SIMULATION.md "レーン") must hold its
    detection even after the transient sensor signal clears (a jig's screw
    sweeps past the sensor in one tick, not stay parked on it) -- same
    "level, not edge, but latched" shape the old CTU's rising-edge counting
    used to guarantee no double counting, now guaranteeing no *loss* of a
    momentary detection."""
    h = KenteiHarness()
    await h.scan()
    write_signal(h.runtime, "x_sens2", True)
    await h.scan(3)  # held high across multiple scans -- still just +1, not +3
    assert read_signal(h.runtime, "var.screw_count") == 1
    write_signal(h.runtime, "x_sens2", False)
    await h.scan()
    assert read_signal(h.runtime, "var.screw_count") == 1  # latch holds after sensor clears

    write_signal(h.runtime, "x_sens4", True)
    await h.scan()
    assert read_signal(h.runtime, "var.screw_count") == 2  # second lane adds on top
    write_signal(h.runtime, "x_sens4", False)
    await h.scan()
    assert read_signal(h.runtime, "var.screw_count") == 2


async def test_kentei_machine_pb1_resets_lane_latches_before_new_run():
    """PB1 (start) must clear any lane latches left over from a previous
    pass (or_reset_lanes = PB1 OR PB2) so a fresh run starts from a known
    screw_count, matching _reset_devices_to_default's "known origin state"
    contract for the exam runner."""
    h = KenteiHarness()
    await h.scan()
    write_signal(h.runtime, "x_sens1", True)
    await h.scan()
    write_signal(h.runtime, "x_sens1", False)
    await h.scan()
    assert read_signal(h.runtime, "var.screw_count") == 1

    write_signal(h.runtime, "x_pb1", True)
    await h.scan()
    assert read_signal(h.runtime, "var.screw_count") == 0
    write_signal(h.runtime, "x_pb1", False)
    await h.scan()


async def test_kentei_machine_forward_reverse_interlock_never_both_true():
    """Stress case: pb1 and ls_right asserted in the very same scan (both SR
    latches' S inputs fire simultaneously). The output-stage AND+NOT
    interlock must still guarantee the two relay coils are never both
    energized, regardless of what the two SR latches individually do."""
    h = KenteiHarness()
    await h.scan()
    write_signal(h.runtime, "x_pb1", True)
    write_signal(h.runtime, "x_ls_right", True)
    await h.scan(5)
    fwd = read_signal(h.runtime, "y_ry_fwd.OUT")
    rev = read_signal(h.runtime, "y_ry_rev.OUT")
    assert not (fwd and rev), f"interlock violated: fwd={fwd} rev={rev}"


# ── kentei_plc.json: bundled rig sanity + headless full exam pass ──────────

def test_bundled_kentei_plc_rig_exists_and_loads():
    names = sorted(p.stem for p in SIM_RIGS_DIR.glob("*.json"))
    assert "kentei_plc" in names
    rig = _bundled_kentei_plc()
    assert rig["target_program"] == "kentei_machine"
    assert rig["exam"]["steps"]
    device_types = {d["type"] for d in rig["devices"]}
    assert {"relay", "conveyor", "jig", "position_sensor", "pushbutton", "switch",
            "lamp", "digit_switch", "indicator_number"} <= device_types
    relays = [d for d in rig["devices"] if d["type"] == "relay"]
    assert len(relays) == 2
    jig = next(d for d in rig["devices"] if d["type"] == "jig")
    assert len(jig["features"]) == 4
    # Lane extension (see docs/SIMULATION.md "レーン"): jig features carry an
    # explicit widthwise lane 0..3, and there are 4 feature-detecting
    # position_sensors (one per lane) all mounted at the same at_mm.
    lanes = sorted(f.get("lane") for f in jig["features"])
    assert lanes == [0, 1, 2, 3]
    feature_sensors = [
        d for d in rig["devices"]
        if d["type"] == "position_sensor" and d.get("detect", "feature") == "feature"
    ]
    assert len(feature_sensors) == 4
    assert sorted(s.get("lane") for s in feature_sensors) == [0, 1, 2, 3]
    at_mms = {s["at_mm"] for s in feature_sensors}
    assert at_mms == {450}, "all 4 lane sensors must sit at the same along-belt position"


def test_bundled_kentei_machine_example_exists_and_loads():
    assert (EXAMPLES_DIR / "kentei_machine.json").exists()
    program = _kentei_machine_program()
    node_ids = {n.id for n in program.nodes}
    assert {"x_pb1", "x_pb2", "x_ls_left", "x_ls_right",
            "x_sens1", "x_sens2", "x_sens3", "x_sens4",
            "lat_sens1", "lat_sens2", "lat_sens3", "lat_sens4",
            "add_screw_count", "y_ry_fwd", "y_ry_rev", "pl1", "pl2"} <= node_ids
    add_node = next(n for n in program.nodes if n.id == "add_screw_count")
    assert add_node.type == "ADD"
    assert any(v.id == "screw_count" for v in program.variables)


async def test_kentei_plc_bundled_rig_passes_headless():
    h = KenteiHarness()
    await h.scan()  # prime, mirrors scenario runner / server startup

    rig = _bundled_kentei_plc()
    mgr = SimulationManager(h.runtime)
    mgr.active_rig = rig
    mgr.active_rig_name = "kentei_plc"
    mgr._feedback_engine = FeedbackRuleEngine(h.runtime, h.clock, rig.get("feedback_rules") or [])
    mgr._physics_engine = PhysicsEngine(h.runtime, h.clock, rig["devices"])
    mgr._reset_devices_to_default()

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

    runner = ExamRunner(h.runtime, h.clock, rig["exam"], sleep_fn=_sleep, physics=mgr._physics_engine)
    result = await runner.run()
    assert result["state"] == "passed", json.dumps(result, ensure_ascii=False, indent=2)
    assert all(s["status"] == "pass" for s in result["steps"])


async def test_kentei_plc_bundled_rig_via_simulation_manager_activate(tmp_path, monkeypatch):
    """Same pass-criteria as above, but exercised through the public
    SimulationManager.activate()/start_exam() path (closer to how the live
    server drives it), with kentei_machine.json actually loaded as the
    runtime's active program (mirrors the curl verification steps)."""
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    rig = _bundled_kentei_plc()
    simulation.save_rig("kentei_plc", rig)

    h = KenteiHarness()
    await h.scan()
    mgr = SimulationManager(h.runtime)
    mgr.activate("kentei_plc")

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


# ── HTTP-level route tests (TestClient): jig feature attach/detach API ──────

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path / "sim_rigs")
    from main import app

    runtime.load_program(_kentei_machine_program())
    simulation.simulation_manager.deactivate()
    with TestClient(app) as c:
        yield c
    simulation.simulation_manager.deactivate()


def test_api_set_feature_attached(client):
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    client.post("/api/sim/rigs/kentei_plc/activate")

    resp = client.post("/api/sim/jigs/jig1/features/screw2", json={"attached": True})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "jig": "jig1", "feature": "screw2", "attached": True}

    state = client.get("/api/sim/state").json()
    assert state["jigs"]["jig1"]["features"]["screw2"]["attached"] is True


def test_api_set_feature_attached_unknown_jig_404(client):
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    client.post("/api/sim/rigs/kentei_plc/activate")

    resp = client.post("/api/sim/jigs/nope/features/screw1", json={"attached": False})
    assert resp.status_code == 404


def test_api_set_feature_attached_unknown_feature_404(client):
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    client.post("/api/sim/rigs/kentei_plc/activate")

    resp = client.post("/api/sim/jigs/jig1/features/does_not_exist", json={"attached": False})
    assert resp.status_code == 404


def test_api_set_feature_attached_without_active_rig_404(client):
    resp = client.post("/api/sim/jigs/jig1/features/screw1", json={"attached": False})
    assert resp.status_code == 404


def test_api_sim_state_includes_relays_key(client):
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    client.post("/api/sim/rigs/kentei_plc/activate")

    state = client.get("/api/sim/state").json()
    assert "ry_fwd" in state["relays"]
    assert "ry_rev" in state["relays"]
    assert state["relays"]["ry_fwd"] is False
    assert state["relays"]["ry_rev"] is False


def test_api_program_example_kentei_machine_loads(client):
    resp = client.post("/api/program/examples/kentei_machine/load")
    assert resp.status_code == 200


# ── Exam-start preflight (BUG-009, docs/QA_LOG.md) ──────────────────────────
# Reproduces the actual bug report: a user activates kentei_plc (whose
# target_program is "kentei_machine") while start_stop is still the loaded
# program, and starts the exam anyway. Its steps reference signals
# (y_ry_fwd.OUT, ry_fwd_contact, x_ls_left, ...) that simply don't exist in
# start_stop.json, so step (9) used to time out with a confusing
# "timeout: expected True, got None" many steps into the run. The preflight
# check must catch this BEFORE any step runs, with a 409 carrying enough
# information (which signals, what target_program, what's actually loaded)
# for the frontend to offer "load kentei_machine and retry".

def test_api_exam_start_rejects_with_409_when_program_mismatched(client):
    # `client` fixture already loads kentei_machine.json -- explicitly swap
    # back to start_stop to reproduce the bug's starting condition.
    client.post("/api/program/examples/start_stop/load")
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    client.post("/api/sim/rigs/kentei_plc/activate")

    resp = client.post("/api/sim/exam/start")
    assert resp.status_code == 409
    body = resp.json()["detail"]
    assert body["error"] == "unresolved_signals"
    assert "y_ry_fwd.OUT" in body["signals"]
    assert body["target_program"] == "kentei_machine"
    assert body["current_program"] == "start_stop"
    assert "hint" in body

    # No exam should actually have started.
    status = client.get("/api/sim/exam/status").json()
    assert status["state"] == "idle"


def test_api_exam_start_succeeds_once_target_program_is_loaded(client):
    """The other half of the same regression: once kentei_machine (the rig's
    own target_program) is loaded, the same rig/exam starts normally (no
    409) -- the preflight check must not false-positive on the CORRECT
    program, including the relay contact_signal exception (BUG-009 doesn't
    just mean "reject mismatches", it means "don't block matches either")."""
    # `client` fixture loads kentei_machine.json already; be explicit anyway.
    client.post("/api/program/examples/kentei_machine/load")
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    client.post("/api/sim/rigs/kentei_plc/activate")

    resp = client.post("/api/sim/exam/start")
    assert resp.status_code == 200
    assert resp.json()["state"] == "running"
    client.post("/api/sim/exam/abort")


def test_api_exam_start_force_bypasses_preflight(client):
    """`{"force": true}` is the escape hatch: start anyway despite unresolved
    signals (the pre-BUG-009 behavior), for an operator who knows what
    they're doing."""
    client.post("/api/program/examples/start_stop/load")
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    client.post("/api/sim/rigs/kentei_plc/activate")

    resp = client.post("/api/sim/exam/start", json={"force": True})
    assert resp.status_code == 200
    assert resp.json()["state"] == "running"
    client.post("/api/sim/exam/abort")


async def test_preflight_exam_empty_when_kentei_machine_loaded(tmp_path, monkeypatch):
    """Engine-level check (no HTTP): `SimulationManager.preflight_exam()`
    returns no unresolved signals at all against the rig's own
    target_program -- including its relay contact_signal virtual wires
    (ry_fwd_contact/ry_rev_contact), which aren't real kentei_machine.json
    nodes but must still count as resolved while the rig is active."""
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    rig = _bundled_kentei_plc()
    simulation.save_rig("kentei_plc", rig)

    h = KenteiHarness()
    mgr = SimulationManager(h.runtime)
    mgr.activate("kentei_plc")

    unresolved = mgr.preflight_exam()
    assert unresolved == []


async def test_preflight_exam_reports_missing_signals_against_wrong_program(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation, "SIM_RIGS_DIR", tmp_path)
    rig = _bundled_kentei_plc()
    simulation.save_rig("kentei_plc", rig)

    h = SimHarness()  # loads start_stop.json, NOT kentei_machine
    mgr = SimulationManager(h.runtime)
    mgr.activate("kentei_plc")

    unresolved = mgr.preflight_exam()
    # y_ry_fwd.OUT/ry_fwd_contact/ry_rev_contact are the actual bug-report
    # signals: y_ry_fwd.OUT is a real PLC output node in kentei_machine.json
    # (the relay coil signal) that simply doesn't exist in start_stop.json.
    # ry_fwd_contact/ry_rev_contact are rig-provided (relay contact_signal)
    # so they're EXCLUDED here even against the wrong program (see
    # rig_provided_signals) -- x_ls_left/x_sens1 etc. are position_sensor
    # signals, likewise rig-provided and excluded regardless of program.
    assert "y_ry_fwd.OUT" in unresolved  # step (9): the actual bug-report signal
    assert "var.screw_count" in unresolved  # start_stop.json declares no variables at all
    assert "x_ls_left" not in unresolved  # position_sensor signal: rig-provided
    assert "ry_fwd_contact" not in unresolved  # relay contact_signal: rig-provided


def test_relay_contact_signal_reported_as_resolved_kind_rig_when_active(client):
    """GET /api/sim/rigs/{name}/bindings: while kentei_plc is the ACTIVE rig,
    its relays' contact_signal fields (ry_fwd_contact/ry_rev_contact) must
    report resolved=True, kind="rig" instead of the misleading red "!"
    marker they got before this fix (BUG-009) -- they're the rig's own
    virtual wires, not dangling references. PL3/PL4's genuinely-unwired
    demo signals must still show up as unresolved."""
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    client.post("/api/sim/rigs/kentei_plc/activate")

    resp = client.get("/api/sim/rigs/kentei_plc/bindings")
    assert resp.status_code == 200
    bindings = resp.json()["bindings"]
    by_device_field = {(b["device_id"], b["field"]): b for b in bindings}

    fwd_contact = by_device_field[("ry_fwd", "contact_signal")]
    assert fwd_contact["resolved"] is True
    assert fwd_contact["kind"] == "rig"
    rev_contact = by_device_field[("ry_rev", "contact_signal")]
    assert rev_contact["resolved"] is True
    assert rev_contact["kind"] == "rig"

    # Intentionally-unwired demo lamps must remain unresolved (not a
    # regression of the existing documented behavior).
    pl3 = by_device_field[("pl3", "signal")]
    assert pl3["resolved"] is False
    assert pl3["kind"] == "none"


def test_relay_contact_signal_still_unresolved_when_rig_not_active(client):
    """Same bindings endpoint, but kentei_plc is only inspected (never
    activated) -- the contact_signal exception only applies while a rig is
    the one actually driving `PhysicsEngine._evaluate_relays`, so it must
    still show unresolved here (no active_rig context to except it)."""
    rig = _bundled_kentei_plc()
    client.put("/api/sim/rigs/kentei_plc", json=rig)
    # deliberately not activated

    resp = client.get("/api/sim/rigs/kentei_plc/bindings")
    bindings = resp.json()["bindings"]
    by_device_field = {(b["device_id"], b["field"]): b for b in bindings}
    fwd_contact = by_device_field[("ry_fwd", "contact_signal")]
    assert fwd_contact["resolved"] is False
    assert fwd_contact["kind"] == "none"
