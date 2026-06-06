import json
import uuid
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Any

from plc.models import (
    ProgramGraph,
    NodeDefinition,
    EdgeDefinition,
    RuntimeConfig,
    AIChatRequest,
    AIChatResponse,
    PendingOperation,
)
from plc.nodes import NODE_CATALOG
from plc.runtime import runtime
from api.ws import manager

router = APIRouter()


# ── WebSocket ────────────────────────────────────────────────────────────

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    # Send initial state immediately on connect
    try:
        await websocket.send_text(json.dumps({
            "type": "state_update",
            "runtime": runtime.get_current_state(),
            "metrics": (runtime.get_latest_metrics() or {}) and runtime.get_latest_metrics().model_dump(),
            "changes": {},
            "pending_ops": [op.model_dump() for op in runtime.pending_ops],
        }))
    except Exception:
        pass
    try:
        while True:
            # Keep alive; client messages not processed here
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── Node catalog ─────────────────────────────────────────────────────────

@router.get("/api/catalog")
def get_catalog():
    return NODE_CATALOG


# ── Program CRUD ─────────────────────────────────────────────────────────

@router.get("/api/program")
def get_program():
    return runtime.get_program().model_dump()


@router.put("/api/program")
def put_program(graph: ProgramGraph):
    runtime.load_program(graph)
    return {"ok": True}


class AddNodeRequest(BaseModel):
    type: str
    id: str | None = None
    params: dict[str, Any] = {}
    position: dict[str, float] = {}
    label: str = ""


@router.post("/api/program/nodes")
def add_node(req: AddNodeRequest):
    if req.type not in NODE_CATALOG:
        raise HTTPException(400, f"Unknown node type: {req.type}")
    program = runtime.get_program()
    node_id = req.id or f"{req.type.lower()}_{uuid.uuid4().hex[:6]}"
    node = NodeDefinition(
        id=node_id,
        type=req.type,
        params=req.params,
        position=req.position or {"x": 100, "y": 100},
        label=req.label,
    )
    program.nodes.append(node)
    runtime.load_program(program)
    return node.model_dump()


@router.delete("/api/program/nodes/{node_id}")
def delete_node(node_id: str):
    program = runtime.get_program()
    program.nodes = [n for n in program.nodes if n.id != node_id]
    program.edges = [
        e for e in program.edges if e.source != node_id and e.target != node_id
    ]
    runtime.load_program(program)
    return {"ok": True}


class UpdateNodeRequest(BaseModel):
    params: dict[str, Any] | None = None
    position: dict[str, float] | None = None
    label: str | None = None


@router.patch("/api/program/nodes/{node_id}")
def patch_node(node_id: str, req: UpdateNodeRequest):
    program = runtime.get_program()
    for node in program.nodes:
        if node.id == node_id:
            if req.params is not None:
                node.params.update(req.params)
            if req.position is not None:
                node.position = req.position
            if req.label is not None:
                node.label = req.label
            runtime.load_program(program)
            return node.model_dump()
    raise HTTPException(404, "Node not found")


class AddEdgeRequest(BaseModel):
    id: str | None = None
    source: str
    source_handle: str
    target: str
    target_handle: str


@router.post("/api/program/edges")
def add_edge(req: AddEdgeRequest):
    program = runtime.get_program()
    edge_id = req.id or f"e_{uuid.uuid4().hex[:8]}"
    edge = EdgeDefinition(
        id=edge_id,
        source=req.source,
        source_handle=req.source_handle,
        target=req.target,
        target_handle=req.target_handle,
    )
    # Prevent duplicate connections to same target handle
    program.edges = [
        e for e in program.edges
        if not (e.target == req.target and e.target_handle == req.target_handle)
    ]
    program.edges.append(edge)
    runtime.load_program(program)
    return edge.model_dump()


@router.delete("/api/program/edges/{edge_id}")
def delete_edge(edge_id: str):
    program = runtime.get_program()
    program.edges = [e for e in program.edges if e.id != edge_id]
    runtime.load_program(program)
    return {"ok": True}


