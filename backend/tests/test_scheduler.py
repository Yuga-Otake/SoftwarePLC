"""Tests for the control/hmi/viz task scheduler (plc/scheduler.py) and the
`/api/resources` endpoint it backs.

The scheduler is driven by an injected `Clock` for *due-time* bookkeeping
(virtual, no real sleeping needed to advance "now"), but per-cycle busy time
is measured with real wall-clock time (`time.perf_counter()`), since that's
what actually represents CPU cost regardless of how fast virtual PLC time is
being advanced. Tests that need to exercise overload/degradation therefore
use tiny real `time.sleep()` calls inside fake task callbacks -- these are on
the order of milliseconds, not seconds, so the suite stays fast.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from plc.clock import VirtualClock  # noqa: E402
from plc.scheduler import TaskScheduler, TaskConfig  # noqa: E402
from plc.runtime import runtime  # noqa: E402
from tests.conftest import load_example_program  # noqa: E402


# ── Pure scheduler unit tests (VirtualClock, no server) ─────────────────────

@pytest.fixture
def clock():
    return VirtualClock(start_ms=0.0)


@pytest.fixture
def scheduler(clock):
    return TaskScheduler(clock)


def test_default_tasks_present_with_expected_defaults(scheduler):
    names = {t["name"] for t in scheduler.snapshot()}
    assert names == {"control", "hmi", "viz"}

    control = scheduler.get_task("control")
    assert control.config.period_ms == 100.0
    assert control.config.cpu_share == 50.0
    assert control.config.protected is True

    hmi = scheduler.get_task("hmi")
    assert hmi.config.period_ms == 100.0
    assert hmi.config.cpu_share == 30.0
    assert hmi.config.protected is False

    viz = scheduler.get_task("viz")
    assert viz.config.period_ms == 500.0
    assert viz.config.cpu_share == 20.0
    assert viz.config.protected is False


async def test_tasks_run_on_configured_period(scheduler, clock):
    counts = {"control": 0, "hmi": 0, "viz": 0}

    async def make_cb(name):
        async def cb():
            counts[name] += 1
        return cb

    for name in counts:
        scheduler.set_callback(name, await make_cb(name))

    # Advance in 100ms steps, ticking each time -- over 1000ms (10 ticks):
    #   control (period 100ms) should run ~10 times
    #   hmi     (period 100ms) should run ~10 times
    #   viz     (period 500ms) should run ~2 times
    for _ in range(10):
        clock.advance_ms(100)
        await scheduler.tick()

    assert counts["control"] == 10
    assert counts["hmi"] == 10
    assert counts["viz"] == 2


async def test_utilization_measured_from_busy_time(scheduler, clock):
    """A task whose callback takes ~50% of its period should settle on
    roughly 50% utilization (moving average)."""
    async def slow_control():
        time.sleep(0.05)  # 50ms of real busy time

    scheduler.update_config("control", period_ms=100.0)
    scheduler.set_callback("control", slow_control)
    scheduler.set_callback("hmi", _noop)
    scheduler.set_callback("viz", _noop)

    for _ in range(5):
        clock.advance_ms(100)
        await scheduler.tick()

    util = scheduler.get_task("control").utilization_pct
    assert 30.0 < util < 80.0, f"expected ~50% utilization, got {util}"


async def test_put_resources_changes_effective_period_immediately(scheduler, clock):
    """A manual period change (simulating PUT /api/resources) should reset
    any prior degradation and take effect immediately, matching the '設定周期
    と実効周期を区別して保持・公開する' requirement."""
    scheduler.set_callback("hmi", _noop)
    scheduler.set_callback("control", _noop)
    scheduler.set_callback("viz", _noop)

    scheduler.update_config("hmi", period_ms=200.0)
    hmi = scheduler.get_task("hmi")
    assert hmi.config.period_ms == 200.0
    assert hmi.effective_period_ms == 200.0
    assert hmi.degraded is False


