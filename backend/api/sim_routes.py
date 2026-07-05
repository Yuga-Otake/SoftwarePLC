"""Simulation tab API: mock-device rig CRUD, rig activation (feedback-rule
wiring), and the sequencer exam runner (start/status/abort).

See docs/SIMULATION.md for the rig JSON format and the "author your own exam
machine" walkthrough. This module is intentionally thin -- all the actual
logic (signal read/write, feedback rules, exam step execution) lives in
`plc/simulation.py` so it can be unit-tested headlessly with a VirtualClock
(see backend/tests/test_simulation.py), independent of FastAPI/HTTP.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from plc import simulation
from plc.runtime import runtime

router = APIRouter()


# ── Rig CRUD (same pattern as GET/PUT/DELETE /api/hmi/screens) ─────────────

@router.get("/api/sim/rigs")
def list_sim_rigs():
    return simulation.list_rigs()


@router.get("/api/sim/rigs/{name}")
def get_sim_rig(name: str):
    rig = simulation.load_rig(name)
    if rig is None:
        raise HTTPException(404, f"Unknown sim rig: {name}")
    return rig


@router.put("/api/sim/rigs/{name}")
def put_sim_rig(name: str, rig: dict[str, Any]):
    try:
        simulation.save_rig(name, rig)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True, "name": name}


@router.delete("/api/sim/rigs/{name}")
def delete_sim_rig(name: str):
    if simulation.simulation_manager.active_rig_name == name:
        simulation.simulation_manager.deactivate()
    simulation.delete_rig(name)
    return {"ok": True}


@router.get("/api/sim/rigs/{name}/bindings")
def get_sim_rig_bindings(name: str):
    """Every device signal-path binding declared by rig `name`, with its
    resolution status against the CURRENT program (see docs/SIMULATION.md
    "リグバインド編集") -- backs the simulation tab's binding-edit mode (red
    marker on a device whose signal doesn't resolve, e.g. kentei_plc's
    intentionally-unwired PL3/PL4). Uses the on-disk rig definition (not
    necessarily the currently-*active* rig), same as GET /api/sim/rigs/{name}
    above, so bindings can be inspected/edited before activation.

    When `name` IS the currently-active rig, rig-provided virtual signals
    (a relay's `contact_signal` -- see docs/SIMULATION.md "リレー") report
    resolved/kind="rig" instead of a false-alarm red marker, since the rig
    itself drives that signal once active (BUG-009, docs/QA_LOG.md)."""
    rig = simulation.load_rig(name)
    if rig is None:
        raise HTTPException(404, f"Unknown sim rig: {name}")
    mgr = simulation.simulation_manager
    active_rig = mgr.active_rig if mgr.active_rig_name == name else None
    return {
        "name": name,
        "bindings": simulation.rig_bindings(runtime, rig, active_rig=active_rig),
    }


# ── Activation ───────────────────────────────────────────────────────────

@router.get("/api/sim/active")
def get_active_rig():
    mgr = simulation.simulation_manager
    return {"active_rig": mgr.active_rig_name, "rig": mgr.active_rig}


@router.post("/api/sim/rigs/{name}/activate")
def activate_sim_rig(name: str):
    try:
        rig = simulation.simulation_manager.activate(name)
    except KeyError:
        raise HTTPException(404, f"Unknown sim rig: {name}")
    return {"ok": True, "active_rig": name, "rig": rig}


@router.post("/api/sim/deactivate")
def deactivate_sim_rig():
    simulation.simulation_manager.deactivate()
    return {"ok": True}


# ── Dynamic simulation state (conveyor/jig/position_sensor) ────────────────

@router.get("/api/sim/state")
def get_sim_state():
    """Jig positions + position_sensor detection flags for the currently
    active rig (empty dicts if no rig is active or it has no such devices).
    The frontend also gets this piggy-backed on the WS `state_update`
    message's `sim_state` key at the `hmi` task's cadence for smoother
    animation; this endpoint exists for polling/curl verification and as a
    fallback before the first WS message arrives."""
    return simulation.simulation_manager.sim_state()


@router.post("/api/sim/jigs/{jig_id}/reset")
def reset_sim_jig(jig_id: str):
    ok = simulation.simulation_manager.reset_jig(jig_id)
    if not ok:
        raise HTTPException(404, f"Unknown jig (or no rig active): {jig_id}")
    return {"ok": True, "jig": jig_id}


class SetFeatureRequest(BaseModel):
    attached: bool = True


@router.post("/api/sim/jigs/{jig_id}/features/{feature_id}")
def set_sim_jig_feature(jig_id: str, feature_id: str, body: SetFeatureRequest):
    """Attach/detach one screw (or other jig feature) -- see
    docs/SIMULATION.md "ネジ着脱". Detached features are skipped entirely by
    position_sensor detection and rendered as an empty hole by the frontend."""
    ok = simulation.simulation_manager.set_feature_attached(jig_id, feature_id, body.attached)
    if not ok:
        raise HTTPException(404, f"Unknown jig/feature (or no rig active): {jig_id}/{feature_id}")
    return {"ok": True, "jig": jig_id, "feature": feature_id, "attached": body.attached}


# ── Exam runner ──────────────────────────────────────────────────────────

class StartExamRequest(BaseModel):
    # Skip the unresolved-signal preflight check (see docs/SIMULATION.md,
    # BUG-009 in docs/QA_LOG.md) and start anyway -- the escape hatch for an
    # operator who knows what they're doing (e.g. deliberately testing a
    # rig against a program that only wires up SOME of its signals).
    force: bool = False


@router.post("/api/sim/exam/start")
async def start_exam(body: StartExamRequest = StartExamRequest()):
    mgr = simulation.simulation_manager
    try:
        exam_runner = mgr.start_exam(force=body.force)
    except simulation.UnresolvedSignalsError as exc:
        # 409 Conflict (not 400): the request is well-formed and CAN be
        # retried as-is (with force=true) or resolved by loading the right
        # program first -- distinct from the plain 400s below ("no rig
        # activated"/"already running"), which aren't actionable this way.
        raise HTTPException(409, {
            "error": "unresolved_signals",
            "signals": exc.signals,
            "target_program": exc.target_program,
            "current_program": exc.current_program,
            "hint": "リグの対象プログラムをロードしてください",
        })
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    # Run in the background against real time (RealClock + asyncio.sleep);
    # the frontend/curl poll GET /api/sim/exam/status while it progresses.
    asyncio.create_task(exam_runner.run())
    return {"ok": True, "state": exam_runner.state}


@router.get("/api/sim/exam/status")
def get_exam_status():
    return simulation.simulation_manager.exam_status()


@router.post("/api/sim/exam/abort")
def abort_exam():
    simulation.simulation_manager.abort_exam()
    return {"ok": True}
