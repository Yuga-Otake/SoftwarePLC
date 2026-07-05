"""Tests for the network management module (backend/plc/network_config.py,
backend/api/subapps.py, backend/api/network_routes.py) -- see
docs/NETWORK.md.

Covers:
- Config generation/load/persistence, including validation (duplicate ports,
  out-of-range ports, reserved ports).
- Role scoping: the HMI sub-app (port 8010 by default) does NOT expose debug
  APIs or program/resource-editing endpoints; the viz sub-app (8020) does NOT
  expose I/O writes -- verified by mounting each ASGI app directly in a
  `TestClient`, no real socket/port needed for this part.
- `GET /api/network` response shape on the main app (services + monitoring
  summary + recent_events), including after a `PUT` port change.

These tests do NOT start real uvicorn sub-servers (that's covered by manual
curl verification in the task's real-port check) -- they exercise the ASGI
apps in-process via TestClient, which is faster and deterministic.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from plc.network_config import NetworkConfig, NetworkConfigError, DEFAULT_SERVICES  # noqa: E402
from plc.runtime import runtime  # noqa: E402
from tests.conftest import load_example_program  # noqa: E402


# ── Config: generation / load / validation ──────────────────────────────────

def test_default_config_generated_when_missing(tmp_path):
    path = tmp_path / "network_config.json"
    assert not path.exists()
    cfg = NetworkConfig(path=path)
    assert path.exists()
    names = {s.name for s in cfg.services.values()}
    assert names == {d["name"] for d in DEFAULT_SERVICES}
    assert cfg.services["studio"].port == 8000
    assert cfg.services["hmi"].port == 8010
    assert cfg.services["viz"].port == 8020
    assert all(s.enabled for s in cfg.services.values())


def test_config_persists_and_reloads(tmp_path):
    path = tmp_path / "network_config.json"
    cfg = NetworkConfig(path=path)
    cfg.update("hmi", port=9010)
    cfg.update("viz", enabled=False)

    reloaded = NetworkConfig(path=path)
    assert reloaded.services["hmi"].port == 9010
    assert reloaded.services["viz"].enabled is False
    # Untouched service survives the round trip too.
    assert reloaded.services["viz"].port == 8020


def test_config_backfills_missing_service(tmp_path):
    path = tmp_path / "network_config.json"
    path.write_text(json.dumps({"services": [
        {"name": "studio", "role": "studio", "port": 8000, "enabled": True},
    ]}), encoding="utf-8")
    cfg = NetworkConfig(path=path)
    assert "hmi" in cfg.services
    assert "viz" in cfg.services
    assert cfg.services["hmi"].port == 8010


def test_reject_duplicate_port(tmp_path):
    cfg = NetworkConfig(path=tmp_path / "network_config.json")
    with pytest.raises(NetworkConfigError):
        cfg.update("hmi", port=8020)  # collides with viz


def test_reject_out_of_range_port(tmp_path):
    cfg = NetworkConfig(path=tmp_path / "network_config.json")
    with pytest.raises(NetworkConfigError):
        cfg.update("hmi", port=80)  # below MIN_PORT
    with pytest.raises(NetworkConfigError):
        cfg.update("hmi", port=70000)  # above MAX_PORT


def test_reject_reserved_port(tmp_path):
    cfg = NetworkConfig(path=tmp_path / "network_config.json")
    with pytest.raises(NetworkConfigError):
        cfg.update("hmi", port=8000)  # dev studio
    with pytest.raises(NetworkConfigError):
        cfg.update("viz", port=5173)  # vite dev server


def test_reject_editing_studio_service(tmp_path):
    cfg = NetworkConfig(path=tmp_path / "network_config.json")
    with pytest.raises(NetworkConfigError):
        cfg.update("studio", port=8001)


def test_unknown_service_raises_keyerror(tmp_path):
    cfg = NetworkConfig(path=tmp_path / "network_config.json")
    with pytest.raises(KeyError):
        cfg.update("nonexistent", port=9000)


def test_valid_port_change_applies(tmp_path):
    cfg = NetworkConfig(path=tmp_path / "network_config.json")
    updated = cfg.update("hmi", port=8011, enabled=False)
    assert updated.port == 8011
    assert updated.enabled is False
    assert cfg.services["hmi"].port == 8011


# ── Role scoping: HMI sub-app must NOT expose debug/program/resource APIs ──

@pytest.fixture
def hmi_client():
    from api.subapps import build_hmi_app
    runtime.load_program(load_example_program())
    app = build_hmi_app()
    with TestClient(app) as c:
        yield c


def test_hmi_app_exposes_expected_routes(hmi_client):
    assert hmi_client.get("/").status_code == 200
    assert hmi_client.get("/api/hmi/screens").status_code == 200
    assert hmi_client.get("/api/io").status_code == 200
    assert hmi_client.get("/api/signals").status_code == 200


def test_hmi_app_io_write_works(hmi_client):
    resp = hmi_client.post("/api/io/x_start", json={"value": True})
    assert resp.status_code == 200
    assert hmi_client.get("/api/io").json().get("x_start") is True


def test_hmi_app_has_no_debug_api(hmi_client):
    assert hmi_client.get("/api/debug/state").status_code == 404
    assert hmi_client.get("/api/debug/events").status_code == 404


def test_hmi_app_has_no_program_editing(hmi_client):
    assert hmi_client.get("/api/program").status_code == 404
    assert hmi_client.put("/api/program", json={"nodes": [], "edges": []}).status_code == 404
    assert hmi_client.post("/api/program/nodes", json={"type": "SR"}).status_code == 404


def test_hmi_app_has_no_resources_or_screen_mutation(hmi_client):
    assert hmi_client.get("/api/resources").status_code == 404
    assert hmi_client.put("/api/resources", json={"tasks": []}).status_code == 404
    # /api/hmi/screens/{name} GET *is* published (read-only screen fetch), so
    # PUT/DELETE on that same path come back as 405 Method Not Allowed rather
    # than 404 -- either way, the mutation is not possible on this app.
    assert hmi_client.put("/api/hmi/screens/main", json={"widgets": []}).status_code in (404, 405)
    assert hmi_client.delete("/api/hmi/screens/main").status_code in (404, 405)


def test_hmi_app_has_no_network_api(hmi_client):
    assert hmi_client.get("/api/network").status_code == 404


# ── Role scoping: viz sub-app must be read-only (no I/O writes, no editing) ─

@pytest.fixture
def viz_client():
    from api.subapps import build_viz_app
    runtime.load_program(load_example_program())
    app = build_viz_app()
    with TestClient(app) as c:
        yield c


def test_viz_app_exposes_expected_routes(viz_client):
    assert viz_client.get("/").status_code == 200
    assert viz_client.get("/api/program").status_code == 200
    assert viz_client.get("/api/resources").status_code == 200
    assert viz_client.get("/api/signals").status_code == 200
    resp = viz_client.get("/api/viz/history", params={"signal": "y_motor.OUT"})
    assert resp.status_code == 200
    assert resp.json()["signal"] == "y_motor.OUT"


def test_viz_app_rejects_io_write(viz_client):
    resp = viz_client.post("/api/io/x_start", json={"value": True})
    assert resp.status_code in (404, 405)


def test_viz_app_rejects_io_read(viz_client):
    # /api/io (GET) is also a write-adjacent surface (mirrors current I/O
    # panel state) -- viz is read-only for *program state*, not I/O control,
    # so it's intentionally not registered at all on this app.
    assert viz_client.get("/api/io").status_code == 404


def test_viz_app_has_no_debug_or_program_editing(viz_client):
    assert viz_client.get("/api/debug/state").status_code == 404
    # /api/program GET *is* published (read-only, for the status board), so
    # PUT on that same path is 405 rather than 404 -- either way, not editable.
    assert viz_client.put("/api/program", json={"nodes": [], "edges": []}).status_code in (404, 405)
    # /api/resources GET is also published read-only on viz; PUT is 405.
    assert viz_client.put("/api/resources", json={"tasks": []}).status_code in (404, 405)


def test_viz_app_has_no_hmi_screen_api(viz_client):
    assert viz_client.get("/api/hmi/screens").status_code == 404


def test_viz_app_has_no_network_api(viz_client):
    assert viz_client.get("/api/network").status_code == 404


# ── GET /api/network response shape (on the main app) ───────────────────────

@pytest.fixture
def main_client(tmp_path, monkeypatch):
    """Main app's TestClient, with PLC_DISABLE_SUBSERVERS set (via
    tests/conftest.py's os.environ.setdefault, already in effect for the
    whole suite) so this doesn't bind real 8010/8020 ports -- we're only
    checking the /api/network response *shape* here, not the real sub-server
    lifecycle (covered separately by manual curl verification).

    Redirects the global `network_config` singleton's backing file to a
    temp path for the duration of the test, so `PUT /api/network/*` calls
    below don't mutate the repo's real `backend/network_config.json`."""
    from plc.network_config import network_config

    monkeypatch.setattr(network_config, "path", tmp_path / "network_config.json")
    network_config._reset_defaults()
    network_config.save()

    from main import app

    runtime.load_program(load_example_program())
    with TestClient(app) as c:
        yield c

    # Restore in-memory state so later tests (or a real server reload) see
    # the actual on-disk config again rather than the test's temp defaults.
    network_config.load()


def test_get_network_shape(main_client):
    resp = main_client.get("/api/network")
    assert resp.status_code == 200
    body = resp.json()
    assert "services" in body and "monitoring" in body and "recent_events" in body

    services = {s["name"]: s for s in body["services"]}
    assert set(services.keys()) == {"studio", "hmi", "viz"}
    for name, svc in services.items():
        assert set(svc.keys()) >= {"name", "role", "port", "enabled", "status", "ws_clients", "urls"}
        assert svc["status"] in ("listening", "stopped")
        assert "localhost" in svc["urls"] and "lan" in svc["urls"]

    assert services["studio"]["port"] == 8000
    assert services["studio"]["status"] == "listening"

    monitoring = body["monitoring"]
    assert set(monitoring.keys()) >= {
        "program_name", "running", "scan_index", "last_cycle_time_ms", "node_count", "tasks",
    }
    assert isinstance(monitoring["tasks"], list)
    assert isinstance(body["recent_events"], list)


def test_put_network_rejects_invalid_port(main_client):
    resp = main_client.put("/api/network/hmi", json={"port": 80})
    assert resp.status_code == 400


def test_put_network_rejects_port_collision(main_client):
    resp = main_client.put("/api/network/hmi", json={"port": 8020})
    assert resp.status_code == 400


def test_put_network_rejects_reserved_port(main_client):
    resp = main_client.put("/api/network/viz", json={"port": 8000})
    assert resp.status_code == 400


def test_put_network_unknown_service_404s(main_client):
    resp = main_client.put("/api/network/nonexistent", json={"port": 9000})
    assert resp.status_code == 404


def test_put_network_studio_rejected(main_client):
    resp = main_client.put("/api/network/studio", json={"port": 8001})
    assert resp.status_code == 400