async def test_overload_degrades_hmi_and_viz_but_protects_control(scheduler, clock):
    """When hmi/viz callbacks are artificially slow (each exceeding its own
    cpu_share), the degrade policy should stretch their *effective* period
    while leaving control's configured period untouched -- "制御優先"."""
    async def control_cb():
        time.sleep(0.01)  # light: 10ms / 100ms period = 10%

    async def heavy_hmi():
        time.sleep(0.08)  # 80ms -- way over hmi's 30% share of a 100ms period

    async def heavy_viz():
        time.sleep(0.4)  # 400ms -- over viz's 20% share of a 500ms period

    scheduler.set_callback("control", control_cb)
    scheduler.set_callback("hmi", heavy_hmi)
    scheduler.set_callback("viz", heavy_viz)

    control_period_before = scheduler.get_task("control").config.period_ms

    # Run enough ticks for the degrade policy to kick in and stretch the
    # effective periods (each tick only runs currently-due tasks, so advance
    # far enough that both hmi and viz become due repeatedly).
    for _ in range(20):
        clock.advance_ms(100)
        await scheduler.tick()

    hmi = scheduler.get_task("hmi")
    viz = scheduler.get_task("viz")
    control = scheduler.get_task("control")

    assert hmi.effective_period_ms > hmi.config.period_ms, "hmi should be degraded (stretched)"
    assert hmi.degraded is True
    assert viz.effective_period_ms > viz.config.period_ms, "viz should be degraded (stretched)"
    assert viz.degraded is True

    # control is protected: its *configured* period is never touched by the
    # degrade policy (only hmi/viz effective periods are stretched).
    assert control.config.period_ms == control_period_before
    assert control.config.protected is True


async def test_degraded_task_recovers_when_load_drops(scheduler, clock):
    async def heavy_hmi():
        time.sleep(0.08)

    scheduler.set_callback("control", _noop)
    scheduler.set_callback("hmi", heavy_hmi)
    scheduler.set_callback("viz", _noop)

    for _ in range(10):
        clock.advance_ms(100)
        await scheduler.tick()
    hmi = scheduler.get_task("hmi")
    assert hmi.degraded is True
    stretched_period = hmi.effective_period_ms

    # Now make hmi cheap again and let it recover.
    scheduler.set_callback("hmi", _noop)
    for _ in range(30):
        clock.advance_ms(100)
        await scheduler.tick()

    hmi = scheduler.get_task("hmi")
    assert hmi.effective_period_ms < stretched_period
    assert hmi.effective_period_ms == pytest.approx(hmi.config.period_ms, abs=1.0)
    assert hmi.degraded is False


async def _noop():
    pass


# ── API tests (FastAPI TestClient, in-process) ──────────────────────────────

@pytest.fixture
def client():
    from main import app

    runtime.load_program(load_example_program())
    with TestClient(app) as c:
        yield c


def test_get_resources_shape(client):
    resp = client.get("/api/resources")
    assert resp.status_code == 200
    body = resp.json()
    assert "tasks" in body
    names = {t["name"] for t in body["tasks"]}
    assert names == {"control", "hmi", "viz"}
    for t in body["tasks"]:
        assert set(t.keys()) >= {
            "name", "period_ms", "effective_period_ms", "cpu_share",
            "protected", "utilization_pct", "run_count", "degraded",
        }


def test_put_resources_updates_period_and_share(client):
    resp = client.put("/api/resources", json={
        "tasks": [{"name": "hmi", "period_ms": 250.0, "cpu_share": 40.0}],
    })
    assert resp.status_code == 200
    body = resp.json()
    hmi = next(t for t in body["tasks"] if t["name"] == "hmi")
    assert hmi["period_ms"] == 250.0
    assert hmi["effective_period_ms"] == 250.0
    assert hmi["cpu_share"] == 40.0

    # Persisted: a follow-up GET reflects the same values.
    resp2 = client.get("/api/resources")
    hmi2 = next(t for t in resp2.json()["tasks"] if t["name"] == "hmi")
    assert hmi2["period_ms"] == 250.0
    assert hmi2["cpu_share"] == 40.0


