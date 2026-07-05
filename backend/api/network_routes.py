"""Network management + running-program monitoring API. Published ONLY on
the main dev-studio app (port 8000) -- see docs/NETWORK.md. Exposes:

- `GET /api/network`    : per-service status (port/enabled/listening/WS
  client count/access URLs) plus a monitoring summary of the currently
  loaded program (name, running state, scan count, per-task utilization).
- `PUT /api/network/{service}` : change a service's port/enabled flag,
  validate, persist, and restart just that sub-server.
"""
from __future__ import annotations

import socket

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from plc.network_config import network_config, NetworkConfigError
from plc.subservers import subserver_manager
from plc.runtime import runtime

router = APIRouter()


def _lan_ip() -> str:
    """Best-effort LAN IP for building access URLs from another device on
    the same network. Falls back to 127.0.0.1 if it can't be determined
    (e.g. no network interface, sandboxed environment)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # Doesn't actually send any traffic -- just asks the OS which
            # local interface/address it would use for this destination.
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def _access_urls(port: int) -> dict[str, str]:
    return {
        "localhost": f"http://localhost:{port}",
        "lan": f"http://{_lan_ip()}:{port}",
    }


def _program_name() -> str:
    """No explicit "program name" field exists on ProgramGraph today, so we
    derive a human-readable label from the loaded program's shape (root
    group labels if any, else a node-count summary) -- good enough for the
    monitoring panel without requiring a schema change."""
    program = runtime.get_program()
    top_groups = [n for n in program.nodes if n.type == "group"]
    if top_groups:
        return " / ".join(g.label or g.id for g in top_groups)
    if program.nodes:
        return f"無題プログラム ({len(program.nodes)} ノード)"
    return "(プログラム未ロード)"


def _monitoring_summary() -> dict:
    metrics = runtime.get_latest_metrics()
    return {
        "program_name": _program_name(),
        "running": runtime._running,
        "scan_index": runtime.get_scan_index(),
        "last_cycle_time_ms": metrics.cycle_time_ms if metrics else None,
        "node_count": len(runtime.get_program().nodes),
        "tasks": runtime.scheduler.snapshot(),
    }


@router.get("/api/network")
def get_network():
    services = []
    for name, svc in network_config.services.items():
        if svc.role == "studio":
            listening = True  # this very request proves port 8000 is up
        else:
            listening = subserver_manager.is_running(name)
        services.append({
            "name": svc.name,
            "role": svc.role,
            "port": svc.port,
            "enabled": svc.enabled,
            "status": "listening" if listening else "stopped",
            "ws_clients": subserver_manager.ws_client_count(),
            "urls": _access_urls(svc.port),
        })

    return {
        "services": services,
        "monitoring": _monitoring_summary(),
        "recent_events": runtime.get_recent_events(since=0)[-20:],
    }


class NetworkServiceUpdate(BaseModel):
    port: int | None = None
    enabled: bool | None = None


@router.put("/api/network/{service}")
async def put_network_service(service: str, req: NetworkServiceUpdate):
    try:
        network_config.update(service, port=req.port, enabled=req.enabled)
    except NetworkConfigError as e:
        raise HTTPException(400, str(e))
    except KeyError:
        raise HTTPException(404, f"Unknown service: {service}")

    await subserver_manager.restart(service)

    svc = network_config.services[service]
    return {
        "name": svc.name,
        "role": svc.role,
        "port": svc.port,
        "enabled": svc.enabled,
        "status": "listening" if subserver_manager.is_running(service) else "stopped",
        "urls": _access_urls(svc.port),
    }
