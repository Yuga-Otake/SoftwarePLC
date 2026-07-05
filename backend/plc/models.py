from pydantic import BaseModel, Field
from typing import Any, Optional


class PortDefinition(BaseModel):
    name: str
    data_type: str  # "bool" | "int" | "float"
    direction: str  # "input" | "output"
    description: str = ""


class GroupPort(BaseModel):
    """A boundary In/Out port exposed by a group node. `id` is referenced from
    inside the group's `children` edges via the reserved node id `$parent`
    (see docs/HIERARCHY.md)."""
    id: str
    name: str = ""
    data_type: str = "bool"  # "bool" | "int" | "float"


class NodeDefinition(BaseModel):
    id: str
    type: str
    params: dict[str, Any] = {}
    position: dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0})
    label: str = ""

    # ── Group (hierarchy) fields — only meaningful when type == "group" ────
    kind: str = ""  # free-form drill-down level label, e.g. "装置"/"工程"/"動作"/"機能"
    inputs: list[GroupPort] = []
    outputs: list[GroupPort] = []
    children: "ProgramGraph | None" = None


class EdgeDefinition(BaseModel):
    id: str
    source: str
    source_handle: str
    target: str
    target_handle: str


class VariableDefinition(BaseModel):
    """An internal "work" variable (M/D-style), independent of the X/Y I/O
    nodes on the canvas. See docs/VARIABLES.md. `type` is "bool" or "number"
    (mirrors the two data types the rest of the engine natively supports --
    bool and float/int are represented as Python bool/float at runtime)."""
    id: str
    name: str = ""
    type: str = "bool"  # "bool" | "number"
    initial: Any = False
    comment: str = ""


class ProgramGraph(BaseModel):
    nodes: list[NodeDefinition] = []
    edges: list[EdgeDefinition] = []
    # Internal variables (M/D-style work variables). Absent in older program
    # JSON files -- defaults to [] so existing programs load unchanged
    # (backward compatible, see docs/VARIABLES.md).
    variables: list[VariableDefinition] = []


NodeDefinition.model_rebuild()


class ScanMetrics(BaseModel):
    cycle_time_ms: float
    target_cycle_ms: float
    nodes_evaluated: int
    utilization_pct: float
    memory_mb: float
    history_buffer_mb: float
    scan_index: int
    timestamp: float


class StateEvent(BaseModel):
    timestamp: float
    scan_index: int
    changes: dict[str, dict[str, Any]]


class RuntimeConfig(BaseModel):
    scan_interval_ms: float = 100.0
    history_seconds: float = 60.0


class PendingOperation(BaseModel):
    op: str  # "add_node" | "add_edge" | "delete_node" | "set_parameter"
    payload: dict[str, Any]


class CustomBlockPort(BaseModel):
    name: str
    data_type: str  # "bool" | "int" | "float" | "str"
    description: str = ""


class CustomBlockDefinition(BaseModel):
    id: str
    name: str
    description: str = ""
    code: str
    input_ports: list[CustomBlockPort] = []
    output_ports: list[CustomBlockPort] = []
    params_schema: dict[str, Any] = {}
    icon_color: str = "#8b5cf6"
    created_by: str = "human"  # "human" | "ai"


class CustomBlockTestRequest(BaseModel):
    code: str
    inputs: dict[str, Any] = {}
    state: dict[str, Any] = {}
    params: dict[str, Any] = {}


class AIChatRequest(BaseModel):
    message: str
    history: list[dict[str, Any]] = []


class AIChatResponse(BaseModel):
    message: str
    tool_calls: list[dict[str, Any]] = []
    pending_ops: list[PendingOperation] = []
