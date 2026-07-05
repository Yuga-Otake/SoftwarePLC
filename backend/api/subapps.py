"""Role-scoped FastAPI apps served on their own ports alongside the main dev
studio (see docs/NETWORK.md):

- `build_hmi_app()`  -> port 8010: operator HMI delivery. Publishes the
  standalone HMI page, read-only screen listing/fetch, I/O writes, and a
  state WebSocket. Does NOT publish program editing, resource config, debug
  APIs, or HMI screen save/delete.
- `build_viz_app()`  -> port 8020: visualization delivery. Publishes the
  standalone dashboard page, viz history, program (read-only, for the status
  board), resources (read-only), and a state WebSocket. All writes
  (including I/O) are rejected with 404 so the role boundary is enforced by
  simply not registering those routes at all -- there is no shared-router
  mistake that could leak a write endpoint onto this port.

Both apps are intentionally *not* the same `FastAPI()` instance as
`main.app` (which keeps the full API on 8000) -- they're separate ASGI apps
that happen to import the same `runtime` singleton and `manager`
(ConnectionManager) as the main app, so all three ports observe/drive the
same one running PLC engine and broadcast to the same live WS state.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from plc.runtime import runtime
from api.ws import manager

STATIC_PAGES_DIR = Path(__file__).resolve().parent.parent / "static_pages"
HMI_SCREENS_DIR = Path(__file__).resolve().parent.parent / "hmi_screens"


def _read_page(filename: str) -> str:
    path = STATIC_PAGES_DIR / filename
    if not path.exists():
        return f"<html><body><h1>{filename} not found</h1></body></html>"
    return path.read_text(encoding="utf-8")


async def _ws_endpoint(websocket: WebSocket):
    """Shared state-push WS handler for both role-scoped apps -- identical
    wire format to the dev studio's `/ws` (see api/routes.py), since both
    HMI and viz standalone pages need the same live `state_update` /
    `viz_update` messages the main app's WS already produces via
    `runtime.broadcast_callback`."""
    await manager.connect(websocket)
    try:
        await websocket.send_text(json.dumps({
            "type": "state_update",
            "runtime": runtime.get_current_state(),
            "metrics": (runtime.get_latest_metrics() or {}) and runtime.get_latest_metrics().model_dump(),
            "changes": {},
            "pending_ops": [],
            "resources": runtime.scheduler.snapshot(),
        }))
    except Exception:
        pass
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


class IOSetRequest(BaseModel):
    value: bool


def build_hmi_app() -> FastAPI:
    app = FastAPI(title="Software PLC - HMI")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/", response_class=HTMLResponse)
    def index():
        return _read_page("hmi.html")

    @app.get("/api/hmi/screens")
    def list_hmi_screens():
        if not HMI_SCREENS_DIR.exists():
            return []
        return sorted(p.stem for p in HMI_SCREENS_DIR.glob("*.json"))

    @app.get("/api/hmi/screens/{name}")
    def get_hmi_screen(name: str):
        import re
        if not re.match(r"^[A-Za-z0-9_\-]+$", name):
            raise HTTPException(400, "Invalid screen name")
        path = HMI_SCREENS_DIR / f"{name}.json"
        if not path.exists():
            raise HTTPException(404, f"Unknown HMI screen: {name}")
        return json.loads(path.read_text(encoding="utf-8"))

    @app.post("/api/io/{node_id}")
    def set_io(node_id: str, req: IOSetRequest):
        runtime.set_io(node_id, req.value)
        return {"ok": True}

    @app.get("/api/io")
    def get_io():
        return runtime.get_io()

    @app.get("/api/signals")
    def get_signals():
        return runtime.list_signals()

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await _ws_endpoint(websocket)

    return app


def build_viz_app() -> FastAPI:
    app = FastAPI(title="Software PLC - Visualization")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.get("/", response_class=HTMLResponse)
    def index():
        return _read_page("viz.html")

    @app.get("/api/viz/history")
    def get_viz_history(signal: str, since_ms: float = 0.0):
        return {"signal": signal, "samples": runtime.get_viz_history(signal, since_ms=since_ms)}

    @app.get("/api/program")
    def get_program():
        return runtime.get_program().model_dump()

    @app.get("/api/resources")
    def get_resources():
        return {"tasks": runtime.scheduler.snapshot()}

    @app.get("/api/signals")
    def get_signals():
        return runtime.list_signals()

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await _ws_endpoint(websocket)

    return app
