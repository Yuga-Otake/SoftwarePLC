from abc import ABC, abstractmethod
from typing import Any
import time


class NodeExecutor(ABC):
    NODE_TYPE: str = ""
    INPUT_PORTS: list[dict] = []
    OUTPUT_PORTS: list[dict] = []

    @abstractmethod
    def execute(
        self,
        inputs: dict[str, Any],
        state: dict[str, Any],
        params: dict[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        pass

    def default_state(self) -> dict[str, Any]:
        return {}

    @staticmethod
    def _now_ms(params: dict[str, Any]) -> float:
        """Resolve "now" in milliseconds for time-dependent blocks.

        `PLCGraph.execute` injects the runtime's clock value under the
        reserved `_now_ms` params key on every scan. When called outside that
        path (e.g. the custom-block test endpoint, or ad-hoc executor use)
        this falls back to real wall-clock time so behavior is unchanged.
        """
        now = params.get("_now_ms")
        if now is None:
            return time.time() * 1000
        return now


class DigitalInputExecutor(NodeExecutor):
    NODE_TYPE = "DigitalInput"
    INPUT_PORTS = []
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "bool", "description": "Output value"}]

    def execute(self, inputs, state, params):
        return {"OUT": bool(params.get("value", False))}, state


class DigitalOutputExecutor(NodeExecutor):
    NODE_TYPE = "DigitalOutput"
    INPUT_PORTS = [{"name": "IN", "data_type": "bool", "description": "Input value"}]
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "bool", "description": "Output (mirrors IN)"}]

    def execute(self, inputs, state, params):
        val = bool(inputs.get("IN", False))
        return {"OUT": val}, state


class ANDExecutor(NodeExecutor):
    NODE_TYPE = "AND"
    INPUT_PORTS = [
        {"name": "IN1", "data_type": "bool"},
        {"name": "IN2", "data_type": "bool"},
        {"name": "IN3", "data_type": "bool"},
        {"name": "IN4", "data_type": "bool"},
    ]
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "bool"}]

    def execute(self, inputs, state, params):
        if not inputs:
            return {"OUT": True}, state
        return {"OUT": all(bool(v) for v in inputs.values())}, state


class ORExecutor(NodeExecutor):
    NODE_TYPE = "OR"
    INPUT_PORTS = [
        {"name": "IN1", "data_type": "bool"},
        {"name": "IN2", "data_type": "bool"},
        {"name": "IN3", "data_type": "bool"},
        {"name": "IN4", "data_type": "bool"},
    ]
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "bool"}]

    def execute(self, inputs, state, params):
        if not inputs:
            return {"OUT": False}, state
        return {"OUT": any(bool(v) for v in inputs.values())}, state


class NOTExecutor(NodeExecutor):
    NODE_TYPE = "NOT"
    INPUT_PORTS = [{"name": "IN", "data_type": "bool"}]
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "bool"}]

    def execute(self, inputs, state, params):
        return {"OUT": not bool(inputs.get("IN", False))}, state


class TONExecutor(NodeExecutor):
    """On-delay timer: Q=True when IN has been True for >= PT ms."""
    NODE_TYPE = "TON"
    INPUT_PORTS = [{"name": "IN", "data_type": "bool", "description": "Enable"}]
    OUTPUT_PORTS = [
        {"name": "Q", "data_type": "bool", "description": "Done"},
        {"name": "ET", "data_type": "float", "description": "Elapsed time (ms)"},
    ]

    def execute(self, inputs, state, params):
        in_val = bool(inputs.get("IN", False))
        pt = float(params.get("PT", 1000))
        now = self._now_ms(params)

        if not in_val:
            return {"Q": False, "ET": 0.0}, {"start_time": None}

        start_time = state.get("start_time")
        if start_time is None:
            start_time = now

        et = min(now - start_time, pt)
        q = et >= pt
        return {"Q": q, "ET": round(et, 1)}, {"start_time": start_time}


