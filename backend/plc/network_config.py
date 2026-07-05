"""Network service configuration: persists the port/enabled state of the two
"role-scoped" sub-servers (HMI delivery on 8010, visualization delivery on
8020) that run alongside the main development-studio server (8000, started by
the user's own `uvicorn main:app` invocation and never managed by this
module).

See docs/NETWORK.md for the full design. This module only owns the config
file + validation; actually starting/stopping the sub-servers is
`plc/subservers.py`.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from pathlib import Path

# PLC_NETWORK_CONFIG_PATH lets a verification/staging run point at an
# isolated config file instead of the repo's real backend/network_config.json
# (e.g. spinning up a temporary all-different-ports instance for manual curl
# checks without disturbing the real dev server's persisted config).
CONFIG_PATH = Path(os.environ.get("PLC_NETWORK_CONFIG_PATH") or (Path(__file__).resolve().parent.parent / "network_config.json"))

# Ports that must never be assigned to a managed sub-service: 8000 is the
# fixed dev-studio port (started by the user, out of band) and 5173 is the
# Vite dev server used during frontend development.
RESERVED_PORTS = {8000, 5173}

MIN_PORT = 1024
MAX_PORT = 65535

DEFAULT_SERVICES = [
    {"name": "studio", "role": "studio", "port": 8000, "enabled": True},
    {"name": "hmi", "role": "hmi", "port": 8010, "enabled": True},
    {"name": "viz", "role": "viz", "port": 8020, "enabled": True},
]


@dataclass
class ServiceConfig:
    name: str
    role: str  # "studio" | "hmi" | "viz"
    port: int
    enabled: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


class NetworkConfigError(ValueError):
    """Raised for invalid network configuration (bad port range, conflicts)."""


class NetworkConfig:
    """Loads/persists `backend/network_config.json` and validates edits.

    The `studio` entry (port 8000) is informational only -- it always reports
    the fixed dev-studio port and `enabled=True`, since that server's
    lifecycle is entirely owned by however the user launched `main.py`. Only
    `hmi` and `viz` ports/enabled flags can actually be changed via
    `PUT /api/network/{service}`.
    """

    def __init__(self, path: Path | None = None):
        self.path = path or CONFIG_PATH
        self.services: dict[str, ServiceConfig] = {}
        self.load()

    def load(self) -> None:
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                data = None
        else:
            data = None

        if not data or "services" not in data:
            self._reset_defaults()
            self.save()
            return

        services: dict[str, ServiceConfig] = {}
        for entry in data.get("services", []):
            try:
                cfg = ServiceConfig(
                    name=entry["name"],
                    role=entry["role"],
                    port=int(entry["port"]),
                    enabled=bool(entry.get("enabled", True)),
                )
            except (KeyError, TypeError, ValueError):
                continue
            services[cfg.name] = cfg

        # Backfill any missing default services (e.g. config file predates a
        # newly-added role) without clobbering the user's existing settings.
        for default in DEFAULT_SERVICES:
            if default["name"] not in services:
                services[default["name"]] = ServiceConfig(**default)

        self.services = services

    def _reset_defaults(self) -> None:
        self.services = {d["name"]: ServiceConfig(**d) for d in DEFAULT_SERVICES}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"services": [s.to_dict() for s in self.services.values()]}
        self.path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    def get(self, name: str) -> ServiceConfig:
        if name not in self.services:
            raise KeyError(name)
        return self.services[name]

    def validate_update(self, name: str, port: int | None, enabled: bool | None) -> ServiceConfig:
        """Validate a proposed change to `name`'s config, returning what the
        new ServiceConfig *would* be. Raises KeyError if `name` isn't a known
        service (so callers can map that to 404, distinct from a 400
        validation failure), or NetworkConfigError for any other violation.
        Does not mutate state."""
        if name not in self.services:
            raise KeyError(name)
        current = self.services[name]
        if current.role == "studio":
            raise NetworkConfigError("The studio service (port 8000) is managed by the process launcher, not this API")

        new_port = current.port if port is None else int(port)
        new_enabled = current.enabled if enabled is None else bool(enabled)

        if not (MIN_PORT <= new_port <= MAX_PORT):
            raise NetworkConfigError(f"Port must be between {MIN_PORT} and {MAX_PORT}")
        if new_port in RESERVED_PORTS:
            raise NetworkConfigError(f"Port {new_port} is reserved (dev studio / Vite)")
        for other_name, other in self.services.items():
            if other_name != name and other.port == new_port:
                raise NetworkConfigError(f"Port {new_port} is already used by service '{other_name}'")

        return ServiceConfig(name=current.name, role=current.role, port=new_port, enabled=new_enabled)

    def update(self, name: str, port: int | None = None, enabled: bool | None = None) -> ServiceConfig:
        new_cfg = self.validate_update(name, port, enabled)
        self.services[name] = new_cfg
        self.save()
        return new_cfg


network_config = NetworkConfig()
