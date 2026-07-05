"""Unit tests for the TON (on-delay) timer block, driven by a VirtualClock so
the 3-second delay is exercised without any real-time waiting.

Note on timing semantics: `set_io` only takes effect on the *next* scan (see
Harness.scan / scripts/scenario_runner.py's `{"set": ...}` step, which runs
one scan immediately at the current virtual time before any `advance_ms`).
So the pattern used throughout is: set_io(...) then `await h.scan()` once to
let it take effect at t=0 elapsed, then `advance()` to accumulate ET.
"""
from __future__ import annotations

from tests.conftest import make_program


def ton_program(pt_ms: float = 3000):
    return make_program(
        nodes=[
            {"id": "in1", "type": "DigitalInput", "params": {"value": False}},
            {"id": "ton1", "type": "TON", "params": {"PT": pt_ms}},
        ],
        edges=[
            {"id": "e1", "source": "in1", "source_handle": "OUT", "target": "ton1", "target_handle": "IN"},
        ],
    )


async def test_ton_starts_off(harness_factory):
    h = harness_factory(ton_program())
    await h.scan()
    assert h.out("ton1", "Q") is False
    assert h.out("ton1", "ET") == 0.0


async def test_ton_stays_off_before_preset_elapsed(harness_factory):
    h = harness_factory(ton_program(pt_ms=3000), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", True)
    await h.scan()  # IN takes effect; timer starts accumulating from here
    await h.advance(2800)
    assert h.out("ton1", "Q") is False
    assert h.out("ton1", "ET") == 2800.0


async def test_ton_turns_on_after_preset_elapsed(harness_factory):
    h = harness_factory(ton_program(pt_ms=3000), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", True)
    await h.scan()
    await h.advance(3000)
    assert h.out("ton1", "Q") is True
    assert h.out("ton1", "ET") == 3000.0


async def test_ton_elapsed_time_caps_at_preset(harness_factory):
    h = harness_factory(ton_program(pt_ms=3000), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", True)
    await h.scan()
    await h.advance(3500)
    assert h.out("ton1", "Q") is True
    assert h.out("ton1", "ET") == 3000.0


async def test_ton_resets_when_input_goes_off(harness_factory):
    h = harness_factory(ton_program(pt_ms=3000), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", True)
    await h.scan()
    await h.advance(3000)
    assert h.out("ton1", "Q") is True

    h.set_io("in1", False)
    await h.scan()
    assert h.out("ton1", "Q") is False
    assert h.out("ton1", "ET") == 0.0


async def test_ton_restarts_cleanly_after_reset(harness_factory):
    """After an off-reset, a fresh on-pulse must time out from zero again
    (elapsed time must not carry over from the previous run)."""
    h = harness_factory(ton_program(pt_ms=3000), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", True)
    await h.scan()
    await h.advance(3000)
    assert h.out("ton1", "Q") is True

    h.set_io("in1", False)
    await h.scan()

    h.set_io("in1", True)
    await h.scan()
    await h.advance(2800)
    assert h.out("ton1", "Q") is False
    await h.advance(200)
    assert h.out("ton1", "Q") is True


async def test_ton_period_zero_turns_on_immediately(harness_factory):
    """PT=0 is a degenerate-but-legal config: Q should latch True as soon as
    IN goes True (ET(0) >= PT(0) on the very next scan), no crash."""
    h = harness_factory(ton_program(pt_ms=0))
    await h.scan()
    h.set_io("in1", True)
    await h.scan()
    assert h.out("ton1", "Q") is True
    assert h.out("ton1", "ET") == 0.0


async def test_ton_single_scan_chatter_never_reaches_preset(harness_factory):
    """A one-scan-wide ON pulse (input flips back off before the next scan
    picks it up as sustained) must not falsely trigger Q for a timer with a
    preset far longer than one scan -- ET should read 0 once IN is back off,
    not some stale nonzero value."""
    h = harness_factory(ton_program(pt_ms=3000), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", True)
    await h.scan()
    h.set_io("in1", False)
    await h.scan()
    assert h.out("ton1", "Q") is False
    assert h.out("ton1", "ET") == 0.0


async def test_ton_unconnected_input_defaults_off(harness_factory):
    from tests.conftest import Harness
    prog = make_program(
        nodes=[{"id": "ton1", "type": "TON", "params": {"PT": 1000}}],
        edges=[],
    )
    h = Harness(prog)
    await h.scan()
    assert h.out("ton1", "Q") is False
    assert h.out("ton1", "ET") == 0.0
