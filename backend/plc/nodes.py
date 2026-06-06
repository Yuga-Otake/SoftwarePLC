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
        now = time.time() * 1000

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
        now = time.time() * 1000

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
            return {"Q": False, "CV": 0}, {"cv": 0, "last_cu": False}

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