def test_put_resources_control_share_protected(client):
    """control's cpu_share should not be overridden away from what the
    degrade policy relies on to treat it as protected -- the endpoint
    silently ignores cpu_share for control while still allowing period
    changes (which map back onto legacy scan_interval_ms)."""
    before = client.get("/api/resources").json()
    control_share_before = next(t for t in before["tasks"] if t["name"] == "control")["cpu_share"]

    resp = client.put("/api/resources", json={
        "tasks": [{"name": "control", "period_ms": 150.0, "cpu_share": 5.0}],
    })
    assert resp.status_code == 200
    body = resp.json()
    control = next(t for t in body["tasks"] if t["name"] == "control")
    assert control["period_ms"] == 150.0
    assert control["protected"] is True
    assert control["cpu_share"] == control_share_before

    assert runtime.scan_interval_ms == 150.0


def test_put_resources_unknown_task_400(client):
    resp = client.put("/api/resources", json={"tasks": [{"name": "bogus", "period_ms": 100}]})
    assert resp.status_code == 400


def test_get_signals_lists_known_paths(client):
    resp = client.get("/api/signals")
    assert resp.status_code == 200
    body = resp.json()
    paths = {s["path"] for s in body}
    assert "y_motor.OUT" in paths
    assert "ton1.ET" in paths
    ton_et = next(s for s in body if s["path"] == "ton1.ET")
    assert ton_et["data_type"] == "number"
    y_motor = next(s for s in body if s["path"] == "y_motor.OUT")
    assert y_motor["data_type"] == "bool"


def test_viz_history_since_ms_filter(client):
    # Drive a few real scans so the (real-clock) viz task has a chance to
    # sample at least once, then read back the ring buffer.
    import time as _time
    deadline = _time.time() + 2.0
    samples = []
    while _time.time() < deadline:
        resp = client.get("/api/viz/history", params={"signal": "y_motor.OUT", "since_ms": 0})
        samples = resp.json()["samples"]
        if samples:
            break
        _time.sleep(0.05)
    assert resp.status_code == 200
    assert isinstance(samples, list)
    assert len(samples) >= 1
    assert set(samples[0].keys()) == {"t", "value"}

    # since_ms far in the future should filter everything out.
    resp2 = client.get("/api/viz/history", params={"signal": "y_motor.OUT", "since_ms": 9e15})
    assert resp2.json()["samples"] == []


def test_hmi_screen_save_and_load_roundtrip(client, tmp_path, monkeypatch):
    import api.routes as routes_mod
    monkeypatch.setattr(routes_mod, "HMI_SCREENS_DIR", tmp_path)

    screen = {
        "name": "test_screen",
        "widgets": [
            {"id": "w1", "type": "lamp", "x": 10, "y": 10, "w": 40, "h": 40, "signal": "y_motor.OUT", "label": "Motor"},
        ],
    }
    put_resp = client.put("/api/hmi/screens/test_screen", json=screen)
    assert put_resp.status_code == 200

    list_resp = client.get("/api/hmi/screens")
    assert list_resp.status_code == 200
    assert "test_screen" in list_resp.json()

    get_resp = client.get("/api/hmi/screens/test_screen")
    assert get_resp.status_code == 200
    assert get_resp.json() == screen


def test_hmi_screen_not_found(client, tmp_path, monkeypatch):
    import api.routes as routes_mod
    monkeypatch.setattr(routes_mod, "HMI_SCREENS_DIR", tmp_path)
    resp = client.get("/api/hmi/screens/does_not_exist")
    assert resp.status_code == 404


