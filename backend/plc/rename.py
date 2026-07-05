"""Node id (signal name) renaming: the "logic side" half of binding logic-design
signals to simulation-rig / HMI-screen signals bidirectionally (see the PoC
requirement in the task brief / docs/VARIABLES.md "信号ハブ").

Renaming a node id is more than a program-graph edit: every signal-path
reference elsewhere in the system that spells out the OLD id must be updated
too, or the rename silently breaks rig/HMI bindings. This module owns:

  1. Validating a candidate new id (same charset as existing ids, not a
     reserved word, not already taken -- including inside every group's
     nested children, since ids must stay globally unique after
     flatten_program()).
  2. Rewriting every edge (top-level AND inside every group's `children`,
     recursively) whose source/target references the old id.
  3. Rewriting every sim rig JSON (`backend/sim_rigs/*.json`) and every HMI
     screen JSON (`backend/hmi_screens/*.json`) that references the old id
     via any of the signal-path-bearing fields those formats use (`signal`,
     `drive_signal`, `reverse_signal`, `coil_signal`, `contact_signal`,
     `watch`, `set_input`, exam `steps[].signal`).

Signal-path convention (see plc/simulation.py::read_signal/write_signal and
docs/SIMULATION.md): a reference is either "var.<id>" (internal variable,
never touched by a node rename), "node_id.port", or a bare "node_id". Only
the node_id component is ever renamed here.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .models import ProgramGraph, NodeDefinition, EdgeDefinition
from .graph import PARENT_REF

SIM_RIGS_DIR = Path(__file__).resolve().parent.parent / "sim_rigs"
HMI_SCREENS_DIR = Path(__file__).resolve().parent.parent / "hmi_screens"

# Same charset as HMI screen / sim rig *file* names elsewhere in this codebase
# is deliberately NOT reused here -- node ids historically allow only
# [A-Za-z0-9_], matching every existing example/rig ("x_start", "ton1",
# "machine1/latch1" being the qualified *path*, not a literal id). Slashes are
# excluded since they're the group-path separator (see plc/graph.py
# PATH_SEP) and would corrupt qualification if allowed in a raw local id.
_VALID_ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Reserved words that would collide with special meaning elsewhere in the
# engine if used as a node id.
RESERVED_IDS = {"var", PARENT_REF, "$parent", ""}


class RenameError(ValueError):
    """Raised for any rejected rename request (validation failure)."""


def validate_new_id(new_id: str) -> None:
    if not new_id or not _VALID_ID_RE.match(new_id):
        raise RenameError(
            "Invalid id: must start with a letter/underscore and contain only "
            "letters, digits, and underscores"
        )
    if new_id in RESERVED_IDS or new_id.startswith("$"):
        raise RenameError(f"'{new_id}' is a reserved id")


def all_node_ids(graph: ProgramGraph) -> set[str]:
    """Every node id declared anywhere in the tree (recursing into group
    children), for duplicate-id checking. Ids are only required to be unique
    *within the graph they're declared in* by the pre-existing engine (see
    BUG-005, docs/QA_LOG.md) -- but for renaming we conservatively require
    global uniqueness across the whole tree, since a name is meant to be a
    stable, discoverable "signal name" (the whole point of this feature), and
    colliding same-named siblings-at-different-levels would make the signal
    hub's "which id resolves to what" ambiguous."""
    ids: set[str] = set()

    def walk(nodes: list[NodeDefinition]) -> None:
        for n in nodes:
            ids.add(n.id)
            if n.type == "group" and n.children:
                walk(n.children.nodes)

    walk(graph.nodes)
    return ids


def _rename_edges(edges: list[EdgeDefinition], old_id: str, new_id: str) -> int:
    count = 0
    for e in edges:
        if e.source == old_id:
            e.source = new_id
            count += 1
        if e.target == old_id:
            e.target = new_id
            count += 1
    return count


