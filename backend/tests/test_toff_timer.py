"""Unit tests for the TOFF (off-delay) timer block, previously untested.
Mirrors test_ton_timer.py's approach (VirtualClock, no real-time waiting)."""
from __future__ import annotations

from tests.conftest import make_program


def toff_program(pt_ms: float = 3000, start_value: bool = True):
    return make_program(
        nodes=[
            {"id": "in1", "type": "DigitalInput", "params": {"value": start_value}},
            {"id": "toff1", "type": "TOFF", "params": {"PT": pt_ms}},
        ],
        edges=[
            {"id": "e1", "source": "in1", "source_handle": "OUT", "target": "toff1", "target_handle": "IN"},
        ],
    )


async def test_toff_q_true_while_in_true(harness_factory):
    h = harness_factory(toff_program(start_value=True))
    await h.scan()
    assert h.out("toff1", "Q") is True
    assert h.out("toff1", "ET") == 0.0


async def test_toff_stays_on_before_preset_elapsed(harness_factory):
    h = harness_factory(toff_program(pt_ms=3000, start_value=True), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", False)
    await h.scan()  # IN drop takes effect; timer starts accumulating
    await h.advance(2800)
    assert h.out("toff1", "Q") is True
    assert h.out("toff1", "ET") == 2800.0


async def test_toff_turns_off_after_preset_elapsed(harness_factory):
    h = harness_factory(toff_program(pt_ms=3000, start_value=True), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", False)
    await h.scan()
    await h.advance(3000)
    assert h.out("toff1", "Q") is False
    assert h.out("toff1", "ET") == 3000.0


async def test_toff_elapsed_time_caps_at_preset(harness_factory):
    h = harness_factory(toff_program(pt_ms=3000, start_value=True), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", False)
    await h.scan()
    await h.advance(3500)
    assert h.out("toff1", "Q") is False
    assert h.out("toff1", "ET") == 3000.0


async def test_toff_resets_when_input_goes_true_again(harness_factory):
    """Re-asserting IN before the off-delay elapses should snap Q back True
    and clear ET, same as TON's mirror-image reset-on-input-change."""
    h = harness_factory(toff_program(pt_ms=3000, start_value=True), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", False)
    await h.scan()
    await h.advance(2000)
    assert h.out("toff1", "Q") is True  # still within the off-delay window

    h.set_io("in1", True)
    await h.scan()
    assert h.out("toff1", "Q") is True
    assert h.out("toff1", "ET") == 0.0


async def test_toff_restarts_cleanly_after_re_trigger(harness_factory):
    """After IN goes back True and then False again, the off-delay must time
    out from zero (no carry-over from the previous off-delay run)."""
    h = harness_factory(toff_program(pt_ms=3000, start_value=True), scan_interval_ms=100.0)
    await h.scan()
    h.set_io("in1", False)
    await h.scan()
    await h.advance(2000)

    h.set_io("in1", True)
    await h.scan()

    h.set_io("in1", False)
    await h.scan()
    await h.advance(2800)
    assert h.out("toff1", "Q") is True
    await h.advance(200)
    assert h.out("toff1", "Q") is False


async def test_toff_period_zero_turns_off_immediately(harness_factory):
    """PT=0 is a degenerate-but-legal config; Q should drop to False as soon
    as IN goes False, without crashing or leaving a stale True."""
    h = harness_factory(toff_program(pt_ms=0, start_value=True))
    await h.scan()
    h.set_io("in1", False)
    await h.scan()
    assert h.out("toff1", "Q") is False
    assert h.out("toff1", "ET") == 0.0


async def test_toff_unconnected_input_defaults_false_q_true():
    """A TOFF with no IN wiring reads IN as False (default), so per its
    semantics (Q follows "still within PT ms of last True") Q starts True
    with ET=0 until the (already-elapsed) PT causes it to drop on the next
    scan boundary check. This just documents current behavior so any future
    change to unconnected-input defaults is caught."""
    from tests.conftest import Harness
    prog = make_program(
        nodes=[{"id": "toff1", "type": "TOFF", "params": {"PT": 1000}}],
        edges=[],
    )
    h = Harness(prog)
    await h.scan()
    assert h.out("toff1", "Q") is True
    assert h.out("toff1", "ET") == 0.0