def test_hmi_screen_rejects_unsafe_name(client, tmp_path, monkeypatch):
    import api.routes as routes_mod
    monkeypatch.setattr(routes_mod, "HMI_SCREENS_DIR", tmp_path)

    # Encoded-slash traversal: the ASGI layer decodes %2f before routing, so
    # the multi-segment path no longer matches `{name}` ([^/]+) and falls
    # through to the root StaticFiles mount, which rejects PUT with 405.
    # Any of 400/404/405 is a rejection; the real invariant is that nothing
    # gets written to disk.
    resp = client.put("/api/hmi/screens/..%2f..%2fetc", json={"widgets": []})
    assert resp.status_code in (400, 404, 405)
    assert list(tmp_path.iterdir()) == []

    # Encoded-dot traversal (%2e%2e -> "..") stays a single segment, so it
    # *does* reach the handler and must be rejected by _SAFE_NAME_RE.
    resp = client.put("/api/hmi/screens/%2e%2e", json={"widgets": []})
    assert resp.status_code == 400
    assert list(tmp_path.iterdir()) == []


def test_hmi_screen_rejects_non_list_widgets(client, tmp_path, monkeypatch):
    """Regression test for BUG-003: a screen saved with `widgets` as a
    non-list (string/object/number) must be rejected with 400, not silently
    persisted -- both the React HMI builder and the standalone hmi.html page
    assume `widgets` is array-like and would throw/white-screen on load
    otherwise."""
    import api.routes as routes_mod
    monkeypatch.setattr(routes_mod, "HMI_SCREENS_DIR", tmp_path)

    resp = client.put("/api/hmi/screens/bad_widgets", json={"widgets": "not-an-array"})
    assert resp.status_code == 400

    resp2 = client.put("/api/hmi/screens/bad_widgets2", json={"widgets": {"foo": "bar"}})
    assert resp2.status_code == 400

    # A missing `widgets` key entirely is fine (frontend treats it as empty).
    resp3 = client.put("/api/hmi/screens/no_widgets_key", json={"name": "x"})
    assert resp3.status_code == 200
    client.delete("/api/hmi/screens/no_widgets_key")

    # A proper empty list is fine too.
    resp4 = client.put("/api/hmi/screens/empty_widgets", json={"widgets": []})
    assert resp4.status_code == 200
    client.delete("/api/hmi/screens/empty_widgets")


def test_put_resources_period_zero_and_negative_clamped(client):
    """period_ms=0 or negative must not crash the endpoint; the scheduler
    clamps to a minimum of 1ms rather than producing a zero/negative period
    (which would otherwise make the task perpetually due every tick)."""
    resp = client.put("/api/resources", json={"tasks": [{"name": "hmi", "period_ms": 0}]})
    assert resp.status_code == 200
    hmi = next(t for t in resp.json()["tasks"] if t["name"] == "hmi")
    assert hmi["period_ms"] >= 1.0

    resp2 = client.put("/api/resources", json={"tasks": [{"name": "hmi", "period_ms": -50}]})
    assert resp2.status_code == 200
    hmi2 = next(t for t in resp2.json()["tasks"] if t["name"] == "hmi")
    assert hmi2["period_ms"] >= 1.0

    # Restore a sane period so later tests in this module aren't affected.
    client.put("/api/resources", json={"tasks": [{"name": "hmi", "period_ms": 100.0}]})


def test_put_resources_period_one_ms_accepted(client):
    resp = client.put("/api/resources", json={"tasks": [{"name": "viz", "period_ms": 1}]})
    assert resp.status_code == 200
    viz = next(t for t in resp.json()["tasks"] if t["name"] == "viz")
    assert viz["period_ms"] == 1.0
    client.put("/api/resources", json={"tasks": [{"name": "viz", "period_ms": 500.0}]})


