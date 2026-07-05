"""Manages the lifecycle of the role-scoped sub-servers (HMI on 8010, viz on
8020 by default) as `uvicorn.Server` instances running inside the *same*
asyncio event loop / process as the main dev-studio app (port 8000). See
docs/NETWORK.md for the overall "one process, multiple ports" architecture.

Each sub-server is a full second (or third) ASGI app + TCP listener, started
via `server.serve()` wrapped in `asyncio.create_task(...)`, exactly like you'd
run `uvicorn.run()` but non-blocking and re-startable. Restarting a service
(e.g. after a port change from `PUT /api/network/{service}`) tears down its
`asyncio.Task` (uvicorn's graceful `should_exit` + task cancellation) and
starts a fresh `Server` bound to the new port.
"""
from __future__ import annotations

import asyncio
import logging

import uvicorn

from plc.network_config import NetworkConfig, network_config
from api.subapps import build_hmi_app, build_viz_app

logger = logging.getLogger("plc.subservers")

_APP_BUILDERS = {
    "hmi": build_hmi_app,
    "viz": build_viz_app,
}


class ManagedSubserver:
    """One running (or stopped) `uvicorn.Server` + its driving asyncio task."""

    def __init__(self, name: str):
        self.name = name
        self.server: uvicorn.Server | None = None
        self.task: asyncio.Task | None = None
        self.port: int | None = None

    @property
    def running(self) -> bool:
        return self.server is not None and self.task is not None and not self.task.done()

    async def start(self, port: int):
        if self.running:
            await self.stop()
        builder = _APP_BUILDERS[self.name]
        app = builder()
        config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="warning", loop="asyncio")
        server = uvicorn.Server(config)
        # uvicorn installs SIGINT/SIGTERM handlers by default; harmless but
        # unnecessary for a sub-server managed by the parent process, and
        # signal handlers can only be installed from the main thread's loop
        # once -- avoid clobbering the primary server's handlers.
        server.install_signal_handlers = False
        self.server = server
        self.port = port
        self.task = asyncio.create_task(server.serve(), name=f"subserver-{self.name}")
        # Give the server a brief moment to actually bind, so callers that
        # immediately probe the port (tests, curl right after PUT) don't race
        # the listener socket coming up.
        for _ in range(200):
            if server.started:
                break
            await asyncio.sleep(0.01)

    async def stop(self):
        if self.server is not None:
            self.server.should_exit = True
        if self.task is not None:
            try:
                await asyncio.wait_for(self.task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self.task.cancel()
                try:
                    await self.task
                except (asyncio.CancelledError, Exception):
                    pass
        self.server = None
        self.task = None


class SubserverManager:
    """Owns one `ManagedSubserver` per configured role ("hmi", "viz") and
    (re)starts them to match `NetworkConfig`."""

    def __init__(self, config: NetworkConfig | None = None):
        self.config = config or network_config
        self.subservers: dict[str, ManagedSubserver] = {
            name: ManagedSubserver(name) for name in _APP_BUILDERS
        }

    async def start_all(self):
        for name, sub in self.subservers.items():
            svc = self.config.services.get(name)
            if svc is not None and svc.enabled:
                try:
                    await sub.start(svc.port)
                except OSError as e:
                    # Most likely a Windows firewall prompt/deny or the port
                    # already being in use outside our config -- log and
                    # leave the service marked stopped rather than crashing
                    # the whole app startup.
                    logger.warning("Failed to start %s sub-server on port %s: %s", name, svc.port, e)

    async def stop_all(self):
        for sub in self.subservers.values():
            await sub.stop()

    async def restart(self, name: str):
        """Restart (or start/stop as needed) the named sub-server to match
        its current config -- used after `PUT /api/network/{service}`."""
        if name not in self.subservers:
            return
        sub = self.subservers[name]
        svc = self.config.services.get(name)
        await sub.stop()
        if svc is not None and svc.enabled:
            await sub.start(svc.port)

    def is_running(self, name: str) -> bool:
        sub = self.subservers.get(name)
        return sub.running if sub else False

    def ws_client_count(self) -> int:
        """All three ports share the single `ConnectionManager` (api/ws.py),
        so this is a process-wide connected-client count rather than
        per-port -- see docs/NETWORK.md for why per-port breakdown isn't
        tracked separately."""
        from api.ws import manager
        return len(manager._connections)


subserver_manager = SubserverManager()
