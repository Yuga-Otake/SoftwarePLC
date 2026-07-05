"""Unit tests for the SR (set-dominant) and RS (reset-dominant) flip-flop
blocks in plc/nodes.py, exercised directly through PLCRuntime with a
VirtualClock (no real-time waiting)."""
from __future__ import annotations

import pytest

from tests.conftest import make_program


def sr_program():
    return make_program(
        nodes=[
            {"id": "s", "type": "DigitalInput", "params": {"value": False}},
            {"id": "r", "type": "DigitalInput", "params": {"value": False}},
            {"id": "sr1", "type": "SR", "params": {}},
        ],
        edges=[
            {"id": "e1", "source": "s", "source_handle": "OUT", "target": "sr1", "target_handle": "S"},
            {"id": "e2", "source": "r", "source_handle": "OUT", "target": "sr1", "target_handle": "R"},
        ],
    )


def rs_program():
    return make_program(
        nodes=[
            {"id": "s", "type": "DigitalInput", "params": {"value": False}},
            {"id": "r", "type": "DigitalInput", "params": {"value": False}},
            {"id": "rs1", "type": "RS", "params": {}},
        ],
        edges=[
            {"id": "e1", "source": "s", "source_handle": "OUT", "target": "rs1", "target_handle": "S"},
            {"id": "e2", "source": "r", "source_handle": "OUT", "target": "rs1", "target_handle": "R"},
        ],
    )


async def test_sr_starts_reset(harness_factory):
    h = harness_factory(sr_program())
    await h.scan()
    assert h.out("sr1", "Q") is False


async def test_sr_set_latches_on(harness_factory):
    h = harness_factory(sr_program())
    await h.scan()
    h.set_io("s", True)
    await h.scan()
    assert h.out("sr1", "Q") is True

    # Q should hold even after S is released (no R asserted).
    h.set_io("s", False)
    await h.scan()
    assert h.out("sr1", "Q") is True


async def test_sr_reset_clears(harness_factory):
    h = harness_factory(sr_program())
    await h.scan()
    h.set_io("s", True)
    await h.scan()
    h.set_io("s", False)
    h.set_io("r", True)
    await h.scan()
    assert h.out("sr1", "Q") is False


async def test_sr_is_set_dominant_when_both_asserted(harness_factory):
    """SR: if S and R are both True in the same scan, Set wins (Q -> True)."""
    h = harness_factory(sr_program())
    await h.scan()
    h.set_io("s", True)
    h.set_io("r", True)
    await h.scan()
    assert h.out("sr1", "Q") is True


async def test_rs_is_reset_dominant_when_both_asserted(harness_factory):
    """RS: if S and R are both True in the same scan, Reset wins (Q -> False)."""
    h = harness_factory(rs_program())
    await h.scan()
    h.set_io("s", True)
    h.set_io("r", True)
    await h.scan()
    assert h.out("rs1", "Q") is False


async def test_rs_set_then_reset(harness_factory):
    h = harness_factory(rs_program())
    await h.scan()
    h.set_io("s", True)
    await h.scan()
    assert h.out("rs1", "Q") is True

    h.set_io("s", False)
    h.set_io("r", True)
    await h.scan()
    assert h.out("rs1", "Q") is False