class TOFFExecutor(NodeExecutor):
    """Off-delay timer: Q stays True for PT ms after IN goes False."""
    NODE_TYPE = "TOFF"
    INPUT_PORTS = [{"name": "IN", "data_type": "bool"}]
    OUTPUT_PORTS = [
        {"name": "Q", "data_type": "bool"},
        {"name": "ET", "data_type": "float", "description": "Elapsed time (ms)"},
    ]

    def execute(self, inputs, state, params):
        in_val = bool(inputs.get("IN", False))
        pt = float(params.get("PT", 1000))
        now = self._now_ms(params)

        if in_val:
            return {"Q": True, "ET": 0.0}, {"off_time": None}

        off_time = state.get("off_time")
        if off_time is None:
            off_time = now

        et = min(now - off_time, pt)
        q = et < pt
        return {"Q": q, "ET": round(et, 1)}, {"off_time": off_time}


class CTUExecutor(NodeExecutor):
    """Count-up counter."""
    NODE_TYPE = "CTU"
    INPUT_PORTS = [
        {"name": "CU", "data_type": "bool", "description": "Count up (rising edge)"},
        {"name": "R", "data_type": "bool", "description": "Reset"},
    ]
    OUTPUT_PORTS = [
        {"name": "Q", "data_type": "bool", "description": "CV >= PV"},
        {"name": "CV", "data_type": "int", "description": "Current value"},
    ]

    def execute(self, inputs, state, params):
        cu = bool(inputs.get("CU", False))
        r = bool(inputs.get("R", False))
        pv = int(params.get("PV", 10))

        if r:
            # Track CU's actual level even while reset is held, so that a CU
            # signal already-high (or held high through the reset pulse)
            # does not look like a fresh rising edge the instant reset
            # releases -- only a real 0->1 transition after R goes False
            # should count.
            return {"Q": False, "CV": 0}, {"cv": 0, "last_cu": cu}

        cv = int(state.get("cv", 0))
        last_cu = bool(state.get("last_cu", False))

        if cu and not last_cu:
            cv = min(cv + 1, 32767)

        q = cv >= pv
        return {"Q": q, "CV": cv}, {"cv": cv, "last_cu": cu}


class SRExecutor(NodeExecutor):
    """Set-dominant SR flip-flop."""
    NODE_TYPE = "SR"
    INPUT_PORTS = [
        {"name": "S", "data_type": "bool", "description": "Set"},
        {"name": "R", "data_type": "bool", "description": "Reset"},
    ]
    OUTPUT_PORTS = [{"name": "Q", "data_type": "bool"}]

    def execute(self, inputs, state, params):
        s = bool(inputs.get("S", False))
        r = bool(inputs.get("R", False))
        q = bool(state.get("q", False))

        if s:
            q = True
        elif r:
            q = False

        return {"Q": q}, {"q": q}


class RSExecutor(NodeExecutor):
    """Reset-dominant RS flip-flop."""
    NODE_TYPE = "RS"
    INPUT_PORTS = [
        {"name": "S", "data_type": "bool"},
        {"name": "R", "data_type": "bool"},
    ]
    OUTPUT_PORTS = [{"name": "Q", "data_type": "bool"}]

    def execute(self, inputs, state, params):
        s = bool(inputs.get("S", False))
        r = bool(inputs.get("R", False))
        q = bool(state.get("q", False))

        if r:
            q = False
        elif s:
            q = True

        return {"Q": q}, {"q": q}


class COMPExecutor(NodeExecutor):
    """Numeric comparator."""
    NODE_TYPE = "COMP"
    INPUT_PORTS = [
        {"name": "IN", "data_type": "float", "description": "Value to compare"},
    ]
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "bool"}]

    def execute(self, inputs, state, params):
        in_val = float(inputs.get("IN", 0.0))
        limit = float(params.get("LIMIT", 0.0))
        op = params.get("OP", ">=")

        ops = {
            ">": lambda a, b: a > b,
            "<": lambda a, b: a < b,
            ">=": lambda a, b: a >= b,
            "<=": lambda a, b: a <= b,
            "==": lambda a, b: a == b,
            "!=": lambda a, b: a != b,
        }
        result = ops.get(op, lambda a, b: False)(in_val, limit)
        return {"OUT": result}, state