# ── I/O control ──────────────────────────────────────────────────────────

class IOSetRequest(BaseModel):
    value: bool


@router.post("/api/io/{node_id}")
def set_io(node_id: str, req: IOSetRequest):
    runtime.set_io(node_id, req.value)
    return {"ok": True}


@router.get("/api/io")
def get_io():
    return runtime.get_io()


# ── Runtime config ────────────────────────────────────────────────────────

@router.get("/api/runtime/config")
def get_runtime_config():
    return {
        "scan_interval_ms": runtime.scan_interval_ms,
        "history_seconds": runtime.history_seconds,
    }


@router.patch("/api/runtime/config")
def patch_runtime_config(config: RuntimeConfig):
    if config.scan_interval_ms:
        runtime.scan_interval_ms = max(10.0, min(5000.0, config.scan_interval_ms))
    if config.history_seconds:
        runtime.history_seconds = max(10.0, min(600.0, config.history_seconds))
    return {
        "scan_interval_ms": runtime.scan_interval_ms,
        "history_seconds": runtime.history_seconds,
    }


@router.get("/api/runtime/metrics")
def get_metrics(count: int = 60):
    return [m.model_dump() for m in runtime.get_metrics_history(count)]


# ── History ───────────────────────────────────────────────────────────────

@router.get("/api/history/{node_id}/{port_name}")
def get_port_history(node_id: str, port_name: str, seconds: float = 30.0):
    data = runtime.get_port_history(node_id, port_name, seconds)
    return [{"ts": ts, "value": val} for ts, val in data]


@router.get("/api/history/events")
def get_events(from_ts: float = 0.0, to_ts: float | None = None):
    return [e.model_dump() for e in runtime.get_events(from_ts, to_ts)]


# ── AI Human-in-the-Loop ──────────────────────────────────────────────────

@router.post("/api/ai/pending/apply")
def apply_pending():
    """Apply all pending AI operations to the program."""
    program = runtime.get_program()
    applied = []

    for op in runtime.pending_ops:
        if op.op == "add_node":
            p = op.payload
            node = NodeDefinition(
                id=p["id"],
                type=p["type"],
                params=p.get("params", {}),
                position=p.get("position", {"x": 100, "y": 100}),
                label=p.get("label", ""),
            )
            program.nodes = [n for n in program.nodes if n.id != node.id]
            program.nodes.append(node)
            applied.append(op.op)

        elif op.op == "add_edge":
            p = op.payload
            edge = EdgeDefinition(
                id=p["id"],
                source=p["source"],
                source_handle=p["source_handle"],
                target=p["target"],
                target_handle=p["target_handle"],
            )
            program.edges = [
                e for e in program.edges
                if not (e.target == edge.target and e.target_handle == edge.target_handle)
            ]
            program.edges.append(edge)
            applied.append(op.op)

        elif op.op == "delete_node":
            node_id = op.payload["node_id"]
            program.nodes = [n for n in program.nodes if n.id != node_id]
            program.edges = [
                e for e in program.edges
                if e.source != node_id and e.target != node_id
            ]
            applied.append(op.op)

        elif op.op == "set_parameter":
            node_id = op.payload["node_id"]
            for node in program.nodes:
                if node.id == node_id:
                    node.params.update(op.payload.get("params", {}))
            applied.append(op.op)

    runtime.load_program(program)
    runtime.pending_ops = []
    return {"applied": len(applied)}


@router.post("/api/ai/pending/reject")
def reject_pending():
    """Discard all pending AI operations."""
    runtime.pending_ops = []
    return {"ok": True}


# ── AI chat ───────────────────────────────────────────────────────────────

@router.post("/api/ai/chat")
async def ai_chat(req: AIChatRequest):
    from ai.assistant import run_assistant
    response = await run_assistant(req.message, req.history)
    return response