def rename_node_in_graph(program: ProgramGraph, old_id: str, new_id: str) -> tuple[bool, int]:
    """Find `old_id` anywhere in the tree (top level or inside any group's
    nested children) and rename it in place: the node itself, plus every edge
    referencing it as source/target at whichever level it lives (edges never
    cross levels by id -- a node can only be wired to siblings/its own
    group's $parent at its own nesting level, see plc/graph.py).

    Returns (found, edge_ref_count). Mutates `program` in place.
    """
    found = False
    edge_refs = 0

    def walk(graph: ProgramGraph) -> bool:
        nonlocal found, edge_refs
        for n in graph.nodes:
            if n.id == old_id:
                n.id = new_id
                found = True
                edge_refs += _rename_edges(graph.edges, old_id, new_id)
                return True
        # Not found at this level -- recurse into each group's children,
        # renaming edges at whichever level actually contains the node.
        for n in graph.nodes:
            if n.type == "group" and n.children and walk(n.children):
                return True
        return False

    walk(program)
    return found, edge_refs


# ── Signal-path rewriting (sim rigs / HMI screens) ──────────────────────────
# A signal path referencing `old_id` is either the bare id ("x_start"), or
# "old_id.port" (e.g. "y_motor.OUT", "pl1.OUT") -- see docstring above.

def _rewrite_signal_path(value: Any, old_id: str, new_id: str) -> tuple[Any, bool]:
    if not isinstance(value, str) or not value:
        return value, False
    if value.startswith("var."):
        return value, False
    node_part, sep, port = value.partition(".")
    if node_part == old_id:
        return f"{new_id}{sep}{port}", True
    return value, False


# Rig device fields that may carry a signal path referencing a program node.
_RIG_DEVICE_SIGNAL_FIELDS = (
    "signal", "drive_signal", "reverse_signal", "coil_signal", "contact_signal",
)


def rewrite_rig(rig: dict, old_id: str, new_id: str) -> int:
    """Rewrite every signal-path field in one rig dict that references
    `old_id`. Returns the number of fields changed."""
    changed = 0
    for device in rig.get("devices") or []:
        if not isinstance(device, dict):
            continue
        for field in _RIG_DEVICE_SIGNAL_FIELDS:
            if field in device:
                new_val, did_change = _rewrite_signal_path(device[field], old_id, new_id)
                if did_change:
                    device[field] = new_val
                    changed += 1
    for rule in rig.get("feedback_rules") or []:
        if not isinstance(rule, dict):
            continue
        for field in ("watch", "set_input"):
            if field in rule:
                new_val, did_change = _rewrite_signal_path(rule[field], old_id, new_id)
                if did_change:
                    rule[field] = new_val
                    changed += 1
    exam = rig.get("exam")
    if isinstance(exam, dict):
        for step in exam.get("steps") or []:
            if not isinstance(step, dict):
                continue
            if "signal" in step:
                new_val, did_change = _rewrite_signal_path(step["signal"], old_id, new_id)
                if did_change:
                    step["signal"] = new_val
                    changed += 1
    return changed


def _rewrite_hmi_screen(screen: dict, old_id: str, new_id: str) -> int:
    changed = 0
    for widget in screen.get("widgets") or []:
        if not isinstance(widget, dict):
            continue
        if "signal" in widget:
            new_val, did_change = _rewrite_signal_path(widget["signal"], old_id, new_id)
            if did_change:
                widget["signal"] = new_val
                changed += 1
    return changed


def cascade_rename_to_files(old_id: str, new_id: str) -> dict[str, list[str]]:
    """Scan every sim rig / HMI screen JSON file on disk and rewrite any
    signal-path reference to `old_id`, in place. Returns
    {"sim_rigs": [names updated], "hmi_screens": [names updated]}, each entry
    being the bare name (no extension) of a file that was actually changed
    (so the caller can surface a "N references in rig X updated" notice)."""
    updated: dict[str, list[str]] = {"sim_rigs": [], "hmi_screens": []}

    if SIM_RIGS_DIR.exists():
        for path in sorted(SIM_RIGS_DIR.glob("*.json")):
            try:
                rig = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if not isinstance(rig, dict):
                continue
            changed = rewrite_rig(rig, old_id, new_id)
            if changed:
                path.write_text(json.dumps(rig, indent=2, ensure_ascii=False), encoding="utf-8")
                updated["sim_rigs"].append(path.stem)

    if HMI_SCREENS_DIR.exists():
        for path in sorted(HMI_SCREENS_DIR.glob("*.json")):
            try:
                screen = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if not isinstance(screen, dict):
                continue
            changed = _rewrite_hmi_screen(screen, old_id, new_id)
            if changed:
                path.write_text(json.dumps(screen, indent=2, ensure_ascii=False), encoding="utf-8")
                updated["hmi_screens"].append(path.stem)

    return updated
