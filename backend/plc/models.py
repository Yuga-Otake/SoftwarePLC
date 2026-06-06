from pydantic import BaseModel, Field
from typing import Any, Optional


class PortDefinition(BaseModel):
    name: str
    data_type: str  # "bool" | "int" | "float"
    direction: str  # "input" | "output"
    description: str = ""


class NodeDefinition(BaseModel):
    id: str
    type: str
    params: dict[str, Any] = {}
    position: dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0})
    label: str = ""


class EdgeDefinition(BaseModel):
    id: str
    source: str
    source_handle: str
    target: str
    target_handle: str


class ProgramGraph(BaseModel):
    nodes: list[NodeDefinition] = []
    edges: list[EdgeDefinition] = []


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


class AIChatRequest(BaseModel):
    message: str
    history: list[dict[str, Any]] = []


class AIChatResponse(BaseModel):
    message: str
    tool_calls: list[dict[str, Any]] = []
    pending_ops: list[PendingOperation] = []
