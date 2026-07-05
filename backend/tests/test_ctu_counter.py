"""Unit tests for the CTU (count-up) counter block."""
from __future__ import annotations

from tests.conftest import make_program


def ctu_program(pv: int = 3):
    return make_program(
        nodes=[
            {"id": "cu", "type": "DigitalInput", "params": {"value": False}},
            {"id": "r", "type": "DigitalInput", "params": {"value": False}},
            {"id": "ctu1", "type": "CTU", "params": {"PV": pv}},
        ],
        edges=[
            {"id": "e1", "source": "cu", "source_handle": "OUT", "target": "ctu1", "target_handle": "CU"},
            {"id": "e2", "source": "r", "source_handle": "OUT", "target": "ctu1", "target_handle": "R"},
        ],
    )


async def test_ctu_starts_at_zero(harness_factory):
    h = harness_factory(ctu_program())
    await h.scan()
    assert h.out("ctu1", "CV") == 0
    assert h.out("ctu1", "Q") is False


async def test_ctu_counts_rising_edges_only(harness_factory):
    """CV should increment once per rising edge of CU, not once per scan
    that CU happens to be held True."""
    h = harness_factory(ctu_program(pv=3))
    await h.scan()

    h.set_io("cu", True)
    await h.scan()
    assert h.out("ctu1", "CV") == 1

    # Held True across another scan: no further increment.
    await h.scan()
    assert h.out("ctu1", "CV") == 1

    h.set_io("cu", False)
    await h.scan()
    h.set_io("cu", True)
    await h.scan()
    assert h.out("ctu1", "CV") == 2


async def test_ctu_q_asserted_when_cv_reaches_pv(harness_factory):
    h = harness_factory(ctu_program(pv=2))
    await h.scan()

    for _ in range(2):
        h.set_io("cu", True)
        await h.scan()
        h.set_io("cu", False)
        await h.scan()

    assert h.out("ctu1", "CV") == 2
    assert h.out("ctu1", "Q") is True


async def test_ctu_reset_clears_count(harness_factory):
    h = harness_factory(ctu_program(pv=2))
    await h.scan()

    h.set_io("cu", True)
    await h.scan()
    assert h.out("ctu1", "CV") == 1

    h.set_io("r", True)
    await h.scan()
    assert h.out("ctu1", "CV") == 0
    assert h.out("ctu1", "Q") is False


async def test_ctu_preset_zero_q_true_immediately(harness_factory):
    """PV=0 is a degenerate-but-legal config: Q should be True from the
    start since CV(0) >= PV(0), with no crash."""
    h = harness_factory(ctu_program(pv=0))
    await h.scan()
    assert h.out("ctu1", "CV") == 0
    assert h.out("ctu1", "Q") is True


async def test_ctu_continues_counting_past_preset(harness_factory):
    """CV should keep incrementing on further rising edges even after Q has
    already latched True (no clamp at PV, only at the int overflow guard)."""
    h = harness_factory(ctu_program(pv=2))
    await h.scan()

    for _ in range(5):
        h.set_io("cu", True)
        await h.scan()
        h.set_io("cu", False)
        await h.scan()

    assert h.out("ctu1", "CV") == 5
    assert h.out("ctu1", "Q") is True


async def test_ctu_no_spurious_count_when_reset_releases_with_cu_held(harness_factory):
    """Regression test for BUG-002: if CU is already True (or held True
    through the reset pulse) when R releases, that must NOT be treated as a
    fresh rising edge -- CV should stay at 0 until a real 0->1 transition of
    CU occurs after the reset window."""
    h = harness_factory(ctu_program(pv=5))
    await h.scan()

    # CU goes True first (real edge, counts to 1).
    h.set_io("cu", True)
    await h.scan()
    assert h.out("ctu1", "CV") == 1

    # Reset asserted while CU is still continuously True.
    h.set_io("r", True)
    await h.scan()
    assert h.out("ctu1", "CV") == 0

    # Reset released -- CU never dropped, so this must NOT count as a new edge.
    h.set_io("r", False)
    await h.scan()
    assert h.out("ctu1", "CV") == 0

    # A genuine new rising edge afterwards must still count normally.
    h.set_io("cu", False)
    await h.scan()
    h.set_io("cu", True)
    await h.scan()
    assert h.out("ctu1", "CV") == 1
