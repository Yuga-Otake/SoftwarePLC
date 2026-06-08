import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.routes import router
from api.ws import manager
from plc.models import ProgramGraph
from plc.runtime import runtime
from plc.custom_blocks import load_custom_blocks
from plc.sandbox import sandbox_pool


def load_example():
    """Load the start/stop example on startup."""
    example_path = Path(__file__).parent.parent / "examples" / "start_stop.json"
    if example_path.exists():
        data = json.loads(example_path.read_text())
        runtime.load_program(ProgramGraph(**data))


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime.broadcast_callback = manager.broadcast
    load_custom_blocks()
    sandbox_pool.start()
    load_example()
    await runtime.start()
    yield
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

# Serve built frontend if it exists
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="static")