def test_put_resources_cpu_share_sum_over_100_not_rejected(client):
    """The endpoint does not enforce that cpu_share sums to <=100 across
    tasks -- each task's share is independently clamped to [0, 100], and the
    degrade policy operates on *measured* utilization, not the configured
    shares, so an over-100 sum is a valid (if optimistic) configuration
    rather than an error. Documents this intentional lack of cross-task
    validation."""
    resp = client.put("/api/resources", json={
        "tasks": [{"name": "hmi", "cpu_share": 70.0}, {"name": "viz", "cpu_share": 70.0}],
    })
    assert resp.status_code == 200
    shares = {t["name"]: t["cpu_share"] for t in resp.json()["tasks"]}
    assert shares["hmi"] == 70.0
    assert shares["viz"] == 70.0
    # Restore defaults.
    client.put("/api/resources", json={
        "tasks": [{"name": "hmi", "cpu_share": 30.0}, {"name": "viz", "cpu_share": 20.0}],
    })


def test_viz_history_unknown_signal_returns_empty_not_error(client):
    resp = client.get("/api/viz/history", params={"signal": "no_such_node.OUT"})
    assert resp.status_code == 200
    assert resp.json()["samples"] == []


# ── PLCRuntime._hmi_task broadcast payload (BUG-008 regression) ────────────
# `_hmi_task` is the periodic (control/hmi/viz-scheduler-driven) push that's
# supposed to keep every connected WebSocket client's live node/output state
# in sync between scans -- distinct from the one-off initial snapshot sent by
# the /ws endpoint on connect (api/routes.py), which uses the same
# `get_broadcast_state()` method directly and was therefore unaffected. A
# stale method name (`_runtime_state_for_broadcast`, which never existed) in
# `_hmi_task`'s payload construction meant every periodic push raised
# AttributeError, silently swallowed by `_hmi_task`'s bare `except Exception:
# pass` -- so `broadcast_callback` was *never actually invoked* after the
# initial per-connection snapshot. This went unnoticed because most tab UIs
# poll over HTTP independently and a full page reload always re-fetches a
# fresh one-shot snapshot; it surfaced as "devices/wires never animate
# live" while building the simulation tab (docs/QA_LOG.md).

async def test_hmi_task_broadcasts_current_runtime_state():
    """Regression test for BUG-008: _hmi_task's payload must actually carry
    the live per-node output state (not silently fail to build it)."""
    from plc.runtime import PLCRuntime

    clock = VirtualClock(start_ms=0.0)
    rt = PLCRuntime(clock=clock)
    rt.load_program(load_example_program())

    received: list[dict] = []

    async def fake_broadcast(payload: dict):
        received.append(payload)

    rt.broadcast_callback = fake_broadcast
    rt.set_io("x_start", True)
    await rt.run_scan()  # commit at least one scan so _current_outputs is populated
    await rt._hmi_task()

    assert len(received) == 1
    payload = received[0]
    assert payload["type"] == "state_update"
    assert "runtime" in payload
    # Must match get_broadcast_state() exactly -- the bug produced an empty
    # broadcast (the whole callback silently never ran) rather than a
    # differently-shaped one, so the strongest assertion is "did it run at
    # all and match the real state".
    assert payload["runtime"] == rt.get_broadcast_state()
    assert payload["runtime"]["x_start"]["OUT"] is True


async def test_hmi_task_broadcast_reflects_output_changes_across_scans():
    """A second, independent check that _hmi_task's runtime payload tracks
    an *output* (not just an input echo) across multiple scans -- this is
    exactly the live-wire-highlighting / device-animation path that BUG-008
    silently broke."""
    from plc.runtime import PLCRuntime

    clock = VirtualClock(start_ms=0.0)
    rt = PLCRuntime(clock=clock)
    rt.load_program(load_example_program())

    payloads: list[dict] = []

    async def fake_broadcast(payload: dict):
        payloads.append(payload)

    rt.broadcast_callback = fake_broadcast

    rt.set_io("x_start", True)
    rt.set_io("x_stop", True)  # hold the SR latch (R = NOT(x_stop))
    await rt.run_scan()
    await rt._hmi_task()
    assert payloads[-1]["runtime"]["y_motor"]["OUT"] is True

    rt.set_io("x_start", False)
    rt.set_io("x_stop", False)
    await rt.run_scan()
    await rt._hmi_task()
    assert payloads[-1]["runtime"]["y_motor"]["OUT"] is False
