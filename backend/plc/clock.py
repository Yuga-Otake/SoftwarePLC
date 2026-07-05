"""Injectable time source for the PLC engine.

Time-dependent blocks (TON/TOFF, etc.) need "now, in milliseconds" to compute
elapsed time. In production this is real wall-clock time. In tests and the
headless scenario runner we want a *virtual* clock so that e.g. a 3-second
TON timer can be exercised without actually sleeping 3 seconds.

Usage:
    clock = RealClock()          # default, used by the running server
    clock = VirtualClock()       # tests / scenario runner
    clock.advance_ms(3000)       # only meaningful for VirtualClock

`PLCRuntime` holds a `clock` instance and passes `clock.now_ms()` down to node
executors on every scan via a reserved `_now_ms` params key (see graph.py).
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod


class Clock(ABC):
    @abstractmethod
    def now_ms(self) -> float:
        """Current time in milliseconds, monotonic-ish, used for timer blocks."""

    @abstractmethod
    def now(self) -> float:
        """Current time in seconds (epoch-like), used for history/event timestamps."""


class RealClock(Clock):
    """Default clock: wraps real wall-clock time. Behavior identical to the
    previous hardcoded `time.time()` calls throughout the engine."""

    def now_ms(self) -> float:
        return time.time() * 1000

    def now(self) -> float:
        return time.time()


class VirtualClock(Clock):
    """Fully controllable clock for fast, deterministic tests.

    Starts at t=0 (or a given epoch) and only moves forward when explicitly
    advanced via `advance_ms`. No real sleeping occurs.
    """

    def __init__(self, start_ms: float = 0.0):
        self._now_ms = start_ms

    def now_ms(self) -> float:
        return self._now_ms

    def now(self) -> float:
        return self._now_ms / 1000.0

    def advance_ms(self, delta_ms: float) -> float:
        if delta_ms < 0:
            raise ValueError("delta_ms must be >= 0")
        self._now_ms += delta_ms
        return self._now_ms

    def set_ms(self, value_ms: float) -> None:
        self._now_ms = value_ms
