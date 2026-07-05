"""End-to-end test for the examples/start_stop.json program: X0 (start) sets
an SR latch driving Y0 (motor); the latch also feeds a 3s TON timer driving
Y1 (done). Loaded exactly as the running server would load it on startup.

Wiring quirk (see backend/scripts/scenarios/*.json comments): X1 (stop) feeds
the SR's R input through a continuous NOT, not an edge, so R is True on every
scan where x_stop is False. The SR is set-dominant, so holding x_start True
keeps the motor on regardless of R; releasing x_start while x_stop is False
immediately resets the motor.
"""
from __future__ import annotations


async def test_initial_state_is_off(start_stop_harness):
    h = start_stop_harness
    await h.scan()
    assert h.out("y_motor") is False
    assert h.out("y_done") is False


async def test_start_turns_on_motor(start_stop_harness):
    h = start_stop_harness
    await h.scan()
    h.set_io("x_start", True)
    await h.advance(100)
    assert h.out("y_motor") is True
    assert h.out("y_done") is False


async def test_releasing_start_without_stop_resets_motor(start_stop_harness):
    """Documents the SR wiring quirk: releasing x_start while x_stop is False
    drives R True (via NOT) and immediately resets the latch."""
    h = start_stop_harness
    await h.scan()
    h.set_io("x_start", True)
    await h.advance(100)
    assert h.out("y_motor") is True

    h.set_io("x_start", False)
    await h.advance(100)
    assert h.out("y_motor") is False


async def test_holding_stop_keeps_latch_while_start_releases(start_stop_harness):
    """Holding x_stop True drives R False (via NOT), so releasing x_start
    alone does not reset the latch."""
    h = start_stop_harness
    await h.scan()
    h.set_io("x_start", True)
    h.set_io("x_stop", True)
    await h.advance(100)
    assert h.out("y_motor") is True

    h.set_io("x_start", False)
    await h.advance(100)
    assert h.out("y_motor") is True

    h.set_io("x_stop", False)
    await h.advance(100)
    assert h.out("y_motor") is False


async def test_done_output_after_timer_elapses_then_resets_on_stop(start_stop_harness):
    h = start_stop_harness
    await h.scan()
    h.set_io("x_start", True)
    await h.advance(100)
    assert h.out("y_motor") is True
    assert h.out("y_done") is False

    await h.advance(2800)
    assert h.out("y_done") is False

    await h.advance(200)
    assert h.out("y_done") is True

    # Release start (with stop still at its default False) to reset the SR
    # latch; both outputs should drop and the timer's ET resets to 0.
    h.set_io("x_start", False)
    await h.advance(100)
    assert h.out("y_motor") is False
    assert h.out("y_done") is False
    assert h.out("ton1", "ET") == 0.0
