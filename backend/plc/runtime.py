import asyncio
import os
import time
from collections import deque
from typing import Any, Callable, Awaitable

import psutil

from .clock import Clock, RealClock
from .graph import PLCGraph
from .models import ProgramGraph, ScanMetrics, StateEvent, PendingOperation, VariableDefinition
from .scheduler import TaskScheduler


def _default_for_type(var_type: str) -> Any:
    return 0.0 if var_type == "number" else False


def _coerce_to_type(value: Any, var_type: str) -> Any:
    """Coerce an incoming value (e.g. from a force-write API call, or a
    program JSON's `initial`) to the variable's declared type, tolerating
    the usual JSON looseness (numbers-as-strings, bools-as-0/1, etc.)."""
    if var_type == "number":
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
    return bool(value)


class PLCRuntime:
    def __init__(self, clock: Clock | None = None):
        self.clock: Clock = clock or RealClock()
        self._graph = PLCGraph(ProgramGraph())
        self._program: ProgramGraph = ProgramGraph()
        self._node_states: dict[str, dict] = {}
        self._current_outputs: dict[str, dict[str, Any]] = {}
        self._io_values: dict[str, Any] = {}

        # ── Internal ("work") variables (M/D-style) — see docs/VARIABLES.md.
        # `_variables` holds the definitions (name/type/initial/comment);
        # `_var_values` is the live value store, the SAME dict object handed
        # to PLCGraph.execute() every scan so VAR_READ/VAR_WRITE nodes see
        # writes made earlier in the same scan and across scans.
        self._variables: dict[str, VariableDefinition] = {}
        self._var_values: dict[str, Any] = {}

        self.scan_interval_ms: float = 100.0
        self.history_seconds: float = 60.0

        # {node_id: {port_name: deque[(ts, value)]}}
        self._history: dict[str, dict[str, deque]] = {}
        self._event_log: deque[StateEvent] = deque(maxlen=10000)
        self._metrics_history: deque[ScanMetrics] = deque(maxlen=600)
        self._scan_index: int = 0

        # Flat ring buffer of individual signal-level transitions (one entry
        # per changed I/O/node output port), consumed by the debug API and
        # mirrored by the scenario runner's JSONL output. Distinct from
        # `_event_log`, which groups changes per-node per-scan.
        self._transition_events: deque[dict] = deque(maxlen=1000)
        self._transition_seq: int = 0

        # AI Human-in-the-Loop pending ops
        self.pending_ops: list[PendingOperation] = []

        self.broadcast_callback: Callable[[dict], Awaitable[None]] | None = None

        self._running = False
        self._task: asyncio.Task | None = None
        self._process = psutil.Process(os.getpid())

        # ── Task scheduler (control/hmi/viz CPU budgeting) ────────────────
        # `control` still drives the scan cycle itself (via run_scan, same as
        # before); `hmi` and `viz` are new periodic tasks layered on top, all
        # driven from the same clock so tests can use a VirtualClock.
        self.scheduler = TaskScheduler(self.clock)
        self.scheduler.set_callback("control", self.run_scan)
        self.scheduler.set_callback("hmi", self._hmi_task)
        self.scheduler.set_callback("viz", self._viz_task)

        # Per-signal ring buffer for trend history, independent of the
        # per-node `_history` above (which is keyed by scan rate). Keyed by
        # "node_id.port" signal path. Populated by the `viz` task at its own
        # (possibly degraded) sampling rate.
        self.viz_history_seconds: float = 300.0  # ~5 min retention target
        self._viz_history: dict[str, deque[tuple[float, Any]]] = {}
        self._viz_max_samples = 2000

        # Latest per-scan diff / custom-block status, surfaced by `_hmi_task`
        # on its own (possibly degraded) schedule rather than every scan.
        self._last_changes: dict[str, dict[str, Any]] = {}
        self._last_custom_block_status: dict[str, dict] = {}

        # Optional hook invoked at the end of every `run_scan()`, after the
        # scan cycle has committed its outputs -- used by the simulation tab
        # (see plc/simulation.py::FeedbackRuleEngine) to evaluate the active
        # rig's `feedback_rules` deterministically on every scan, same as the
        # live server's control task. None by default (no simulation rig
        # active / tests that don't care about it).
        self.post_scan_hook: Callable[[], None] | None = None

        # Optional hook returning the simulation tab's dynamic physics state
        # (jig positions / position_sensor flags, see
        # plc/simulation.py::SimulationManager.sim_state) for the `hmi` task
        # to piggy-back onto its WS broadcast (see `_hmi_task` below) so the
        # frontend's conveyor/jig animation can run at WS cadence instead of
        # a separate poll. Kept as an injectable hook (not a direct import)
        # so this module stays simulation-agnostic, same reasoning as
        # `post_scan_hook`. None by default -> `_hmi_task` omits `sim_state`.
        self.sim_state_provider: Callable[[], dict] | None = None

        # Name of the example program (`examples/<name>.json`) last loaded via
        # `POST /api/program/examples/{name}/load`, or None if unknown (raw
        # `PUT /api/program` edits, or a program built up node-by-node in the
        # UI never had a "name" to begin with). Used purely for display/
        # diagnostics -- e.g. the simulation tab's exam-preflight check (see
        # plc/simulation.py::SimulationManager.preflight_exam, BUG-009 in
        # docs/QA_LOG.md) reports this so an operator can tell at a glance
        # whether the currently-loaded program matches a rig's
        # `target_program`. NOT part of ProgramGraph itself (that model has
        # no `name` field) -- purely runtime-side bookkeeping.
        self.current_program_name: str | None = None

    # ── Program management ──────────────────────────────────────────────

    def load_program(self, program: ProgramGraph, program_name: str | None = None):
        self._program = program
        self._graph = PLCGraph(program)
        self._node_states = {}
        self._current_outputs = {}
        self._history = {}
        self._io_values = {}
        self._viz_history = {}
        # Defaults to None (unknown) unless the caller passes an explicit
        # name -- see `current_program_name` above. A raw `PUT /api/program`
        # (hand-edited graph) intentionally clears any previously-known name
        # rather than keeping a stale one that no longer matches.
        self.current_program_name = program_name
        # Event/transition logs are keyed by node id, which is only unique
        # within one program's graph -- without clearing these, switching
        # programs (e.g. start_stop -> conveyor_machine) leaves stale
        # signal-transition entries from the old program mixed in with the
        # new one's, both in /api/debug/events and /api/history/events
        # (BUG-004, see docs/QA_LOG.md).
        self._event_log.clear()
        self._transition_events.clear()
        self._last_changes = {}
        self._last_custom_block_status = {}

        # (Re)initialize internal variables from the program's `variables`
        # section (empty for older programs -- backward compatible, see
        # docs/VARIABLES.md). Each variable's live value resets to its
        # declared `initial` on program (re)load, same as node states.
        self._variables = {v.id: v for v in program.variables}
        self._var_values = {
            v.id: _coerce_to_type(v.initial, v.type) for v in program.variables
        }

    def get_program(self) -> ProgramGraph:
        return self._program

    # ── Internal variables (M/D-style work variables) ───────────────────

    def list_variable_defs(self) -> list[VariableDefinition]:
        return list(self._variables.values())

    def get_variable_value(self, var_id: str) -> Any:
        return self._var_values.get(var_id)

    def get_variable_values(self) -> dict[str, Any]:
        return dict(self._var_values)

    def add_variable(self, definition: VariableDefinition) -> VariableDefinition:
        self._variables[definition.id] = definition
        self._var_values[definition.id] = _coerce_to_type(definition.initial, definition.type)
        self._program.variables = list(self._variables.values())
        return definition

    def update_variable(self, var_id: str, patch: dict[str, Any]) -> VariableDefinition | None:
        existing = self._variables.get(var_id)
        if existing is None:
            return None
        data = existing.model_dump()
        data.update({k: v for k, v in patch.items() if v is not None})
        updated = VariableDefinition(**data)
        self._variables[var_id] = updated
        # Re-coerce the live value to the (possibly new) type; if `initial`
        # changed this does NOT reset the live value (editing the definition
        # shouldn't clobber a running value), only the type coercion is
        # re-applied so e.g. bool->number toggles don't leave a stale bool.
        current = self._var_values.get(var_id, updated.initial)
        self._var_values[var_id] = _coerce_to_type(current, updated.type)
        self._program.variables = list(self._variables.values())
        return updated

    def delete_variable(self, var_id: str) -> bool:
        existed = var_id in self._variables
        self._variables.pop(var_id, None)
        self._var_values.pop(var_id, None)
        self._program.variables = list(self._variables.values())
        return existed

    def force_variable_value(self, var_id: str, value: Any) -> VariableDefinition | None:
        """Force-write an internal variable's live value (does not touch its
        `initial`/definition). Returns the definition, or None if unknown."""
        definition = self._variables.get(var_id)
        if definition is None:
            return None
        self._var_values[var_id] = _coerce_to_type(value, definition.type)
        return definition

    def set_io(self, node_id: str, value: bool):
        self._io_values[node_id] = value

    def get_io(self) -> dict[str, Any]:
        return dict(self._io_values)

    def get_current_state(self) -> dict[str, dict[str, Any]]:
        return dict(self._current_outputs)

    def get_node_states(self) -> dict[str, dict[str, Any]]:
        """Internal per-node state (timer elapsed counters, latch bits, etc.),
        for debugging/inspection. Strips sandbox bookkeeping keys that aren't
        meaningful outside the custom-block execution path."""
        return {
            node_id: {k: v for k, v in st.items() if k not in ("_last_outputs",)}
            for node_id, st in self._node_states.items()
        }

    def get_scan_index(self) -> int:
        return self._scan_index

    # ── Metrics & history ───────────────────────────────────────────────

    def get_latest_metrics(self) -> ScanMetrics | None:
        if not self._metrics_history:
            return None
        return self._metrics_history[-1]

    def get_metrics_history(self, count: int = 60) -> list[ScanMetrics]:
        return list(self._metrics_history)[-count:]

    def get_port_history(
        self, node_id: str, port_name: str, seconds: float = 30.0
    ) -> list[tuple[float, Any]]:
        cutoff = self.clock.now() - seconds
        node_hist = self._history.get(node_id, {})
        port_hist = node_hist.get(port_name, deque())
        return [(ts, val) for ts, val in port_hist if ts >= cutoff]

    def get_events(
        self, from_ts: float = 0.0, to_ts: float | None = None
    ) -> list[StateEvent]:
        if to_ts is None:
            to_ts = self.clock.now()
        return [e for e in self._event_log if from_ts <= e.timestamp <= to_ts]

    def get_recent_events(self, since: int = 0) -> list[dict]:
        """Return transition events with a monotonically increasing sequence
        number, for the debug API's ring-buffer polling endpoint."""
        return [e for e in self._transition_events if e["seq"] > since]

    # ── Signals (HMI binding / visualization) ───────────────────────────

    def list_signals(self) -> list[dict]:
        """Enumerate every currently-known signal path ("node_id.port") with
        its last known value and inferred data type, for the HMI binding
        dropdown and the viz tab's signal picker.

        Internal variables (see docs/VARIABLES.md) are included here too,
        under the "node_id.port"-shaped path `var.<id>` (node_id="var", port=
        the variable id) so they show up in the HMI/viz signal pickers
        automatically without any special-casing on the frontend side --
        they're indistinguishable from any other signal from a consumer's
        point of view, just always present (even if no VAR_READ/VAR_WRITE
        node currently references them on the canvas)."""
        signals: list[dict] = []
        for node_id, outputs in sorted(self._current_outputs.items()):
            for port, val in sorted(outputs.items()):
                if isinstance(val, bool):
                    dtype = "bool"
                elif isinstance(val, (int, float)):
                    dtype = "number"
                else:
                    dtype = "other"
                signals.append({
                    "path": f"{node_id}.{port}",
                    "node_id": node_id,
                    "port": port,
                    "value": val,
                    "data_type": dtype,
                })
        for var_id, definition in sorted(self._variables.items()):
            val = self._var_values.get(var_id)
            signals.append({
                "path": f"var.{var_id}",
                "node_id": "var",
                "port": var_id,
                "value": val,
                "data_type": "bool" if definition.type == "bool" else "number",
            })
        return signals

    def get_viz_history(self, signal: str, since_ms: float = 0.0) -> list[dict]:
        """Trend-history samples for one "node_id.port" signal, as recorded
        by the `viz` task's own (possibly degraded) sampling rate. Distinct
        from `get_port_history`, which samples at the scan rate and is keyed
        differently (node_id + port_name, seconds-based cutoff)."""
        buf = self._viz_history.get(signal, deque())
        return [{"t": ts, "value": val} for ts, val in buf if ts * 1000.0 >= since_ms]

    # ── Scan cycle ──────────────────────────────────────────────────────

    async def start(self):
        """Start the live server's driving loop: the `control` task keeps
        running the scan cycle at (up to) `scan_interval_ms`, while `hmi` and
        `viz` are separately-scheduled tasks layered on top via
        `self.scheduler` (see plc/scheduler.py). All three share the same
        clock, so utilization/degradation are measured consistently."""
        if self._running:
            return
        self._running = True
        self.scheduler.update_config("control", period_ms=self.scan_interval_ms)
        # Force every task due immediately (in case of stale next_due_ms from
        # a prior start/stop cycle) and run one tick synchronously before
        # handing off to the background loop, so callers that await
        # `start()` (e.g. FastAPI's lifespan) are guaranteed at least one
        # populated scan cycle by the time it returns -- matching the
        # previous `_scan_loop` behavior where the first cycle ran before any
        # request could be served.
        now_ms = self.clock.now_ms()
        for t in self.scheduler.tasks.values():
            t.next_due_ms = now_ms
        await self.scheduler.tick()
        await self.scheduler.start()

    async def stop(self):
        self._running = False
        await self.scheduler.stop()

    async def run_scan(self):
        """Execute a single scan cycle "by hand", outside of the scheduler.

        Used by the headless scenario runner and pytest suite (typically
        together with a `VirtualClock`) to drive the engine deterministically
        without real-time sleeping, and by the live server's `control` task
        (see `plc/scheduler.py`). Safe to call whether or not the scheduler
        loop is running.
        """
        # Keep the control task's configured period in sync with the legacy
        # `scan_interval_ms` knob (still exposed via PATCH /api/runtime/config)
        # so existing UI/tests that only touch `scan_interval_ms` keep working.
        ctrl = self.scheduler.tasks.get("control")
        if ctrl is not None and ctrl.config.period_ms != self.scan_interval_ms:
            self.scheduler.update_config("control", period_ms=self.scan_interval_ms)
        await self._scan_cycle()
        if self.post_scan_hook is not None:
            self.post_scan_hook()

    def get_broadcast_state(self) -> dict[str, dict[str, Any]]:
        """`_current_outputs` plus a synthetic "var" pseudo-node carrying
        every internal variable's live value (keyed by variable id, exactly
        like a node's output ports). This lets the frontend address a
        variable as signal path "var.<id>" -- same "node_id.port" convention
        used everywhere else (HMI widget bindings, viz picker, event log) --
        with zero special-casing needed in the WS message consumer."""
        state = dict(self._current_outputs)
        if self._var_values:
            state["var"] = dict(self._var_values)
        return state

    async def _hmi_task(self):
        """Push the latest runtime state to connected WebSocket clients.
        Runs at the `hmi` task's (possibly degraded) effective period,
        independent of the scan cycle itself."""
        if not self.broadcast_callback:
            return
        metrics = self.get_latest_metrics()
        payload = {
            "type": "state_update",
            "runtime": self.get_broadcast_state(),
            "metrics": metrics.model_dump() if metrics else {},
            "changes": self._last_changes,
            "pending_ops": [op.model_dump() for op in self.pending_ops],
            "custom_blocks": self._last_custom_block_status,
            "resources": self.scheduler.snapshot(),
        }
        if self.sim_state_provider is not None:
            try:
                payload["sim_state"] = self.sim_state_provider()
            except Exception:
                pass
        try:
            await self.broadcast_callback(payload)
        except Exception:
            pass

    async def _viz_task(self):
        """Sample every current signal into the per-signal trend ring buffer,
        and push a lightweight aggregate update for the visualization tab.
        Runs at the `viz` task's (possibly degraded) effective period."""
        now = self.clock.now()
        now_ms = self.clock.now_ms()
        max_samples = self._viz_max_samples
        for node_id, outputs in self._current_outputs.items():
            for port, val in outputs.items():
                if not isinstance(val, (bool, int, float)):
                    continue
                signal = f"{node_id}.{port}"
                buf = self._viz_history.get(signal)
                if buf is None:
                    buf = deque(maxlen=max_samples)
                    self._viz_history[signal] = buf
                buf.append((now, val))
        for var_id, val in self._var_values.items():
            if not isinstance(val, (bool, int, float)):
                continue
            signal = f"var.{var_id}"
            buf = self._viz_history.get(signal)
            if buf is None:
                buf = deque(maxlen=max_samples)
                self._viz_history[signal] = buf
            buf.append((now, val))

        if self.broadcast_callback:
            try:
                await self.broadcast_callback({
                    "type": "viz_update",
                    "t_ms": now_ms,
                    "resources": self.scheduler.snapshot(),
                })
            except Exception:
                pass

    async def _scan_cycle(self):
        t0 = time.monotonic()
        now = self.clock.now()
        now_ms = self.clock.now_ms()

        # Snapshot variable values before the scan so we can diff afterwards
        # -- `_var_values` is mutated in place by VAR_WRITE executors during
        # `_graph.execute` (same dict object, not copied), so this is the
        # only way to detect which variables changed this scan.
        old_var_values = dict(self._var_values)

        new_outputs, new_states = await self._graph.execute(
            self._node_states, self._io_values, now_ms=now_ms, var_store=self._var_values
        )

        # Detect changes for event log
        changes: dict[str, dict[str, Any]] = {}
        for node_id, outputs in new_outputs.items():
            old = self._current_outputs.get(node_id, {})
            for port, val in outputs.items():
                if old.get(port) != val:
                    changes.setdefault(node_id, {})[port] = val
                    self._transition_seq += 1
                    self._transition_events.append({
                        "seq": self._transition_seq,
                        "t_ms": round(now_ms, 1),
                        "scan": self._scan_index,
                        "signal": f"{node_id}.{port}",
                        "old": old.get(port),
                        "new": val,
                    })

        # Internal variables: fold value transitions into the same event
        # log / transition ring buffer as node outputs (signal path
        # "var.<id>"), so the event log / debug API / viz history all see
        # variable writes exactly like any other signal.
        for var_id, val in self._var_values.items():
            old_val = old_var_values.get(var_id)
            if old_val != val:
                changes.setdefault("var", {})[var_id] = val
                self._transition_seq += 1
                self._transition_events.append({
                    "seq": self._transition_seq,
                    "t_ms": round(now_ms, 1),
                    "scan": self._scan_index,
                    "signal": f"var.{var_id}",
                    "old": old_val,
                    "new": val,
                })

        self._current_outputs = new_outputs
        self._node_states = new_states

        # Record history (sample at actual scan rate)
        max_samples = int(self.history_seconds * (1000 / self.scan_interval_ms)) + 1
        for node_id, outputs in new_outputs.items():
            node_hist = self._history.setdefault(node_id, {})
            for port, val in outputs.items():
                buf = node_hist.get(port)
                if buf is None or buf.maxlen != max_samples:
                    buf = deque(maxlen=max_samples)
                    node_hist[port] = buf
                buf.append((now, val))

        if changes:
            self._event_log.append(
                StateEvent(
                    timestamp=now,
                    scan_index=self._scan_index,
                    changes=changes,
                )
            )

        # Surface custom code block execution stats (transparency: which
        # blocks are slow / erroring, for the performance panel)
        custom_block_status = {
            node_id: {"exec_ms": st.get("_exec_ms"), "error": st.get("_error")}
            for node_id, st in new_states.items()
            if "_exec_ms" in st
        }

        self._scan_index += 1
        cycle_time = (time.monotonic() - t0) * 1000

        # Memory estimate
        mem_mb = self._process.memory_info().rss / 1_048_576
        hist_bytes = sum(
            len(buf) * 24
            for nh in self._history.values()
            for buf in nh.values()
        )
        metrics = ScanMetrics(
            cycle_time_ms=round(cycle_time, 2),
            target_cycle_ms=self.scan_interval_ms,
            nodes_evaluated=len(new_outputs),
            utilization_pct=round(cycle_time / self.scan_interval_ms * 100, 1),
            memory_mb=round(mem_mb, 2),
            history_buffer_mb=round(hist_bytes / 1_048_576, 3),
            scan_index=self._scan_index,
            timestamp=now,
        )
        self._metrics_history.append(metrics)

        # State push to the frontend is no longer done here on every scan --
        # it's now the `hmi` task's job (see `_hmi_task`), run at its own
        # (possibly degraded) period so the broadcast rate is governed by the
        # resource scheduler rather than the scan rate. We still stash the
        # latest per-scan diff/custom-block status so `_hmi_task` can surface
        # them on its next tick.
        self._last_changes = changes
        self._last_custom_block_status = custom_block_status


runtime = PLCRuntime()
