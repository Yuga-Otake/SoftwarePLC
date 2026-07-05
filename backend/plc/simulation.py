"""Simulation rigs (mock-device panels) + the sequencer exam runner.

See docs/SIMULATION.md for the full JSON format and the "how to author your
own exam machine" walkthrough. This module intentionally has NO knowledge of
any *specific* machine (motor/lamp/etc.) -- it only knows how to:

  1. Read/write a "signal path" against the live `PLCRuntime` (the same
     "node_id.port" / bare-input / "var.<id>" convention used everywhere else
     in this codebase -- see `runtime.list_signals()`).
  2. Run `feedback_rules` (a tiny generic plant-simulation hook: watch a
     signal, and after a delay, force-write another signal -- optionally
     reverting when the watched condition clears).
  3. Run `exam.steps` (set/expect, same vocabulary as
     `scripts/scenario_runner.py`, plus `within_ms`/`after_ms` since this
     runs live against real time instead of a scripted virtual-clock replay).

The actual "motor start/stop exam machine" is pure data (see
`backend/sim_rigs/motor_exam.json`) -- this file supplies the generic engine
that data is interpreted by. A user can drop in another rig JSON (different
devices + different exam steps) and get a different exam machine for free.

Both the feedback-rule engine and the exam runner are driven by an injected
`Clock` + an injected async `sleep` function, exactly like the rest of the
engine (see plc/clock.py) -- so pytest can exercise them with a
`VirtualClock` and a no-real-sleep stub, while the live server uses
`RealClock` + `asyncio.sleep`.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from .clock import Clock
from .runtime import PLCRuntime, runtime as _default_runtime

SIM_RIGS_DIR = Path(__file__).resolve().parent.parent / "sim_rigs"

_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+$")

DEVICE_TYPES = (
    "pushbutton", "switch", "lamp", "motor", "indicator_number",
    # Physical-motion devices (see PhysicsEngine below): conveyor drives
    # jig(s) riding on it; position_sensor detects a jig/feature crossing a
    # fixed point on a conveyor.
    "conveyor", "jig", "position_sensor",
    # KENTEI-PLC-style panel devices (see docs/SIMULATION.md "リレー/デジタル
    # スイッチ/ネジ着脱"): relay mirrors a coil signal onto a contact signal
    # (models "PLC output -> relay coil -> contact -> motor" real wiring);
    # digit_switch is an operator-facing up/down numeric input (a DSW-style
    # thumbwheel switch), purely frontend-driven (no engine tick needed).
    "relay", "digit_switch",
)


# ── Signal path resolution (shared read/write helper) ───────────────────────
# Mirrors the conventions used by scripts/scenario_runner.py and
# PLCRuntime.list_signals(): a signal is either
#   - "var.<id>"          -> internal variable
#   - "node_id.port"       -> a node's output port (read-only from here)
#   - bare "node_id"        -> a DigitalInput node's forced value (settable),
#                              defaulting to ".OUT" for reads
# Devices (pushbutton/switch) write to DigitalInput-backed signals; lamps,
# motors, indicators read from output ports or variables.

def _is_digital_input(runtime: PLCRuntime, node_id: str) -> bool:
    return any(n.id == node_id and n.type == "DigitalInput" for n in runtime.get_program().nodes)


def read_signal(runtime: PLCRuntime, path: str) -> Any:
    if path.startswith("var."):
        return runtime.get_variable_value(path[len("var."):])
    node_id, _, port = path.partition(".")
    port = port or "OUT"
    if port == "OUT" and _is_digital_input(runtime, node_id):
        # Read the forced I/O value directly rather than waiting for the
        # next completed scan to fold it into `_current_outputs` -- same
        # race fix as BUG-006 (docs/QA_LOG.md), applied here so a `set`
        # immediately followed by an `expect` on the same input doesn't spuriously
        # see the pre-write value.
        return runtime.get_io().get(node_id, False)
    outputs = runtime.get_current_state().get(node_id)
    if outputs is not None:
        return outputs.get(port)
    # Not a real graph node at all (e.g. a rig's feedback-only "virtual"
    # input, such as a proximity-sensor feedback signal that the demo
    # program doesn't declare a DigitalInput node for) -- fall back to the
    # forced I/O store directly so it can still be displayed/waited on.
    io_values = runtime.get_io()
    if node_id in io_values:
        return io_values[node_id]
    return None


def write_signal(runtime: PLCRuntime, path: str, value: Any) -> None:
    if path.startswith("var."):
        runtime.force_variable_value(path[len("var."):], value)
        return
    node_id = path.split(".", 1)[0]
    runtime.set_io(node_id, bool(value))


# ── Signal resolution (rig <-> logic-design binding, see docs/SIMULATION.md
# "リグバインド編集") ───────────────────────────────────────────────────────
# Unlike read_signal (which tolerates an unknown node -- falling back to the
# forced I/O store, since a rig's feedback-only "virtual" signal is allowed
# to not correspond to any real graph node), this answers a different
# question for the binding-editor UI: "does this signal path actually
# resolve against the CURRENT program", so an operator editing a rig's
# device bindings can see which references are dangling (e.g. kentei_plc's
# intentionally-unwired PL3/PL4 demo lamps) and fix them without hand-editing
# JSON.

def rig_provided_signals(rig: dict | None) -> set[str]:
    """Signal paths that the rig ITSELF provides/drives -- not necessarily
    real program nodes, but still perfectly legitimate "resolved" references
    while the rig is active, mirroring `read_signal`'s own permissive
    I/O-store fallback (see the "信号パス規約" section of docs/SIMULATION.md:
    "`feedback_rules`の`set_input`は実プログラムのノードである必要はありません").
    Covers:

      - `relay.contact_signal` (see docs/SIMULATION.md "リレー"):
        `PhysicsEngine._evaluate_relays` force-writes this every scan once
        the rig is active, mirroring "PLC output -> relay coil -> contact"
        real wiring -- a rig-internal virtual signal by design.
      - `feedback_rules[].set_input`: the plant-simulation hook's output
        (e.g. `motor_exam.json`'s `x_motor_fb` rotation-sensor feedback) is
        deliberately allowed to be a signal name the target program doesn't
        declare a node for.
      - `position_sensor.signal`: `PhysicsEngine._evaluate_sensors`
        force-writes this every scan (e.g. `conveyor_exam.json`'s
        `x_screw_det`) -- same "rig-driven virtual input" reasoning.

    Used by both the bindings-editor endpoint (`rig_bindings`, so a relay's
    contact doesn't show a false-alarm red marker) and the exam-start
    preflight check (`SimulationManager.preflight_exam`, BUG-009 in
    docs/QA_LOG.md, so motor_exam/conveyor_exam's own virtual feedback
    signals don't 409 even when their correct target_program IS loaded).
    Returns an empty set for `rig=None` (no active rig)."""
    if not rig:
        return set()
    provided: set[str] = set()
    for device in rig.get("devices") or []:
        if not isinstance(device, dict):
            continue
        if device.get("type") == "relay":
            contact = device.get("contact_signal")
            if contact:
                provided.add(contact)
        if device.get("type") == "position_sensor":
            signal = device.get("signal")
            if signal:
                provided.add(signal)
    for rule in rig.get("feedback_rules") or []:
        if not isinstance(rule, dict):
            continue
        set_input = rule.get("set_input")
        if set_input:
            provided.add(set_input)
    return provided


def resolve_signal_kind(
    runtime: PLCRuntime, path: str, active_rig: dict | None = None
) -> tuple[bool, str]:
    """Returns (resolved, kind) for one signal path against the current
    program. `kind` is one of "var" | "input" | "output" | "rig" | "none"
    (the last meaning the path doesn't resolve to anything at all -- NOT the
    same as `read_signal`'s permissive I/O-store fallback).

    `active_rig` (optional): when given, a signal that doesn't resolve
    against the program but IS one of the (currently active) rig's own
    provided signals (see `rig_provided_signals`, e.g. a relay's
    `contact_signal`) is reported as resolved with kind "rig" instead of
    unresolved -- it's a rig-internal virtual wire, not a dangling reference
    (see docs/SIMULATION.md "リレー" / BUG-009 in docs/QA_LOG.md). Omitted
    (default None) preserves the original strict-against-program behavior,
    used e.g. when inspecting a rig that ISN'T the currently active one."""
    if not path:
        return False, "none"
    if path.startswith("var."):
        var_id = path[len("var."):]
        return (var_id in runtime._variables), "var"
    node_id, _, port = path.partition(".")
    node = next((n for n in runtime.get_program().nodes if n.id == node_id), None)
    if node is None:
        if path in rig_provided_signals(active_rig):
            return True, "rig"
        return False, "none"
    if node.type == "DigitalInput":
        return True, "input"
    return True, "output"


# Rig device fields that may carry a signal path referencing a program node
# or internal variable -- same set cascade-renamed by plc/rename.py, plus the
# feedback-rule fields, kept alongside for the bindings-editor endpoint's use
# (see api/sim_routes.py::get_rig_bindings).
DEVICE_SIGNAL_FIELDS = ("signal", "drive_signal", "reverse_signal", "coil_signal", "contact_signal")


def rig_bindings(runtime: PLCRuntime, rig: dict, active_rig: dict | None = None) -> list[dict]:
    """Every signal-path field declared by one rig's devices, with its
    resolution status against the CURRENT program -- backs
    `GET /api/sim/rigs/{name}/bindings` (see docs/SIMULATION.md "リグバインド
    編集"). One entry per (device, field) pair that actually has a non-empty
    value; `reverse_signal: null` (the common "no reverse wiring" case, see
    conveyor_exam.json) is skipped rather than reported as unresolved.

    `active_rig`: pass the currently-ACTIVE rig dict (SimulationManager
    .active_rig) when `rig` is (by name) the currently-active one, so a
    relay's `contact_signal` reports resolved/"rig" instead of a false-alarm
    red marker (the rig itself drives that signal once active -- see
    docs/SIMULATION.md "リレー", BUG-009 in docs/QA_LOG.md). The caller is
    responsible for only passing this when `rig` actually IS the active rig
    (by name -- `rig`/`active_rig` are typically two separately-loaded dict
    instances of the same on-disk JSON, not the same object, so this can't be
    an identity check). Pass None (default) to preserve the original strict
    behavior, e.g. when inspecting a rig that ISN'T currently active."""
    entries: list[dict] = []
    for device in rig.get("devices") or []:
        if not isinstance(device, dict):
            continue
        device_id = device.get("id", "")
        for field in DEVICE_SIGNAL_FIELDS:
            value = device.get(field)
            if not value:
                continue
            resolved, kind = resolve_signal_kind(runtime, value, active_rig=active_rig)
            entries.append({
                "device_id": device_id,
                "device_type": device.get("type", ""),
                "field": field,
                "signal": value,
                "resolved": resolved,
                "kind": kind,
            })
    return entries


# ── Rig definitions (persisted JSON, backend/sim_rigs/*.json) ──────────────
# Kept as plain dicts (not pydantic models) throughout this module, same
# light-touch treatment HMI screens get in api/routes.py -- the schema is
# documented (docs/SIMULATION.md) and validated at the API boundary, not
# forced through a rigid model that would make ad-hoc device fields awkward.

def _rig_path(name: str) -> Path:
    if not _SAFE_NAME_RE.match(name):
        raise ValueError("Invalid rig name")
    SIM_RIGS_DIR.mkdir(parents=True, exist_ok=True)
    return SIM_RIGS_DIR / f"{name}.json"


def list_rigs() -> list[str]:
    if not SIM_RIGS_DIR.exists():
        return []
    return sorted(p.stem for p in SIM_RIGS_DIR.glob("*.json"))


def load_rig(name: str) -> dict | None:
    path = _rig_path(name)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_rig(name: str, rig: dict) -> None:
    devices = rig.get("devices")
    if devices is not None and not isinstance(devices, list):
        raise ValueError("rig.devices must be a list")
    feedback_rules = rig.get("feedback_rules")
    if feedback_rules is not None and not isinstance(feedback_rules, list):
        raise ValueError("rig.feedback_rules must be a list")
    exam = rig.get("exam")
    if exam is not None and not isinstance(exam, dict):
        raise ValueError("rig.exam must be an object")
    if exam is not None:
        steps = exam.get("steps")
        if steps is not None and not isinstance(steps, list):
            raise ValueError("rig.exam.steps must be a list")
    path = _rig_path(name)
    path.write_text(json.dumps(rig, indent=2, ensure_ascii=False), encoding="utf-8")


def delete_rig(name: str) -> None:
    path = _rig_path(name)
    if path.exists():
        path.unlink()


# ── Feedback rules (simple plant simulation) ────────────────────────────────
# {"watch": "y_motor.OUT", "equals": true, "delay_ms": 500,
#  "set_input": "x_motor_fb", "value": true, "revert_on_clear": true}
#
# Evaluated on a hook the caller runs periodically (the live server runs it
# right after every `control`-task scan; tests can drive it by hand with a
# VirtualClock -- see FeedbackRuleEngine.tick()). Fully level-based (no edge
# state beyond "when did the condition first become true"), so re-entrant
# ticks are idempotent.

@dataclass
class _RuleState:
    condition_since_ms: float | None = None
    applied: bool = False


class FeedbackRuleEngine:
    """Evaluates one rig's `feedback_rules` against a live runtime + clock.

    `attach()`/`detach()` are how activation/deactivation wires this into
    `PLCRuntime` (see `SimulationManager` below) -- the engine itself has no
    knowledge of *how* it gets ticked, only that `tick()` is called with the
    current time.
    """

    def __init__(self, runtime: PLCRuntime, clock: Clock, rules: list[dict]):
        self.runtime = runtime
        self.clock = clock
        self.rules = rules
        self._state: dict[int, _RuleState] = {i: _RuleState() for i in range(len(rules))}

    def tick(self) -> None:
        now_ms = self.clock.now_ms()
        for idx, rule in enumerate(self.rules):
            st = self._state[idx]
            watch = rule.get("watch")
            if not watch:
                continue
            equals = rule.get("equals", True)
            actual = read_signal(self.runtime, watch)
            condition_met = actual == equals

            if condition_met:
                if st.condition_since_ms is None:
                    st.condition_since_ms = now_ms
                delay_ms = float(rule.get("delay_ms", 0))
                if not st.applied and (now_ms - st.condition_since_ms) >= delay_ms:
                    write_signal(self.runtime, rule["set_input"], rule.get("value", True))
                    st.applied = True
            else:
                st.condition_since_ms = None
                if st.applied and rule.get("revert_on_clear", False):
                    default = rule.get("revert_value", not rule.get("value", True))
                    write_signal(self.runtime, rule["set_input"], default)
                st.applied = False

    def reset(self) -> None:
        self._state = {i: _RuleState() for i in range(len(self.rules))}


# ── Physics engine (conveyor + jig + position_sensor devices) ──────────────
# Generic "1-D position integration + window detection" engine, driven by
# a rig's `devices[]` entries of type "conveyor" / "jig" / "position_sensor"
# (see docs/SIMULATION.md). Deliberately knows nothing about screws, motors,
# or any specific machine -- it only understands:
#
#   conveyor:  reads `drive_signal` (and optional `reverse_signal`) every
#              tick and advances however many jigs ride on it by
#              `speed_mm_s * dt_s`, clamped/wrapped at [0, length_mm].
#   jig:       a position (mm, head-referenced) on one conveyor, carrying
#              zero or more `features` (offsets from the jig's head) that a
#              position_sensor can detect.
#   position_sensor: writes `signal` True while a jig (or one of its
#              features) overlaps `at_mm +/- window_mm/2`, False otherwise.
#
# Ticked once per control-scan from the same post_scan_hook as
# FeedbackRuleEngine (see SimulationManager.tick below), using the runtime's
# Clock so a VirtualClock can drive it deterministically in tests -- no real
# `time.sleep`/`asyncio.sleep` anywhere in this class.

def _device_map(devices: list[dict], dtype: str) -> dict[str, dict]:
    return {d["id"]: d for d in devices if d.get("type") == dtype and d.get("id")}


class PhysicsEngine:
    """Evaluates one rig's conveyor/jig/position_sensor devices against a
    live runtime + clock. Mirrors FeedbackRuleEngine's shape (attach via
    construction, drive via `tick()`, no knowledge of *how* it's scheduled).

    Also drives `relay` devices (see docs/SIMULATION.md "リレー"): unlike
    conveyor/jig/position_sensor this isn't a position-integration concern,
    but a relay's contact state still needs re-evaluating every scan (a coil
    signal can change every scan just like a conveyor's drive_signal), so it
    rides the same tick() rather than getting its own engine + wiring point."""

    def __init__(self, runtime: PLCRuntime, clock: Clock, devices: list[dict]):
        self.runtime = runtime
        self.clock = clock
        self.conveyors = _device_map(devices, "conveyor")
        self.jigs = _device_map(devices, "jig")
        self.sensors = _device_map(devices, "position_sensor")
        self.relays = _device_map(devices, "relay")

        # jig_id -> current head position (mm), 0 == device's "home_mm"
        self.positions: dict[str, float] = {
            jid: float(j.get("home_mm", 0.0)) for jid, j in self.jigs.items()
        }
        # jig_id -> head position at the START of the tick that produced
        # `positions[jig_id]` -- needed so sensor detection can check the
        # whole *segment* swept during the tick (see _evaluate_sensors)
        # rather than only the end-of-tick sample point. Without this, a fast
        # jig / narrow window combination (e.g. 200mm/s at a 100ms scan
        # period = 20mm per tick, vs. a 12mm window) can step clean over a
        # sensor's window between two samples and never register a hit.
        self._prev_positions: dict[str, float] = dict(self.positions)
        # sensor_id -> currently-detecting bool, for edge-based UI feedback
        # (limit-switch "lever" animation) and to avoid redundant writes.
        self.sensor_active: dict[str, bool] = {sid: False for sid in self.sensors}
        # relay_id -> currently-energized bool (contact closed), for UI +
        # avoiding redundant writes (same shape as sensor_active).
        self.relay_energized: dict[str, bool] = {rid: False for rid in self.relays}
        self._last_ms: float | None = None

    # ── Position/state accessors (for GET /api/sim/state + tests) ──────
    def state(self) -> dict:
        return {
            "jigs": {
                jid: {
                    "position_mm": round(pos, 3),
                    # Per-feature attached/detached flags (screws that have
                    # been removed from a jig, see docs/SIMULATION.md "ネジ
                    # 着脱") so the frontend can render an empty hole for a
                    # detached screw without re-fetching the whole rig.
                    "features": {
                        f["id"]: {
                            "attached": bool(f.get("attached", True)),
                            # Lane (width-wise row, see docs/SIMULATION.md
                            # "レーン") echoed back so the frontend can group
                            # features into rows without re-fetching the
                            # static rig JSON -- defaults to 0 same as the
                            # engine's own lookup.
                            "lane": f.get("lane", 0),
                        }
                        for f in self.jigs[jid].get("features", [])
                        if f.get("id")
                    },
                }
                for jid, pos in self.positions.items()
            },
            "sensors": dict(self.sensor_active),
            "relays": dict(self.relay_energized),
        }

    def reset_jig(self, jig_id: str) -> bool:
        """Return one jig to its configured `home_mm`. Used by both
        `POST /api/sim/jigs/{id}/reset` and the exam-step op `reset_jig` so a
        certification run can be repeated without reactivating the whole
        rig (see docs/SIMULATION.md)."""
        jig = self.jigs.get(jig_id)
        if jig is None:
            return False
        home = float(jig.get("home_mm", 0.0))
        self.positions[jig_id] = home
        # Also reset the "previous position" used by the sweep-based sensor
        # check (see _evaluate_sensors) so the jig doesn't appear to have
        # instantaneously swept from its old position back to home on the
        # very next tick (which could spuriously re-trigger a sensor whose
        # window lies between the two points).
        self._prev_positions[jig_id] = home
        # Re-evaluate sensors immediately (rather than waiting for the next
        # tick()) so a caller reading state right after a reset -- e.g. the
        # exam op's very next `expect` step, or a `GET /api/sim/state`
        # issued between scans -- already sees any sensor that should now be
        # OFF (jig moved away from it) reflected, matching motor_exam's
        # existing "reset happens synchronously" convention.
        self._evaluate_sensors()
        return True

    def reset_all(self) -> None:
        for jid, jig in self.jigs.items():
            home = float(jig.get("home_mm", 0.0))
            self.positions[jid] = home
            self._prev_positions[jid] = home
        for sid in self.sensors:
            self.sensor_active[sid] = False
        for rid in self.relays:
            self.relay_energized[rid] = False
        self._last_ms = None

    def set_feature_attached(self, jig_id: str, feature_id: str, attached: bool) -> bool:
        """Attach/detach one screw (or other feature) on a jig -- see
        docs/SIMULATION.md "ネジ着脱". Backs both `POST
        /api/sim/jigs/{jig_id}/features/{feature_id}` and the exam-step op
        `set_feature`. A detached feature is skipped entirely by
        `_evaluate_sensors` (it can no longer be detected) and rendered as an
        empty hole by the frontend. Returns False if the jig or feature
        doesn't exist so callers can 404/fail cleanly."""
        jig = self.jigs.get(jig_id)
        if jig is None:
            return False
        for feat in jig.get("features", []):
            if feat.get("id") == feature_id:
                feat["attached"] = bool(attached)
                # Re-evaluate immediately (same "synchronous reset" reasoning
                # as reset_jig()) so a caller reading state/exam-expect right
                # after this call already sees the sensor react.
                self._evaluate_sensors()
                return True
        return False

    # ── Tick ─────────────────────────────────────────────────────────────
    def tick(self) -> None:
        now_ms = self.clock.now_ms()
        if self._last_ms is None:
            self._last_ms = now_ms
            dt_s = 0.0
        else:
            dt_s = max(0.0, now_ms - self._last_ms) / 1000.0
            self._last_ms = now_ms

        self._prev_positions = dict(self.positions)
        if dt_s > 0:
            for jig_id, jig in self.jigs.items():
                conveyor = self.conveyors.get(jig.get("conveyor"))
                if conveyor is None:
                    continue
                self._advance_jig(jig_id, jig, conveyor, dt_s)

        self._evaluate_sensors()
        self._evaluate_relays()

    def _advance_jig(self, jig_id: str, jig: dict, conveyor: dict, dt_s: float) -> None:
        drive_signal = conveyor.get("drive_signal")
        drive_on = bool(read_signal(self.runtime, drive_signal)) if drive_signal else False
        reverse_signal = conveyor.get("reverse_signal")
        reversed_ = bool(read_signal(self.runtime, reverse_signal)) if reverse_signal else False
        # `driving` is true if EITHER the forward drive_signal or the
        # reverse_signal is asserted -- this supports two independent
        # "directional" drive signals (e.g. two separate relay contacts, see
        # docs/SIMULATION.md "リレー"/kentei_plc.json: forward relay drives
        # drive_signal, reverse relay drives reverse_signal, and only one is
        # ever energized at a time thanks to the PLC program's interlock) as
        # well as the original "single drive_signal + direction flag"
        # convention (conveyor_exam.json: drive_signal alone means "moving",
        # reverse_signal only flips direction while driving is already true
        # -- still covered here since reverse_signal implies driving=True).
        driving = drive_on or reversed_
        if not driving:
            return

        speed = float(conveyor.get("speed_mm_s", 0.0))
        length_mm = float(conveyor.get("length_mm", 0.0))
        delta = speed * dt_s * (-1.0 if reversed_ else 1.0)

        pos = self.positions.get(jig_id, float(jig.get("home_mm", 0.0))) + delta
        at_end = jig.get("at_end", "stop")
        if length_mm > 0:
            if at_end == "wrap":
                pos = pos % length_mm
            else:  # "stop" (default): clamp to conveyor bounds
                pos = max(0.0, min(length_mm, pos))
        self.positions[jig_id] = pos

    def _evaluate_sensors(self) -> None:
        for sensor_id, sensor in self.sensors.items():
            conveyor_id = sensor.get("conveyor")
            at_mm = float(sensor.get("at_mm", 0.0))
            window_mm = float(sensor.get("window_mm", 10.0))
            detect_mode = sensor.get("detect", "feature")
            # Lane (width-wise position across the conveyor, see
            # docs/SIMULATION.md "レーン"): an integer lane index (0..N-1)
            # identifying which widthwise row of jig features this sensor
            # can see. Unspecified on either side defaults to lane 0 (same
            # convention as `features[].lane`), so every rig authored before
            # lanes existed (conveyor_exam.json, and kentei_plc.json's own
            # limit switches) keeps behaving exactly as before -- a single
            # implicit lane 0 that everything belongs to.
            sensor_lane = sensor.get("lane", 0)
            lo, hi = at_mm - window_mm / 2.0, at_mm + window_mm / 2.0

            detected = False
            for jig_id, jig in self.jigs.items():
                if jig.get("conveyor") != conveyor_id:
                    continue
                head_now = self.positions.get(jig_id, 0.0)
                head_prev = self._prev_positions.get(jig_id, head_now)
                size_mm = float(jig.get("size_mm", 0.0))
                if detect_mode == "jig":
                    # Whole jig body (head .. head+size_mm), swept from its
                    # previous tick's position to now, overlaps the window --
                    # covers a fast jig passing entirely through a narrow
                    # window between two ticks (see _prev_positions comment
                    # in __init__), not just its instantaneous end position.
                    # A "jig" detector (e.g. a limit switch) sees the jig body
                    # itself, not any particular lane of features, so lane is
                    # irrelevant here.
                    span_lo = min(head_prev, head_now)
                    span_hi = max(head_prev, head_now) + size_mm
                    if span_lo <= hi and span_hi >= lo:
                        detected = True
                        break
                else:  # "feature" (default): each feature's swept position range
                    for feat in jig.get("features", []):
                        # A detached screw (see docs/SIMULATION.md "ネジ着脱")
                        # is physically not there -- it must never register a
                        # detection, same as if the feature didn't exist.
                        if not feat.get("attached", True):
                            continue
                        # Lane must match -- a sensor only "sees" the single
                        # widthwise row of screw holes it's mounted opposite,
                        # exactly like the real KENTEI-PLC jig's row of
                        # detectors (see docs/SIMULATION.md "レーン").
                        if feat.get("lane", 0) != sensor_lane:
                            continue
                        offset = float(feat.get("offset_mm", 0.0))
                        feat_now = head_now + offset
                        feat_prev = head_prev + offset
                        span_lo, span_hi = min(feat_prev, feat_now), max(feat_prev, feat_now)
                        if span_lo <= hi and span_hi >= lo:
                            detected = True
                            break
                    if detected:
                        break

            was_active = self.sensor_active.get(sensor_id, False)
            if detected != was_active:
                self.sensor_active[sensor_id] = detected
                signal = sensor.get("signal")
                if signal:
                    write_signal(self.runtime, signal, detected)

    def _evaluate_relays(self) -> None:
        """Relay devices (see docs/SIMULATION.md "リレー"): while
        `coil_signal` reads truthy, force `contact_signal` True (energized,
        contact closed); otherwise force it False. No excitation delay (the
        spec calls this unnecessary for this PoC) -- purely a level mirror,
        written through the same `write_signal` convention as
        position_sensor so `contact_signal` can be anything a conveyor's
        `drive_signal`/`reverse_signal` (or any other signal path) accepts."""
        for relay_id, relay in self.relays.items():
            coil_signal = relay.get("coil_signal")
            energized = bool(read_signal(self.runtime, coil_signal)) if coil_signal else False
            was_energized = self.relay_energized.get(relay_id, False)
            if energized != was_energized:
                self.relay_energized[relay_id] = energized
                contact_signal = relay.get("contact_signal")
                if contact_signal:
                    write_signal(self.runtime, contact_signal, energized)


# ── Exam runner (live sequencer) ────────────────────────────────────────────
# exam.steps vocabulary mirrors scripts/scenario_runner.py:
#   {"op": "set", "signal": "x_start", "value": true, "note": "..."}
#   {"op": "expect", "signal": "y_motor.OUT", "value": true,
#    "within_ms": 300, "after_ms": 2700, "note": "..."}
# `within_ms` -- must become true within this many ms after the step starts
#                (measured from when this step began running), else FAIL.
# `after_ms`  -- must NOT already be satisfied before this many ms have
#                elapsed (an early pass is a FAIL: "too early").
# Both are optional; a bare expect with neither polls a few ticks and passes
# immediately if already true, fails if never true within a small default
# window.

DEFAULT_EXPECT_WINDOW_MS = 1000.0
POLL_INTERVAL_MS = 20.0


class UnresolvedSignalsError(Exception):
    """Raised by `SimulationManager.start_exam()` when the active rig's
    exam.steps reference one or more signals that don't resolve against the
    currently-loaded program (BUG-009, docs/QA_LOG.md) -- e.g. the rig's
    `target_program` ("kentei_machine") isn't the program that's actually
    loaded ("start_stop"). Carries everything `api/sim_routes.py` needs to
    build the 409 response body without re-deriving it. Raising a dedicated
    exception (rather than reusing plain `RuntimeError`, which the existing
    "no rig activated"/"already running" checks use for a 400) lets the API
    layer distinguish "can't start at all" (400) from "can start, but you
    probably don't want to yet" (409, with a `force: true` escape hatch)."""

    def __init__(
        self,
        signals: list[str],
        target_program: str | None,
        current_program_name: str | None,
        node_count: int,
    ):
        self.signals = signals
        self.target_program = target_program
        # Human-readable "what's loaded right now" -- falls back to node
        # count when the loaded program has no known name (e.g. a hand-built
        # or `PUT /api/program`-edited graph), per the task's
        # "<現在のプログラム名/ノード数>" spec.
        self.current_program = current_program_name or f"(不明なプログラム, {node_count}ノード)"
        super().__init__(
            f"Exam references unresolved signals against the current program: {signals!r}"
        )


def collect_exam_signals(exam: dict) -> list[str]:
    """Every signal path referenced by `exam.steps` (`set`/`expect`'s
    `signal` field -- `reset_jig`/`set_feature` reference jig/feature ids,
    not signal paths, so they're not included). Used by the exam-start
    preflight check (see `SimulationManager.preflight_exam`, BUG-009 in
    docs/QA_LOG.md) to verify every signal the certification procedure is
    about to touch actually resolves against the currently-loaded program
    BEFORE running it, instead of failing many steps in with a confusing
    "timeout: expected True, got None". Order-preserving, de-duplicated."""
    seen: list[str] = []
    seen_set: set[str] = set()
    for step in exam.get("steps") or []:
        if not isinstance(step, dict):
            continue
        signal = step.get("signal")
        if signal and signal not in seen_set:
            seen.append(signal)
            seen_set.add(signal)
    return seen


@dataclass
class StepResult:
    index: int
    op: str
    signal: str | None
    note: str
    status: str = "pending"  # pending | running | pass | fail
    actual: Any = None
    expected: Any = None
    elapsed_ms: float | None = None
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "op": self.op,
            "signal": self.signal,
            "note": self.note,
            "status": self.status,
            "actual": self.actual,
            "expected": self.expected,
            "elapsed_ms": self.elapsed_ms,
            "error": self.error,
        }


SleepFn = Callable[[float], Awaitable[None]]


async def _asyncio_sleep_ms(ms: float) -> None:
    await asyncio.sleep(max(0.0, ms) / 1000.0)


class ExamRunner:
    """Drives one rig's `exam.steps` against a live `PLCRuntime`, in real
    (or virtual, for tests) time, tracking per-step status for the frontend's
    exam panel / the headless test suite / curl polling.

    Usage:
        runner = ExamRunner(runtime, clock, rig["exam"], sleep_fn=asyncio_sleep_ms)
        asyncio.create_task(runner.run())
        ...
        runner.status()   # poll from the API
        runner.abort()
    """

    def __init__(
        self,
        runtime: PLCRuntime,
        clock: Clock,
        exam: dict,
        sleep_fn: SleepFn = _asyncio_sleep_ms,
        poll_interval_ms: float = POLL_INTERVAL_MS,
        physics: "PhysicsEngine | None" = None,
    ):
        self.runtime = runtime
        self.clock = clock
        self.exam = exam
        self.title = exam.get("title", "検定")
        self.sleep_fn = sleep_fn
        self.poll_interval_ms = poll_interval_ms
        self.physics = physics
        self.steps: list[StepResult] = [
            StepResult(
                index=i,
                op=step.get("op", ""),
                signal=step.get("signal"),
                note=step.get("note", ""),
                expected=step.get("value"),
            )
            for i, step in enumerate(exam.get("steps", []))
        ]
        self._raw_steps = exam.get("steps", [])
        self.state: str = "idle"  # idle | running | passed | failed | aborted
        self._abort_requested = False
        self._task: asyncio.Task | None = None

    def status(self) -> dict:
        return {
            "state": self.state,
            "title": self.title,
            "steps": [s.to_dict() for s in self.steps],
        }

    def abort(self) -> None:
        self._abort_requested = True
        if self.state == "running":
            self.state = "aborted"

    async def run(self) -> dict:
        self.state = "running"
        try:
            for step_result, raw in zip(self.steps, self._raw_steps):
                if self._abort_requested:
                    step_result.status = "pending"
                    self.state = "aborted"
                    return self.status()
                step_result.status = "running"
                ok = await self._run_step(step_result, raw)
                if self._abort_requested:
                    self.state = "aborted"
                    return self.status()
                if not ok:
                    step_result.status = "fail"
                    self.state = "failed"
                    return self.status()
                step_result.status = "pass"
            self.state = "passed"
        except Exception as exc:  # defensive: never let the background task die silently
            self.state = "failed"
            if self.steps:
                running = next((s for s in self.steps if s.status == "running"), self.steps[-1])
                running.status = "fail"
                running.error = str(exc)
        return self.status()

    async def _run_step(self, result: StepResult, raw: dict) -> bool:
        op = raw.get("op")
        if op == "set":
            write_signal(self.runtime, raw["signal"], raw.get("value"))
            result.actual = raw.get("value")
            result.elapsed_ms = 0.0
            return True

        if op == "expect":
            return await self._run_expect(result, raw)

        if op == "reset_jig":
            jig_id = raw.get("jig")
            ok = bool(self.physics and self.physics.reset_jig(jig_id))
            result.actual = ok
            result.elapsed_ms = 0.0
            if not ok:
                result.error = f"unknown jig: {jig_id}"
            return ok

        if op == "set_feature":
            jig_id = raw.get("jig")
            feature_id = raw.get("feature")
            attached = bool(raw.get("attached", True))
            ok = bool(self.physics and self.physics.set_feature_attached(jig_id, feature_id, attached))
            result.actual = attached if ok else None
            result.elapsed_ms = 0.0
            if not ok:
                result.error = f"unknown jig/feature: {jig_id}/{feature_id}"
            return ok

        result.error = f"unknown op: {op}"
        return False

    async def _run_expect(self, result: StepResult, raw: dict) -> bool:
        signal = raw["signal"]
        expected = raw.get("value")
        within_ms = float(raw.get("within_ms", DEFAULT_EXPECT_WINDOW_MS))
        after_ms = float(raw.get("after_ms", 0.0))

        start_ms = self.clock.now_ms()
        while True:
            if self._abort_requested:
                return False
            now_ms = self.clock.now_ms()
            elapsed = now_ms - start_ms
            actual = read_signal(self.runtime, signal)
            result.actual = actual

            if actual == expected:
                if elapsed < after_ms:
                    result.elapsed_ms = round(elapsed, 1)
                    result.error = (
                        f"too early: satisfied at {elapsed:.0f}ms, "
                        f"expected not before {after_ms:.0f}ms"
                    )
                    return False
                result.elapsed_ms = round(elapsed, 1)
                return True

            if elapsed >= within_ms:
                result.elapsed_ms = round(elapsed, 1)
                result.error = f"timeout: expected {expected!r}, got {actual!r} after {elapsed:.0f}ms"
                return False

            await self.sleep_fn(self.poll_interval_ms)


# ── Simulation manager: rig activation + exam lifecycle (server-side singleton) ──

class SimulationManager:
    """Owns "which rig is active" (feedback rules wired into the live
    runtime) and "is an exam currently running" state, for the `/api/sim/*`
    routes. One instance per `PLCRuntime` (mirrors how `runtime` itself is a
    module-level singleton in plc/runtime.py)."""

    def __init__(self, runtime: PLCRuntime):
        self.runtime = runtime
        self.active_rig_name: str | None = None
        self.active_rig: dict | None = None
        self._feedback_engine: FeedbackRuleEngine | None = None
        self._physics_engine: PhysicsEngine | None = None
        self._exam_runner: ExamRunner | None = None

    # ── Activation ──────────────────────────────────────────────────────
    def activate(self, name: str) -> dict:
        rig = load_rig(name)
        if rig is None:
            raise KeyError(name)
        self.active_rig_name = name
        self.active_rig = rig
        rules = rig.get("feedback_rules") or []
        devices = rig.get("devices") or []
        self._feedback_engine = FeedbackRuleEngine(self.runtime, self.runtime.clock, rules)
        self._physics_engine = PhysicsEngine(self.runtime, self.runtime.clock, devices)
        # (Re)activating clears any previous exam run's status -- see
        # deactivate() for why a stale result shouldn't linger.
        if self._exam_runner is not None:
            self._exam_runner.abort()
            self._exam_runner = None
        self._reset_devices_to_default()
        return rig

    def deactivate(self) -> None:
        self.active_rig_name = None
        self.active_rig = None
        self._feedback_engine = None
        self._physics_engine = None
        # An exam belongs to whichever rig was active when it started;
        # deactivating (or activating a *different* rig -- see `activate()`
        # above) invalidates any in-flight/finished run so a stale
        # pass/fail badge from a previous rig doesn't linger in the panel.
        if self._exam_runner is not None:
            self._exam_runner.abort()
            self._exam_runner = None

    def feedback_tick(self) -> None:
        """Called once per control-scan by the live server (see main.py's
        hook into the scheduler) -- no-op if no rig is active. Exposed
        directly for tests to call without a real scheduler. Drives both the
        feedback-rule engine (sensor/plant simulation) and the physics
        engine (conveyor/jig position integration + position_sensor
        detection) so both fire exactly once per scan, in that order (a
        feedback rule could in principle watch a position_sensor's output
        signal, so sensors are evaluated first)."""
        if self._physics_engine is not None:
            self._physics_engine.tick()
        if self._feedback_engine is not None:
            self._feedback_engine.tick()

    def sim_state(self) -> dict:
        """Dynamic simulation state (jig positions, sensor detection flags,
        relay energized flags) for `GET /api/sim/state` / the WS `sim_state`
        payload -- empty dicts if no rig is active or the active rig has no
        conveyor/jig/sensor/relay devices (backward compatible with
        motor_exam/lamp_practice, which have neither)."""
        if self._physics_engine is None:
            return {"jigs": {}, "sensors": {}, "relays": {}}
        return self._physics_engine.state()

    def reset_jig(self, jig_id: str) -> bool:
        """Return one jig to its home position. Backs both
        `POST /api/sim/jigs/{id}/reset` and the exam-step op `reset_jig`."""
        if self._physics_engine is None:
            return False
        return self._physics_engine.reset_jig(jig_id)

    def set_feature_attached(self, jig_id: str, feature_id: str, attached: bool) -> bool:
        """Attach/detach one jig feature (screw). Backs `POST
        /api/sim/jigs/{jig_id}/features/{feature_id}` and the exam-step op
        `set_feature`."""
        if self._physics_engine is None:
            return False
        return self._physics_engine.set_feature_attached(jig_id, feature_id, attached)

    def _reset_devices_to_default(self) -> None:
        """Return every device-backed input signal to a known-off state (and
        reset the feedback-rule engine's own delay/latch bookkeeping) before
        an exam run. Without this, a signal forced True by a *previous* run
        (a pushbutton left "pressed" from manual device interaction, or a
        feedback-rule output like a simulated sensor) would still read True
        at t=0 of the next run, which can make an `after_ms` "not too early"
        check spuriously fail (it looks like the condition was already
        satisfied before the exam even started). A real certification jig
        always starts from a known origin state for exactly this reason.

        Resets both operator-facing input devices (pushbutton/switch) *and*
        any feedback-rule `set_input` targets (e.g. a simulated sensor input
        that isn't a device the operator can see/press directly)."""
        if self.active_rig is None:
            return
        for device in self.active_rig.get("devices") or []:
            signal = device.get("signal")
            if signal and device.get("type") in ("pushbutton", "switch"):
                write_signal(self.runtime, signal, False)
        for rule in self.active_rig.get("feedback_rules") or []:
            set_input = rule.get("set_input")
            if set_input:
                write_signal(self.runtime, set_input, rule.get("revert_value", not rule.get("value", True)))
        if self._feedback_engine is not None:
            self._feedback_engine.reset()
        if self._physics_engine is not None:
            # Jigs return home and every sensor's output signal is force-
            # cleared -- same "known origin state" reasoning as the
            # pushbutton/feedback-rule resets above, applied to conveyor
            # position so a re-run doesn't inherit a jig sitting mid-belt (or
            # a sensor still latched True) from the previous run.
            self._physics_engine.reset_all()
            for sensor in self._physics_engine.sensors.values():
                signal = sensor.get("signal")
                if signal:
                    write_signal(self.runtime, signal, False)
            for relay in self._physics_engine.relays.values():
                contact_signal = relay.get("contact_signal")
                if contact_signal:
                    write_signal(self.runtime, contact_signal, False)
            # Relays reflect *current* coil state (driven by other devices'
            # `False` resets above), not necessarily "off" -- re-evaluate
            # immediately so e.g. a coil signal that's a plain DigitalInput
            # already at its program-default value shows the right contact
            # state right after activation, rather than waiting for the next
            # scan's post_scan_hook tick.
            self._physics_engine._evaluate_relays()

    # ── Exam preflight (BUG-009, docs/QA_LOG.md) ────────────────────────
    # A rig's exam.steps reference signal paths that only make sense against
    # its `target_program` (see docs/SIMULATION.md's rig JSON format). If the
    # operator activates the rig while a DIFFERENT program is still loaded
    # (e.g. kentei_plc activated on top of start_stop, instead of its
    # target_program "kentei_machine"), those signals silently don't resolve
    # -- `read_signal`'s permissive I/O-store fallback means `set` steps
    # "succeed" against nothing, and the first `expect` step against a
    # missing output just times out with a confusing "timeout: expected
    # True, got None" many steps in, instead of failing fast with a reason an
    # operator can act on.
    def preflight_exam(self) -> list[str]:
        """Returns the list of exam.steps signal paths (see
        `collect_exam_signals`) that do NOT resolve against the currently
        loaded program -- empty if every signal resolves (or there's no
        active rig/exam, which callers should check separately). Rig-
        provided virtual signals (relay `contact_signal`) are treated as
        resolved via `resolve_signal_kind(..., active_rig=self.active_rig)`,
        same exception as the bindings-editor endpoint (see
        docs/SIMULATION.md "リレー")."""
        if self.active_rig is None:
            return []
        exam = self.active_rig.get("exam")
        if not exam:
            return []
        unresolved = []
        for signal in collect_exam_signals(exam):
            resolved, _kind = resolve_signal_kind(self.runtime, signal, active_rig=self.active_rig)
            if not resolved:
                unresolved.append(signal)
        return unresolved

    # ── Exam lifecycle ──────────────────────────────────────────────────
    def start_exam(self, sleep_fn: SleepFn = _asyncio_sleep_ms, force: bool = False) -> ExamRunner:
        if self.active_rig is None:
            raise RuntimeError("No rig activated")
        exam = self.active_rig.get("exam")
        if not exam:
            raise RuntimeError("Active rig has no exam definition")
        if self._exam_runner is not None and self._exam_runner.state == "running":
            raise RuntimeError("An exam is already running")
        if not force:
            unresolved = self.preflight_exam()
            if unresolved:
                raise UnresolvedSignalsError(
                    unresolved,
                    target_program=self.active_rig.get("target_program"),
                    current_program_name=self.runtime.current_program_name,
                    node_count=len(self.runtime.get_program().nodes),
                )
        self._reset_devices_to_default()
        self._exam_runner = ExamRunner(
            self.runtime, self.runtime.clock, exam, sleep_fn=sleep_fn, physics=self._physics_engine
        )
        # Mark running synchronously (before the caller schedules `.run()` as
        # a background task) so a `GET /api/sim/exam/status` issued right
        # after `POST /api/sim/exam/start` returns -- even before the event
        # loop has had a chance to actually start the task -- never
        # observes a stale "idle" state.
        self._exam_runner.state = "running"
        return self._exam_runner

    def exam_status(self) -> dict:
        if self._exam_runner is None:
            return {"state": "idle", "title": None, "steps": []}
        return self._exam_runner.status()

    def abort_exam(self) -> None:
        if self._exam_runner is not None:
            self._exam_runner.abort()


simulation_manager = SimulationManager(_default_runtime)
