import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.routes import router
from api.network_routes import router as network_router
from api.sim_routes import router as sim_router
from api.ws import manager
from plc.models import ProgramGraph
from plc.runtime import runtime
from plc.custom_blocks import load_custom_blocks
from plc.sandbox import sandbox_pool
from plc.subservers import subserver_manager
from plc.simulation import simulation_manager


def load_example():
    """Load the start/stop example on startup."""
    example_path = Path(__file__).parent.parent / "examples" / "start_stop.json"
    if example_path.exists():
        data = json.loads(example_path.read_text())
        runtime.load_program(ProgramGraph(**data), program_name="start_stop")


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime.broadcast_callback = manager.broadcast
    # Wire the simulation tab's feedback-rule engine to run at the end of
    # every scan cycle (no-op unless a sim rig is currently activated -- see
    # plc/simulation.py::SimulationManager). Kept as a hook rather than a
    # hardcoded call inside PLCRuntime so the engine stays simulation-agnostic.
    runtime.post_scan_hook = simulation_manager.feedback_tick
    # Piggy-back the simulation tab's dynamic physics state (jig positions /
    # position_sensor flags) onto the `hmi` task's WS broadcast -- see
    # PLCRuntime.sim_state_provider / _hmi_task and
    # plc/simulation.py::SimulationManager.sim_state.
    runtime.sim_state_provider = simulation_manager.sim_state
    load_custom_blocks()
    sandbox_pool.start()
    load_example()
    await runtime.start()
    # Bring up the role-scoped sub-servers (HMI on 8010, viz on 8020 by
    # default -- see backend/network_config.json / docs/NETWORK.md) inside
    # this same asyncio loop. Best-effort: a failure to bind (e.g. Windows
    # Firewall prompt dismissed, port in use) is logged but must not prevent
    # the main dev-studio app (this one, port 8000) from starting.
    #
    # PLC_DISABLE_SUBSERVERS=1 skips this entirely -- set by tests/conftest.py
    # so the unrelated pytest suite (route smoke tests, scheduler tests) that
    # spin up `TestClient(app)` don't also bind real 8010/8020 listeners.
    if os.environ.get("PLC_DISABLE_SUBSERVERS") != "1":
        await subserver_manager.start_all()
    yield
    await subserver_manager.stop_all()
    await runtime.stop()
    sandbox_pool.stop()


app = FastAPI(title="Software PLC", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(network_router)
app.include_router(sim_router)

# Serve built frontend if it exists
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="static")