class ADDExecutor(NodeExecutor):
    """Sums 2-4 numeric (or boolean, treated as 0/1) inputs into one number
    output. Generic arithmetic block (same "IN1..IN4, unused ports simply
    absent from `inputs`" shape as AND/OR) -- added for the KENTEI-PLC lane
    extension (see docs/SIMULATION.md "レーン") so a program can sum several
    latched per-lane detection bits (or any other numeric signals) into a
    single count, e.g. four SR-latched lane detections -> ADD -> VAR_WRITE ->
    a 7-seg screw-count display, without hand-chaining three separate 2-input
    adders.

    A missing/unconnected port is treated as 0 (matching VAR_READ/VAR_WRITE's
    "absent input is falsy" convention) rather than erroring, so a 2-input use
    (only IN1/IN2 wired) works exactly like a plain 2-input adder.
    """
    NODE_TYPE = "ADD"
    INPUT_PORTS = [
        {"name": "IN1", "data_type": "float"},
        {"name": "IN2", "data_type": "float"},
        {"name": "IN3", "data_type": "float"},
        {"name": "IN4", "data_type": "float"},
    ]
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "float", "description": "Sum of connected inputs"}]

    @staticmethod
    def _as_number(value: Any) -> float:
        if isinstance(value, bool):
            return 1.0 if value else 0.0
        if value is None:
            return 0.0
        return float(value)

    def execute(self, inputs, state, params):
        total = sum(self._as_number(v) for v in inputs.values())
        # Keep whole-number sums as ints (e.g. 2 rather than 2.0) so a
        # downstream VAR_WRITE -> indicator_number (7-seg) display shows
        # "2" instead of "2.0", matching CTU's CV convention.
        if total == int(total):
            total = int(total)
        return {"OUT": total}, state


class VarReadExecutor(NodeExecutor):
    """Reads the current value of an internal variable (see
    docs/VARIABLES.md). Params: VAR_ID(str). Output: OUT (bool or number,
    matching the variable's declared type).

    If VAR_ID doesn't resolve to a known variable (deleted out from under
    this node, typo, program edited by hand, etc.) this must NOT crash the
    scan -- it falls back to a safe default (False) and flags a warning in
    its own node state (`_warning`) for the debug API / UI to surface,
    matching the "no crash on missing variable" requirement.
    """
    NODE_TYPE = "VAR_READ"
    INPUT_PORTS = []
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "bool", "description": "Current variable value"}]

    def execute(self, inputs, state, params):
        var_id = params.get("VAR_ID", "")
        store: dict = params.get("_var_store") if params.get("_var_store") is not None else {}
        if not var_id or var_id not in store:
            return {"OUT": False}, {"_warning": f"unknown variable id: {var_id!r}"}
        return {"OUT": store.get(var_id)}, {}


class VarWriteExecutor(NodeExecutor):
    """Writes IN's value into an internal variable every scan (see
    docs/VARIABLES.md). Params: VAR_ID(str). Input: IN (bool or number).
    Output: OUT mirrors IN (so it can be chained/observed like other blocks).

    Same safety contract as VAR_READ: an unknown VAR_ID is a no-op (with a
    `_warning` in node state) rather than a crash.
    """
    NODE_TYPE = "VAR_WRITE"
    INPUT_PORTS = [{"name": "IN", "data_type": "bool", "description": "Value to write"}]
    OUTPUT_PORTS = [{"name": "OUT", "data_type": "bool", "description": "Mirrors IN"}]

    def execute(self, inputs, state, params):
        var_id = params.get("VAR_ID", "")
        val = inputs.get("IN", False)
        store = params.get("_var_store")
        if not var_id or store is None or var_id not in store:
            return {"OUT": val}, {"_warning": f"unknown variable id: {var_id!r}"}
        store[var_id] = val
        return {"OUT": val}, {}


_EXECUTOR_CLASSES = [
    DigitalInputExecutor,
    DigitalOutputExecutor,
    ANDExecutor,
    ORExecutor,
    NOTExecutor,
    TONExecutor,
    TOFFExecutor,
    CTUExecutor,
    SRExecutor,
    RSExecutor,
    COMPExecutor,
    ADDExecutor,
    VarReadExecutor,
    VarWriteExecutor,
]

EXECUTORS: dict[str, NodeExecutor] = {cls.NODE_TYPE: cls() for cls in _EXECUTOR_CLASSES}

NODE_CATALOG: dict[str, dict] = {
    cls.NODE_TYPE: {
        "type": cls.NODE_TYPE,
        "input_ports": cls.INPUT_PORTS,
        "output_ports": cls.OUTPUT_PORTS,
    }
    for cls in _EXECUTOR_CLASSES
}
