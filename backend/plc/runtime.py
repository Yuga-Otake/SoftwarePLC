import asyncio
import os
import time
from collections import deque
from typing import Any, Callable, Awaitable

import psutil

from .graph import PLCGraph
from .models import ProgramGraph, ScanMetrics, StateEvent, PendingOperation


class PLCRuntime:
    def __init__(self):
        self._graph = PLCGraph(ProgramGraph())
        self._program: ProgramGraph = ProgramGraph()
        self._node_states: dict[str, dict] = {}
        self._current_outputs: dict[str, dict[str, Any]] = {}
        self._io_values: dict[str, Any] = {}

        self.scan_interval_ms: float = 100.0
        self.history_seconds: float = 60.0

        # {node_id: {port_name: deque[(ts, value)]}}
        self._history: dict[str, dict[str, deque]] = {}
        self._event_log: deque[StateEvent] = deque(maxlen=10000)
        self._metrics_history: deque[ScanMetrics] = deque(maxlen=600)
        self._scan_index: int = 0

        # AI Human-in-the-Loop pending ops
        self.pending_ops: list[PendingOperation] = []

        self.broadcast_callback: Callable[[dict], Awaitable[None]] | None = None

        self._running = False
        self._task: asyncio.Task | None = None
        self._process = psutil.Process(os.getpid())

    # ── Program management ──────────────────────────────────────────────

    def load_program(self, program: ProgramGraph):
        self._program = program
        self._graph = PLCGraph(program)
        self._node_states = {}
        self._current_outputs = {}
        self._history = {}
        self._io_values = {}

    def get_program(self) -> ProgramGraph:
        return self._program

    def set_io(self, node_id: str, value: bool):
        self._io_values[node_id] = value

    def get_io(self) -> dict[str, Any]:
        return dict(self._io_values)

    def get_current_state(self) -> dict[str, dict[str, Any]]:
        return dict(self._current_outputs)

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
        cutoff = time.time() - seconds
        node_hist = self._history.get(node_id, {})
        port_hist = node_hist.get(port_name, deque())
        return [(ts, val) for ts, val in port_hist if ts >= cutoff]

    def get_events(
        self, from_ts: float = 0.0, to_ts: float | None = None
    ) -> list[StateEvent]:
        if to_ts is None:
            to_ts = time.time()
        return [e for e in self._event_log if from_ts <= e.timestamp <= to_ts]

    # ── Scan cycle ──────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._scan_loop())

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _scan_loop(self):
        while self._running:
            cycle_start = time.monotonic()
            await self._scan_cycle()
            elapsed = (time.monotonic() - cycle_start) * 1000
            sleep_ms = self.scan_interval_ms - elapsed
            if sleep_ms > 0:
                await asyncio.sleep(sleep_ms / 1000)

    async def _scan_cycle(self):
        t0 = time.monotonic()
        now = time.time()

        new_outputs, new_states = await self._graph.execute(
            self._node_states, self._io_values
        )

        # Detect changes for event log
        changes: dict[str, dict[str, Any]] = {}
        for node_id, outputs in new_outputs.items():
            old = self._current_outputs.get(node_id, {})
            for port, val in outputs.items():
                if old.get(port) != val:
                    changes.setdefault(node_id, {})[port] = val

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

        if self.broadcast_callback:
            try:
                await self.broadcast_callback(
                    {
                        "type": "state_update",
                        "runtime": new_outputs,
                        "metrics": metrics.model_dump(),
                        "changes": changes,
                        "pending_ops": [op.model_dump() for op in self.pending_ops],
                        "custom_blocks": custom_block_status,
                    }
                )
            except Exception:
                pass


runtime = PLCRuntime()
