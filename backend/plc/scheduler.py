"""Cooperative multi-task CPU scheduler for the three "PLC tasks" above the
scan engine itself: `control` (PLC scan execution), `hmi` (WebSocket/frontend
state push), and `viz` (trend-history sampling + aggregated visualization
push).

Mirrors how a real PLC's OS divides CPU budget between the control task and
lower-priority background tasks: each task has a *configured* period and a
CPU share (%). Actual (measured) busy time per cycle is used to compute
utilization; if a non-control task exceeds its own share, or total
utilization across all tasks exceeds an overload threshold, that task's
*effective* period is stretched (degraded) so it runs less often — freeing
CPU for `control`, which is never degraded.

Fully driven by an injected `Clock` (see clock.py), so it can be exercised
deterministically in tests with a `VirtualClock` and no real sleeping, or
driven for real by `PLCRuntime`'s asyncio loop against a `RealClock`.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from .clock import Clock

TaskName = str  # "control" | "hmi" | "viz"

# A task's utilization is a moving average of `busy_ms / period_ms` over the
# last N completed cycles.
UTILIZATION_WINDOW = 20

# If total utilization across all tasks exceeds this, non-control tasks are
# degraded (their effective period stretched) to protect `control`.
OVERLOAD_TOTAL_PCT = 90.0

# Multiplicative stretch applied to a degraded task's effective period per
# detection step, capped at MAX_STRETCH x the configured period.
DEGRADE_STEP = 1.5
MAX_STRETCH = 4.0
# Once a task is no longer over-budget, effective period recovers toward the
# configured period by this factor per completed cycle.
RECOVER_STEP = 0.85


@dataclass
class TaskConfig:
    name: TaskName
    period_ms: float
    cpu_share: float  # percent, 0-100
    protected: bool = False  # True only for "control" -- never degraded


@dataclass
class TaskStats:
    """Live, measured state for one scheduled task."""
    config: TaskConfig
    effective_period_ms: float = 0.0
    last_run_ms: float | None = None
    next_due_ms: float = 0.0
    run_count: int = 0
    last_busy_ms: float = 0.0
    utilization_pct: float = 0.0
    degraded: bool = False
    _recent_busy: list[float] = field(default_factory=list)

    def __post_init__(self):
        if self.effective_period_ms <= 0:
            self.effective_period_ms = self.config.period_ms

    def record_run(self, busy_ms: float, now_ms: float):
        self.last_busy_ms = busy_ms
        self.last_run_ms = now_ms
        self.run_count += 1
        self._recent_busy.append(busy_ms)
        if len(self._recent_busy) > UTILIZATION_WINDOW:
            self._recent_busy.pop(0)
        avg_busy = sum(self._recent_busy) / len(self._recent_busy)
        period = max(self.effective_period_ms, 1e-6)
        self.utilization_pct = round(avg_busy / period * 100, 2)

    def to_dict(self) -> dict:
        return {
            "name": self.config.name,
            "period_ms": self.config.period_ms,
            "effective_period_ms": round(self.effective_period_ms, 2),
            "cpu_share": self.config.cpu_share,
            "protected": self.config.protected,
            "utilization_pct": self.utilization_pct,
            "run_count": self.run_count,
            "last_busy_ms": round(self.last_busy_ms, 3),
            "degraded": self.degraded,
        }


TaskCallback = Callable[[], Awaitable[None]]


class TaskScheduler:
    """Drives `control`/`hmi`/`viz` tasks against an injected clock.

    Usage pattern (both for the real asyncio loop and for tests):
        sched = TaskScheduler(clock)
        sched.set_callback("control", runtime.run_scan)
        sched.set_callback("hmi", broadcast_state)
        sched.set_callback("viz", sample_history)
        ...
        await sched.tick()   # runs every due task once, measuring busy time
    """

    def __init__(self, clock: Clock):
        self.clock = clock
        self.tasks: dict[TaskName, TaskStats] = {}
        self._callbacks: dict[TaskName, TaskCallback] = {}
        self._running = False
        self._loop_task: asyncio.Task | None = None
        # Smallest configured period across tasks governs the real loop's
        # polling granularity (we don't want to oversleep past an earlier
        # task's due time).
        self._add_default_tasks()

    def _add_default_tasks(self):
        self.add_task(TaskConfig(name="control", period_ms=100.0, cpu_share=50.0, protected=True))
        self.add_task(TaskConfig(name="hmi", period_ms=100.0, cpu_share=30.0, protected=False))
        self.add_task(TaskConfig(name="viz", period_ms=500.0, cpu_share=20.0, protected=False))

    def add_task(self, config: TaskConfig):
        now_ms = self.clock.now_ms()
        stats = TaskStats(config=config, effective_period_ms=config.period_ms)
        stats.next_due_ms = now_ms
        self.tasks[config.name] = stats

    def set_callback(self, name: TaskName, cb: TaskCallback):
        self._callbacks[name] = cb

    # ── Configuration ────────────────────────────────────────────────────

    def get_task(self, name: TaskName) -> TaskStats:
        return self.tasks[name]

    def update_config(self, name: TaskName, period_ms: float | None = None, cpu_share: float | None = None):
        stats = self.tasks[name]
        if period_ms is not None:
            stats.config.period_ms = max(1.0, period_ms)
            # A manual re-configuration resets any prior degradation so the
            # newly requested period takes effect immediately; the overload
            # policy will re-degrade it on the next tick if still needed.
            stats.effective_period_ms = stats.config.period_ms
            stats.degraded = False
        if cpu_share is not None:
            stats.config.cpu_share = max(0.0, min(100.0, cpu_share))

    def snapshot(self) -> list[dict]:
        return [self.tasks[name].to_dict() for name in ("control", "hmi", "viz") if name in self.tasks]

    # ── Core scheduling step ─────────────────────────────────────────────

    def _due_tasks(self, now_ms: float) -> list[TaskStats]:
        return [t for t in self.tasks.values() if now_ms >= t.next_due_ms]

    async def tick(self) -> list[TaskName]:
        """Run every task that is currently due, exactly once each, measuring
        wall/virtual busy time, then apply the overload/degrade policy.
        Returns the list of task names that ran this tick."""
        now_ms = self.clock.now_ms()
        ran: list[TaskName] = []
        for stats in self._due_tasks(now_ms):
            cb = self._callbacks.get(stats.config.name)
            t0 = time.perf_counter()
            if cb is not None:
                await cb()
            busy_ms = (time.perf_counter() - t0) * 1000.0
            stats.record_run(busy_ms, now_ms)
            stats.next_due_ms = now_ms + stats.effective_period_ms
            ran.append(stats.config.name)

        self._apply_overload_policy()
        return ran

    def _apply_overload_policy(self):
        control = self.tasks.get("control")
        others = [t for t in self.tasks.values() if not t.config.protected]

        total_util = sum(t.utilization_pct for t in self.tasks.values())
        control_over = control is not None and control.utilization_pct > control.config.cpu_share
        overloaded = total_util > OVERLOAD_TOTAL_PCT or control_over

        for t in others:
            over_share = t.utilization_pct > t.config.cpu_share
            if overloaded or over_share:
                max_period = t.config.period_ms * MAX_STRETCH
                if t.effective_period_ms < max_period:
                    t.effective_period_ms = min(max_period, t.effective_period_ms * DEGRADE_STEP)
                t.degraded = t.effective_period_ms > t.config.period_ms * 1.001
            else:
                if t.effective_period_ms > t.config.period_ms:
                    t.effective_period_ms = max(
                        t.config.period_ms, t.effective_period_ms * RECOVER_STEP
                    )
                    # Snap tiny residuals back exactly to the configured period.
                    if t.effective_period_ms < t.config.period_ms * 1.02:
                        t.effective_period_ms = t.config.period_ms
                t.degraded = t.effective_period_ms > t.config.period_ms * 1.001

    # ── Real-time driving loop (used by the live server) ─────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        # Force every task to be immediately due: `next_due_ms` may be stale
        # from a previous start/stop cycle (e.g. tests that repeatedly spin
        # up a TestClient against the same runtime singleton), and we want
        # parity with a fresh scan loop that always runs its first cycle
        # right away rather than waiting out a leftover period.
        now_ms = self.clock.now_ms()
        for t in self.tasks.values():
            t.next_due_ms = now_ms
        self._loop_task = asyncio.create_task(self._loop())

    async def stop(self):
        self._running = False
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass

    async def _loop(self):
        # Poll at a fine grain so tasks fire close to their due time without
        # busy-waiting; the smallest sensible granularity is bounded by the
        # fastest task's configured period.
        while self._running:
            await self.tick()
            granularity_ms = min(
                (t.effective_period_ms for t in self.tasks.values()), default=50.0
            )
            await asyncio.sleep(max(0.005, min(0.05, granularity_ms / 1000 / 4)))
