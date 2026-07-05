#!/usr/bin/env python
"""Headless scenario runner for the Software PLC engine.

Loads the PLC engine directly (no HTTP server, no browser) and drives it
through a scripted scenario using a virtual clock, so time-dependent blocks
(TON/TOFF) can be exercised without real-time sleeping. This lets developers
evaluate behavior via JSON/log output instead of taking screenshots of the
running UI.

Usage:
    cd backend
    python scripts/scenario_runner.py scripts/scenarios/start_stop_basic.json
    python scripts/scenario_runner.py scripts/scenarios/*.json      (glob expands per-shell)

Scenario file format (JSON):
    {
      "program": "../examples/start_stop.json",   // path relative to this scenario file
      "scan_interval_ms": 100,                     // optional, defaults to program/runtime default
      "steps": [
        {"set": {"x_start": true}},                // set one or more DigitalInput node IDs
        {"advance_ms": 100},                        // advance the virtual clock and run scans
        {"expect": {"y_motor.OUT": true}},           // assert node.port == value
        {"advance_ms": 3000},
        {"expect": {"y_done.OUT": true}}
      ]
    }

`expect` keys may be either "node_id.port" (checked against that node's
output ports) or a bare node_id that is a DigitalInput/DigitalOutput (in
which case ".OUT" is assumed).

Output: one JSON object per line (JSONL) to stdout for every signal
transition detected while advancing time, e.g.:
    {"t_ms": 3100.0, "scan": 31, "signal": "y_done.OUT", "old": false, "new": true}

On success, a final summary line is printed:
    {"result": "pass", "scenario": "...", "steps": N, "checks": M, "duration_ms": ...}

On failure (an `expect` mismatch), a diff is printed to stderr and the
process exits with a non-zero status code.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from plc.clock import VirtualClock  # noqa: E402
from plc.models import ProgramGraph  # noqa: E402
from plc.runtime import PLCRuntime  # noqa: E402


class ScenarioError(Exception):
    """Raised when an `expect` assertion fails."""


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve_signal(current_state: dict, key: str) -> tuple[str, str]:
    """Split "node.port" into (node_id, port). Bare node ids default to OUT."""
    if "." in key:
        node_id, port = key.split(".", 1)
        return node_id, port
    return key, "OUT"


def _jsonl(obj: dict):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


class ScenarioRunner:
    def __init__(self, scenario_path: Path):
        self.scenario_path = scenario_path
        self.scenario = _load_json(scenario_path)
        self.clock = VirtualClock(start_ms=0.0)
        self.runtime = PLCRuntime(clock=self.clock)
        self.checks = 0
        self.steps_run = 0

    async def setup(self):
        program_rel = self.scenario.get("program")
        if not program_rel:
            raise ScenarioError("scenario must specify a 'program' path")
        program_path = (self.scenario_path.parent / program_rel).resolve()
        if not program_path.exists():
            raise ScenarioError(f"program file not found: {program_path}")
        data = _load_json(program_path)
        self.runtime.load_program(ProgramGraph(**data))

        scan_interval_ms = self.scenario.get("scan_interval_ms")
        if scan_interval_ms:
            self.runtime.scan_interval_ms = float(scan_interval_ms)

        # Prime with a single scan at t=0 so DigitalInput/initial outputs are
        # populated before the first step (mirrors server startup behavior).
        await self.runtime.run_scan()
        self._emit_new_transitions(last_seq=0)

    def _emit_new_transitions(self, last_seq: int) -> int:
        events = self.runtime.get_recent_events(since=last_seq)
        for ev in events:
            _jsonl({
                "t_ms": ev["t_ms"],
                "scan": ev["scan"],
                "signal": ev["signal"],
                "old": ev["old"],
                "new": ev["new"],
            })
        if events:
            return events[-1]["seq"]
        return last_seq

    async def run(self) -> dict:
        await self.setup()
        last_seq = self.runtime._transition_seq  # already emitted during setup

        for step in self.scenario.get("steps", []):
            self.steps_run += 1
            if "set" in step:
                for node_id, value in step["set"].items():
                    self.runtime.set_io(node_id, bool(value))
                # A set takes effect on the next scan; run one scan at the
                # current virtual time so the change is observable immediately
                # (without advancing the clock).
                await self.runtime.run_scan()
                last_seq = self._emit_new_transitions(last_seq)

            elif "advance_ms" in step:
                await self._advance(float(step["advance_ms"]))
                last_seq = self._emit_new_transitions(last_seq)

            elif "expect" in step:
                self._check_expect(step["expect"])

            else:
                raise ScenarioError(f"unknown step: {step}")

        return {
            "result": "pass",
            "scenario": str(self.scenario_path),
            "steps": self.steps_run,
            "checks": self.checks,
        }

    async def _advance(self, delta_ms: float):
        """Advance the virtual clock by delta_ms, running one scan per
        scan_interval_ms tick so timers accumulate elapsed time correctly."""
        step_ms = self.runtime.scan_interval_ms
        remaining = delta_ms
        while remaining > 0:
            tick = min(step_ms, remaining)
            self.clock.advance_ms(tick)
            await self.runtime.run_scan()
            remaining -= tick

    def _check_expect(self, expected: dict):
        state = self.runtime.get_current_state()
        mismatches = []
        for key, expected_val in expected.items():
            node_id, port = _resolve_signal(state, key)
            actual = state.get(node_id, {}).get(port)
            self.checks += 1
            if actual != expected_val:
                mismatches.append({
                    "signal": f"{node_id}.{port}",
                    "expected": expected_val,
                    "actual": actual,
                })
        if mismatches:
            raise ScenarioError(json.dumps({
                "result": "fail",
                "scenario": str(self.scenario_path),
                "scan": self.runtime.get_scan_index(),
                "t_ms": self.clock.now_ms(),
                "mismatches": mismatches,
            }, ensure_ascii=False))


async def run_one(scenario_path: Path) -> bool:
    runner = ScenarioRunner(scenario_path)
    t0 = time.monotonic()
    try:
        summary = await runner.run()
    except ScenarioError as exc:
        print(str(exc), file=sys.stderr)
        return False
    duration_ms = (time.monotonic() - t0) * 1000
    summary["duration_ms"] = round(duration_ms, 2)
    _jsonl(summary)
    return True


async def main_async(paths: list[Path]) -> int:
    ok = True
    for path in paths:
        result = await run_one(path)
        ok = ok and result
    return 0 if ok else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("scenarios", nargs="+", type=Path, help="Scenario JSON file(s)")
    args = parser.parse_args()

    exit_code = asyncio.run(main_async(args.scenarios))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
