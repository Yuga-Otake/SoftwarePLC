import json
import re
import uuid
from pathlib import Path
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
    CustomBlockDefinition,
    CustomBlockTestRequest,
    VariableDefinition,
)
from plc.nodes import NODE_CATALOG
from plc.runtime import runtime
from plc import custom_blocks
from plc.sandbox import sandbox_pool
from plc import simulation
from plc import rename
from plc import signal_hub
from api.ws import manager

router = APIRouter()

EXAMPLES_DIR = Path(__file__).resolve().parent.parent.parent / "examples"
HMI_SCREENS_DIR = Path(__file__).resolve().parent.parent / "hmi_screens"


# ── WebSocket ────────────────────────────────────────────────────────────

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    # Send initial state immediately on connect
    try:
        await websocket.send_text(json.dumps({
            "type": "state_update",
            "runtime": runtime.get_broadcast_state(),
            "metrics": (runtime.get_latest_metrics() or {}) and runtime.get_latest_metrics().model_dump(),
            "changes": {},
            "pending_ops": [op.model_dump() for op in runtime.pending_ops],
            "resources": runtime.scheduler.snapshot(),
            # Simulation tab's dynamic physics state (jig positions /
            # position_sensor flags, see plc/simulation.py::PhysicsEngine) --
            # included here too (not just the periodic `hmi` task broadcast)
            # so a freshly-opened tab doesn't render a conveyor/jig at a
            # stale/default position before the first `hmi` tick arrives.
            "sim_state": simulation.simulation_manager.sim_state(),
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
    return {**NODE_CATALOG, **custom_blocks.custom_block_catalog()}


# ── Program CRUD ─────────────────────────────────────────────────────────

@router.get("/api/program")
def get_program():
    return runtime.get_program().model_dump()


@router.get("/api/program/current-name")
def get_current_program_name():
    """Name of the example program (`examples/<name>.json`) currently loaded
    (see `runtime.current_program_name`), or None if unknown (a raw
    `PUT /api/program` edit, or a program that was never loaded from a named
    example). Used by the simulation tab's header display and its exam
    preflight check (docs/SIMULATION.md, BUG-009 in docs/QA_LOG.md) so an
    operator can tell at a glance whether the loaded program matches a rig's
    `target_program` before starting a certification run."""
    node_count = len(runtime.get_program().nodes)
    return {"name": runtime.current_program_name, "node_count": node_count}


@router.put("/api/program")
def put_program(graph: ProgramGraph):
    runtime.load_program(graph)
    return {"ok": True}


@router.get("/api/program/examples")
def list_program_examples():
    """List example program JSON files bundled in `examples/`, for the
    convenience load-by-name endpoint below."""
    if not EXAMPLES_DIR.exists():
        return []
    return sorted(p.stem for p in EXAMPLES_DIR.glob("*.json"))


@router.post("/api/program/examples/{name}/load")
def load_program_example(name: str):
    """Load one of the bundled example programs (`examples/{name}.json`) by
    name, e.g. `start_stop` or `conveyor_machine`. Used by the frontend's
    example switcher and by headless verification (curl)."""
    path = EXAMPLES_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(404, f"Unknown example: {name}")
    data = json.loads(path.read_text(encoding="utf-8"))
    graph = ProgramGraph(**data)
    runtime.load_program(graph, program_name=name)
    return runtime.get_program().model_dump()


class AddNodeRequest(BaseModel):
    type: str
    id: str | None = None
    params: dict[str, Any] = {}
    position: dict[str, float] = {}
    label: str = ""


@router.post("/api/program/nodes")
def add_node(req: AddNodeRequest):
    if req.type not in NODE_CATALOG and req.type not in custom_blocks.CUSTOM_BLOCKS:
        raise HTTPException(400, f"Unknown node type: {req.type}")
    program = runtime.get_program()
    if req.id:
        # An explicit id is how the simulation-binding "create as input
        # node"/rename-target flows let a user pick a specific, discoverable
        # signal name (see docs/VARIABLES.md "信号ハブ") rather than an
        # opaque uuid suffix -- so unlike the auto-generated-id path, it must
        # be validated the same way a rename target is (BUG-005 in
        # docs/QA_LOG.md is exactly this validation gap for the top-level
        # duplicate case; this closes it for the common "explicit id" entry
        # point instead of only documenting the pre-existing gap).
        try:
            rename.validate_new_id(req.id)
        except rename.RenameError as exc:
            raise HTTPException(400, str(exc))
        if req.id in rename.all_node_ids(program):
            raise HTTPException(400, f"Node id already exists: {req.id}")
        node_id = req.id
    else:
        node_id = f"{req.type.lower()}_{uuid.uuid4().hex[:6]}"
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


class RenameNodeRequest(BaseModel):
    new_id: str


@router.post("/api/program/nodes/{node_id}/rename")
def rename_node(node_id: str, req: RenameNodeRequest):
    """Rename a node id (= its signal name) across the whole program (top
    level and inside every group's nested children -- see
    plc/rename.py::rename_node_in_graph), then cascade the new name into
    every sim rig / HMI screen JSON that referenced the old id, and finally
    reload the running program so the change takes effect immediately (no
    server restart needed). See docs/VARIABLES.md "信号ハブ" for why this
    exists: it's the "rename from the logic side" half of making
    logic-design signals and simulation-rig signals mutually discoverable/
    bindable."""
    new_id = req.new_id
    try:
        rename.validate_new_id(new_id)
    except rename.RenameError as exc:
        raise HTTPException(400, str(exc))

    program = runtime.get_program()
    if node_id == new_id:
        raise HTTPException(400, "new_id is the same as the current id")
    existing_ids = rename.all_node_ids(program)
    if new_id in existing_ids:
        raise HTTPException(400, f"Node id already exists: {new_id}")
    if node_id not in existing_ids:
        raise HTTPException(404, f"Unknown node: {node_id}")

    found, edge_refs = rename.rename_node_in_graph(program, node_id, new_id)
    if not found:
        raise HTTPException(404, f"Unknown node: {node_id}")

    # Reload BEFORE the file cascade so `runtime.load_program` (which
    # rebuilds the flattened execution graph) reflects the rename
    # immediately -- the live server picks it up on the very next scan, no
    # restart/reconnect required.
    runtime.load_program(program)

    updated_refs = rename.cascade_rename_to_files(node_id, new_id)

    # The currently-*active* rig (if any) was loaded into memory at
    # activation time and is a separate dict from the on-disk JSON this
    # cascade just rewrote -- rewrite it too (same fields, same helper) so a
    # live simulation session doesn't keep pointing at the stale signal name
    # until the next (re)activation.
    active_rig = simulation.simulation_manager.active_rig
    if active_rig is not None:
        rename.rewrite_rig(active_rig, node_id, new_id)

    return {
        "id": new_id,
        "old_id": node_id,
        "edge_refs_updated": edge_refs,
        "updated_refs": updated_refs,
    }


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


# ── Signals (HMI binding / visualization) ──────────────────────────────────

@router.get("/api/signals")
def get_signals():
    """Enumerate all known signal paths ("node_id.port") with current value
    and inferred data type, for the HMI builder's binding dropdown and the
    visualization tab's trend/signal picker."""
    return runtime.list_signals()


@router.get("/api/signals/usage")
def get_signals_usage():
    """Signal hub (see docs/VARIABLES.md "6. 信号ハブ"): for every known
    signal, where it's used (logic edge count, referencing HMI screens, sim
    rigs), plus the reverse view -- every rig/HMI reference that does NOT
    resolve against the current program (`unresolved`). Backs the variable
    manager modal's per-row usage badges and its "unresolved references"
    section."""
    return signal_hub.signals_usage_report(runtime)


# ── Variables (I/O + internal work variables, unified view) ────────────────
# See docs/VARIABLES.md. This is a read/write view that combines:
#   - "input"    : DigitalInput nodes on the canvas (X)
#   - "output"   : DigitalOutput nodes on the canvas (Y)
#   - "internal" : the program's `variables` section (M/D-style work vars)
# I/O rows only support renaming (label) from this view -- adding/removing
# I/O nodes remains a canvas/palette operation. Internal variables support
# full CRUD from here.

def _variable_view_rows() -> list[dict]:
    program = runtime.get_program()
    outputs = runtime.get_current_state()
    io_values = runtime.get_io()
    rows: list[dict] = []

    for node in program.nodes:
        if node.type not in ("DigitalInput", "DigitalOutput"):
            continue
        kind = "input" if node.type == "DigitalInput" else "output"
        if kind == "input":
            # Read the just-written I/O value directly rather than waiting
            # for `_current_outputs` (which only reflects the *last
            # completed scan*). Without this, a force-write immediately
            # followed by GET /api/variables can race the live scan loop and
            # read back the stale pre-write value (BUG-006, see
            # docs/QA_LOG.md) -- confusing for a variable manager whose
            # whole point is "what did I just set this to". Falls back to
            # the node's static default (params.value) before the first
            # scan has ever run.
            value = io_values.get(node.id, node.params.get("value", False))
        else:
            value = outputs.get(node.id, {}).get("OUT")
        rows.append({
            "id": node.id,
            "kind": kind,
            "name": node.label or node.id,
            "type": "bool",
            "value": value,
            "comment": "",
            "editable_name": True,
            "editable_value": kind == "input",
        })

    for var_id, definition in sorted(runtime._variables.items()):
        rows.append({
            "id": var_id,
            "kind": "internal",
            "name": definition.name or var_id,
            "type": definition.type,
            "value": runtime.get_variable_value(var_id),
            "comment": definition.comment,
            "initial": definition.initial,
            "editable_name": True,
            "editable_value": True,
        })

    return rows


@router.get("/api/variables")
def list_variables():
    """Unified I/O + internal-variable view for the variable manager modal:
    every DigitalInput/DigitalOutput node (kind input/output) plus every
    internal variable (kind internal), each with its current live value."""
    return _variable_view_rows()


class CreateVariableRequest(BaseModel):
    id: str | None = None
    name: str = ""
    type: str = "bool"  # "bool" | "number"
    initial: Any = False
    comment: str = ""


@router.post("/api/variables")
def create_variable(req: CreateVariableRequest):
    if req.type not in ("bool", "number"):
        raise HTTPException(400, "type must be 'bool' or 'number'")
    var_id = req.id or f"m_{uuid.uuid4().hex[:6]}"
    if var_id in runtime._variables:
        raise HTTPException(400, f"Variable id already exists: {var_id}")
    definition = VariableDefinition(
        id=var_id, name=req.name or var_id, type=req.type, initial=req.initial, comment=req.comment,
    )
    runtime.add_variable(definition)
    return definition.model_dump()


class UpdateVariableRequest(BaseModel):
    name: str | None = None
    type: str | None = None
    initial: Any = None
    comment: str | None = None


@router.put("/api/variables/{var_id}")
def update_variable(var_id: str, req: UpdateVariableRequest):
    if req.type is not None and req.type not in ("bool", "number"):
        raise HTTPException(400, "type must be 'bool' or 'number'")
    updated = runtime.update_variable(var_id, req.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(404, f"Unknown variable: {var_id}")
    return updated.model_dump()


@router.delete("/api/variables/{var_id}")
def delete_variable(var_id: str):
    existed = runtime.delete_variable(var_id)
    if not existed:
        raise HTTPException(404, f"Unknown variable: {var_id}")
    return {"ok": True}


class ForceVariableRequest(BaseModel):
    value: Any


@router.post("/api/variables/{var_id}/force")
def force_variable(var_id: str, req: ForceVariableRequest):
    """Force-write a variable's live value. Internal variables write
    directly to the variable store; DigitalInput (X) nodes are forced via
    the existing I/O channel (same effect as toggling from the logic
    canvas/HMI). DigitalOutput (Y) nodes are read-only from this endpoint --
    a single-scan output override isn't supported (see docs/VARIABLES.md)."""
    if var_id in runtime._variables:
        definition = runtime.force_variable_value(var_id, req.value)
        return {"ok": True, "kind": "internal", "value": runtime.get_variable_value(var_id)}

    program = runtime.get_program()
    node = next((n for n in program.nodes if n.id == var_id), None)
    if node is None:
        raise HTTPException(404, f"Unknown variable/signal: {var_id}")
    if node.type == "DigitalOutput":
        raise HTTPException(400, "Outputs (Y) are read-only; cannot force-write")
    if node.type != "DigitalInput":
        raise HTTPException(400, f"Not a forceable variable/input: {var_id}")

    runtime.set_io(var_id, bool(req.value))
    return {"ok": True, "kind": "input", "value": bool(req.value)}


class RenameVariableRequest(BaseModel):
    name: str


@router.put("/api/variables/{var_id}/rename")
def rename_variable(var_id: str, req: RenameVariableRequest):
    """Rename an I/O node's label or an internal variable's display name.
    This is the only edit the variable manager allows for I/O rows --
    adding/removing X/Y nodes remains a canvas/palette operation."""
    if var_id in runtime._variables:
        updated = runtime.update_variable(var_id, {"name": req.name})
        return updated.model_dump()

    program = runtime.get_program()
    for node in program.nodes:
        if node.id == var_id:
            if node.type not in ("DigitalInput", "DigitalOutput"):
                raise HTTPException(400, "Only I/O nodes and internal variables can be renamed here")
            node.label = req.name
            runtime.load_program(program)
            return {"id": node.id, "name": node.label}
    raise HTTPException(404, f"Unknown variable/signal: {var_id}")


# ── Resources: task scheduler (control/hmi/viz CPU budgeting) ─────────────
# See docs/RESOURCES.md for the task model and degrade policy this exposes.

@router.get("/api/resources")
def get_resources():
    return {"tasks": runtime.scheduler.snapshot()}


class ResourceTaskUpdate(BaseModel):
    name: str
    period_ms: float | None = None
    cpu_share: float | None = None


class ResourcesUpdateRequest(BaseModel):
    tasks: list[ResourceTaskUpdate]


@router.put("/api/resources")
def put_resources(req: ResourcesUpdateRequest):
    for task_req in req.tasks:
        if task_req.name not in runtime.scheduler.tasks:
            raise HTTPException(400, f"Unknown task: {task_req.name}")
        if task_req.name == "control" and task_req.cpu_share is not None:
            # control's cpu_share is protected/advisory-only; period is still
            # adjustable (mirrors the legacy scan_interval_ms knob) but its
            # share is fixed so the degrade policy always treats it as the
            # protected task.
            task_req = ResourceTaskUpdate(name=task_req.name, period_ms=task_req.period_ms)
        runtime.scheduler.update_config(
            task_req.name, period_ms=task_req.period_ms, cpu_share=task_req.cpu_share
        )
        if task_req.name == "control" and task_req.period_ms is not None:
            runtime.scan_interval_ms = runtime.scheduler.tasks["control"].config.period_ms
    return {"tasks": runtime.scheduler.snapshot()}


# ── Visualization: trend history ───────────────────────────────────────────

@router.get("/api/viz/history")
def get_viz_history(signal: str, since_ms: float = 0.0):
    """Ring-buffer trend samples for one signal ("node_id.port"), recorded by
    the `viz` task at its own (possibly degraded) sampling rate."""
    return {"signal": signal, "samples": runtime.get_viz_history(signal, since_ms=since_ms)}


# ── HMI screens (D&D operator-screen builder persistence) ──────────────────
# See docs/HMI.md for the screen JSON format.

_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


def _hmi_screen_path(name: str) -> Path:
    if not _SAFE_NAME_RE.match(name):
        raise HTTPException(400, "Invalid screen name")
    HMI_SCREENS_DIR.mkdir(parents=True, exist_ok=True)
    return HMI_SCREENS_DIR / f"{name}.json"


@router.get("/api/hmi/screens")
def list_hmi_screens():
    if not HMI_SCREENS_DIR.exists():
        return []
    return sorted(p.stem for p in HMI_SCREENS_DIR.glob("*.json"))


@router.get("/api/hmi/screens/{name}")
def get_hmi_screen(name: str):
    path = _hmi_screen_path(name)
    if not path.exists():
        raise HTTPException(404, f"Unknown HMI screen: {name}")
    return json.loads(path.read_text(encoding="utf-8"))


@router.put("/api/hmi/screens/{name}")
def put_hmi_screen(name: str, screen: dict[str, Any]):
    # `widgets` must be a list if present at all: both the React HMI builder
    # and the standalone hmi.html page assume `screen.widgets` is
    # array-like (`.map`/`.forEach`) and will throw/white-screen on load if
    # it's e.g. a string or object from hand-edited/corrupted JSON. Reject
    # that shape here instead of persisting it (BUG-003, see docs/QA_LOG.md).
    widgets = screen.get("widgets")
    if widgets is not None and not isinstance(widgets, list):
        raise HTTPException(400, "screen.widgets must be a list")
    path = _hmi_screen_path(name)
    path.write_text(json.dumps(screen, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "name": name}


@router.delete("/api/hmi/screens/{name}")
def delete_hmi_screen(name: str):
    path = _hmi_screen_path(name)
    if path.exists():
        path.unlink()
    return {"ok": True}


# ── Debug (headless evaluation: JSON/log output instead of screenshots) ────

@router.get("/api/debug/state")
def get_debug_state():
    """Full snapshot of the running program for headless evaluation: every
    input/output port value, each node's internal state (timer elapsed,
    latch bits, etc.), and the current scan count."""
    return {
        "scan_index": runtime.get_scan_index(),
        "now_ms": runtime.clock.now_ms(),
        "io_values": runtime.get_io(),
        "outputs": runtime.get_current_state(),
        "node_states": runtime.get_node_states(),
    }


@router.get("/api/debug/events")
def get_debug_events(since: int = 0):
    """Recent signal-level transitions (ring buffer, ~1000 entries), in the
    same shape as the scenario runner's JSONL output: {seq, t_ms, scan,
    signal, old, new}. Poll with `since=<last seq seen>` for incremental
    reads."""
    events = runtime.get_recent_events(since=since)
    return {
        "events": events,
        "last_seq": events[-1]["seq"] if events else since,
    }


# ── Custom code blocks (Python, process-isolated) ─────────────────────────

@router.get("/api/blocks/custom")
def list_custom_blocks():
    return [b.model_dump() for b in custom_blocks.CUSTOM_BLOCKS.values()]


@router.get("/api/blocks/custom/{block_id}")
def get_custom_block(block_id: str):
    definition = custom_blocks.get_custom_block(block_id)
    if definition is None:
        raise HTTPException(404, "Custom block not found")
    return definition.model_dump()


class SaveCustomBlockRequest(BaseModel):
    id: str | None = None
    name: str
    description: str = ""
    code: str
    input_ports: list[dict[str, Any]] = []
    output_ports: list[dict[str, Any]] = []
    params_schema: dict[str, Any] = {}
    icon_color: str = "#8b5cf6"
    created_by: str = "human"


@router.post("/api/blocks/custom")
def save_custom_block(req: SaveCustomBlockRequest):
    block_id = req.id or f"custom_{req.name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:6]}"
    definition = CustomBlockDefinition(
        id=block_id,
        name=req.name,
        description=req.description,
        code=req.code,
        input_ports=req.input_ports,
        output_ports=req.output_ports,
        params_schema=req.params_schema,
        icon_color=req.icon_color,
        created_by=req.created_by,
    )
    custom_blocks.save_custom_block(definition)
    return definition.model_dump()


@router.delete("/api/blocks/custom/{block_id}")
def delete_custom_block(block_id: str):
    custom_blocks.delete_custom_block(block_id)
    return {"ok": True}


@router.post("/api/blocks/custom/test")
async def test_custom_block(req: CustomBlockTestRequest):
    """Run user code once in the sandbox and report outputs/errors/timing."""
    outputs, new_state, error, exec_ms = await sandbox_pool.run(
        req.code, req.inputs, req.state, req.params
    )
    return {
        "outputs": outputs,
        "new_state": new_state,
        "error": error,
        "exec_ms": round(exec_ms, 3),
    }


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

        elif op.op == "create_custom_block":
            p = op.payload
            definition = CustomBlockDefinition(
                id=p["id"],
                name=p["name"],
                description=p.get("description", ""),
                code=p["code"],
                input_ports=p.get("input_ports", []),
                output_ports=p.get("output_ports", []),
                params_schema=p.get("params_schema", {}),
                icon_color=p.get("icon_color", "#8b5cf6"),
                created_by="ai",
            )
            custom_blocks.save_custom_block(definition)
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

@router.get("/api/ai/status")
def ai_status():
    """Which AI provider (Anthropic/Gemini) is configured, if any -- shown as
    a small badge in the AI panel."""
    from ai.assistant import get_ai_status
    return get_ai_status()


@router.post("/api/ai/chat")
async def ai_chat(req: AIChatRequest):
    from ai.assistant import run_assistant
    response = await run_assistant(req.message, req.history)
    return response
