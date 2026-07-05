"""Unit tests for the COMP comparator and multi-input AND/OR blocks --
previously untested corners: all six comparison operators, an unknown
operator string, and AND/OR with 3-4 inputs including partially-wired ports."""
from __future__ import annotations

import pytest

from plc.nodes import COMPExecutor
from tests.conftest import make_program


def comp_program(limit: float, op: str, in_value: float):
    return make_program(
        nodes=[
            {"id": "in1", "type": "DigitalInput", "params": {"value": in_value}},
            {"id": "comp1", "type": "COMP", "params": {"LIMIT": limit, "OP": op}},
        ],
        edges=[
            {"id": "e1", "source": "in1", "source_handle": "OUT", "target": "comp1", "target_handle": "IN"},
        ],
    )


@pytest.mark.parametrize(
    "op,in_value,limit,expected",
    [
        (">", 6.0, 5.0, True),
        (">", 5.0, 5.0, False),
        ("<", 4.0, 5.0, True),
        ("<", 5.0, 5.0, False),
        (">=", 5.0, 5.0, True),
        (">=", 4.9, 5.0, False),
        ("<=", 5.0, 5.0, True),
        ("<=", 5.1, 5.0, False),
        ("==", 5.0, 5.0, True),
        ("==", 5.01, 5.0, False),
        ("!=", 5.01, 5.0, True),
        ("!=", 5.0, 5.0, False),
    ],
)
def test_comp_operator_matrix(op, in_value, limit, expected):
    """Direct unit test of COMPExecutor for all six comparison operators.
    Goes straight to the executor (bypassing DigitalInput, which always
    coerces its `value` param to bool and so can't carry an arbitrary
    float through the graph) since COMP.IN is a plain float port."""
    executor = COMPExecutor()
    outputs, _ = executor.execute(
        {"IN": in_value}, {}, {"LIMIT": limit, "OP": op}
    )
    assert outputs["OUT"] is expected


async def test_comp_unknown_operator_defaults_false(harness_factory):
    """An unrecognized OP string must not crash the scan; current behavior
    is to fall back to a constant-False comparator."""
    h = harness_factory(comp_program(limit=5.0, op="~=", in_value=5.0))
    await h.scan()
    assert h.out("comp1") is False


async def test_comp_unconnected_input_defaults_to_zero(harness_factory):
    from tests.conftest import Harness
    prog = make_program(
        nodes=[{"id": "comp1", "type": "COMP", "params": {"LIMIT": 0.0, "OP": ">="}}],
        edges=[],
    )
    h = Harness(prog)
    await h.scan()
    # IN defaults to 0.0, LIMIT defaults to 0.0 here -> 0 >= 0 -> True
    assert h.out("comp1") is True


def and_or_program():
    return make_program(
        nodes=[
            {"id": "a", "type": "DigitalInput", "params": {"value": True}},
            {"id": "b", "type": "DigitalInput", "params": {"value": True}},
            {"id": "c", "type": "DigitalInput", "params": {"value": False}},
            {"id": "d", "type": "DigitalInput", "params": {"value": True}},
            {"id": "and1", "type": "AND"},
            {"id": "or1", "type": "OR"},
        ],
        edges=[
            {"id": "e1", "source": "a", "source_handle": "OUT", "target": "and1", "target_handle": "IN1"},
            {"id": "e2", "source": "b", "source_handle": "OUT", "target": "and1", "target_handle": "IN2"},
            {"id": "e3", "source": "c", "source_handle": "OUT", "target": "and1", "target_handle": "IN3"},
            {"id": "e4", "source": "d", "source_handle": "OUT", "target": "and1", "target_handle": "IN4"},
            {"id": "e5", "source": "a", "source_handle": "OUT", "target": "or1", "target_handle": "IN1"},
            {"id": "e6", "source": "c", "source_handle": "OUT", "target": "or1", "target_handle": "IN3"},
        ],
    )


async def test_and_with_four_inputs_one_false_is_false(harness_factory):
    h = harness_factory(and_or_program())
    await h.scan()
    assert h.out("and1") is False  # c=False drags the whole AND down


async def test_and_all_true_with_four_inputs(harness_factory):
    prog = and_or_program()
    for n in prog.nodes:
        if n.id == "c":
            n.params["value"] = True
    h = harness_factory(prog)
    await h.scan()
    assert h.out("and1") is True


async def test_or_with_partially_wired_inputs_true_wins(harness_factory):
    """OR wired to only IN1/IN3 (IN2/IN4 left unconnected): should behave
    like a 2-input OR, ignoring the unconnected ports rather than treating
    them as an implicit True/False that skews the result."""
    h = harness_factory(and_or_program())
    await h.scan()
    assert h.out("or1") is True  # a=True on IN1


async def test_or_all_wired_false_is_false(harness_factory):
    prog = make_program(
        nodes=[
            {"id": "a", "type": "DigitalInput", "params": {"value": False}},
            {"id": "b", "type": "DigitalInput", "params": {"value": False}},
            {"id": "or1", "type": "OR"},
        ],
        edges=[
            {"id": "e1", "source": "a", "source_handle": "OUT", "target": "or1", "target_handle": "IN1"},
            {"id": "e2", "source": "b", "source_handle": "OUT", "target": "or1", "target_handle": "IN2"},
        ],
    )
    h = harness_factory(prog)
    await h.scan()
    assert h.out("or1") is False


async def test_and_fully_unconnected_defaults_true():
    """Documents current behavior: an AND with zero wired inputs has an
    empty `inputs` dict, and the executor's vacuous-AND special case returns
    True (matching classical "AND of nothing is True" logic), not a crash."""
    from tests.conftest import Harness
    prog = make_program(nodes=[{"id": "and1", "type": "AND"}], edges=[])
    h = Harness(prog)
    await h.scan()
    assert h.out("and1") is True


async def test_or_fully_unconnected_defaults_false():
    from tests.conftest import Harness
    prog = make_program(nodes=[{"id": "or1", "type": "OR"}], edges=[])
    h = Harness(prog)
    await h.scan()
    assert h.out("or1") is False
