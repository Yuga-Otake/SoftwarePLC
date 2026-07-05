"""Signal hub: bidirectional discovery between logic-design signals (node
ids / internal variables) and simulation-rig / HMI-screen references to them.

See the PoC requirement this implements (docs/VARIABLES.md "6. 信号ハブ"):
a signal should be discoverable AND bindable from either side --

  - the per-signal `used_by` rows answer "where is this logic-design signal
    used?" (edge count on the canvas, which HMI screens reference it, which
    sim rigs reference it) for the variable manager's per-row usage badges.
  - `unresolved` answers the reverse question: "which rig/HMI references
    point at a signal that doesn't exist in the current program?" -- the
    variable manager's "unresolved references" section, letting a user
    create the missing input node/variable on the spot (POST
    /api/program/nodes with an explicit id, or POST /api/variables).

Deliberately reuses plc/rename.py's file-scanning conventions (same
directories, same signal-path-bearing field names) and
plc/simulation.py::resolve_signal_kind (same "does this resolve against the
CURRENT program" semantics used by the rig binding-editor) rather than
re-implementing either, so all three features agree on what counts as a
reference and what counts as resolved.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from . import rename
from .runtime import PLCRuntime
from .simulation import DEVICE_SIGNAL_FIELDS, resolve_signal_kind


def _iter_rig_files() -> list[tuple[str, dict]]:
    """Read every sim rig JSON off `rename.SIM_RIGS_DIR` -- accessed through
    the `rename` module object (not imported as a bare name) so tests that
    `monkeypatch.setattr(rename, "SIM_RIGS_DIR", tmp_path)` for isolation
    (same pattern as tests/test_simulation.py) are honored here too."""
    rigs: list[tuple[str, dict]] = []
    sim_rigs_dir = rename.SIM_RIGS_DIR
    if sim_rigs_dir.exists():
        for path in sorted(sim_rigs_dir.glob("*.json")):
            try:
                rig = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if isinstance(rig, dict):
                rigs.append((path.stem, rig))
    return rigs


def _iter_hmi_screen_files() -> list[tuple[str, dict]]:
    """Same as `_iter_rig_files` but for HMI screens -- note this reads
    `rename.HMI_SCREENS_DIR`, a module-level constant distinct from (but
    pointing at the same real directory as) `api/routes.py`'s own
    `HMI_SCREENS_DIR` -- see api/routes.py's `_hmi_screen_path`. Tests must
    monkeypatch both if they isolate HMI screen file I/O across the two
    modules (see tests/test_binding.py's `client` fixture)."""
    screens: list[tuple[str, dict]] = []
    hmi_screens_dir = rename.HMI_SCREENS_DIR
    if hmi_screens_dir.exists():
        for path in sorted(hmi_screens_dir.glob("*.json")):
            try:
                screen = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if isinstance(screen, dict):
                screens.append((path.stem, screen))
    return screens


def _rig_signal_refs(rig: dict) -> list[str]:
    """Every non-empty signal-path string referenced anywhere in one rig
    (devices' signal fields, feedback_rules' watch/set_input, exam steps'
    signal) -- same field set plc/rename.py cascades through."""
    refs: list[str] = []
    for device in rig.get("devices") or []:
        if not isinstance(device, dict):
            continue
        for field in DEVICE_SIGNAL_FIELDS:
            value = device.get(field)
            if isinstance(value, str) and value:
                refs.append(value)
    for rule in rig.get("feedback_rules") or []:
        if not isinstance(rule, dict):
            continue
        for field in ("watch", "set_input"):
            value = rule.get(field)
            if isinstance(value, str) and value:
                refs.append(value)
    exam = rig.get("exam")
    if isinstance(exam, dict):
        for step in exam.get("steps") or []:
            if isinstance(step, dict):
                value = step.get("signal")
                if isinstance(value, str) and value:
                    refs.append(value)
    return refs


def _hmi_signal_refs(screen: dict) -> list[str]:
    refs: list[str] = []
    for widget in screen.get("widgets") or []:
        if isinstance(widget, dict):
            value = widget.get("signal")
            if isinstance(value, str) and value:
                refs.append(value)
    return refs


def _node_id_of(path: str) -> str:
    """The "node_id" (or "var.<id>") component a reference resolves against,
    matching plc/simulation.py's read/write_signal + plc/rename.py's rewrite
    convention: "var.<id>" stays as-is (the whole path IS the key), anything
    else keys off the part before the first '.'."""
    if path.startswith("var."):
        return path
    return path.split(".", 1)[0]


def signals_usage_report(runtime: PLCRuntime) -> dict[str, Any]:
    """Full payload for GET /api/signals/usage: per-signal usage rows
    (`signals`, one per entry in runtime.list_signals()) plus the
    deduplicated unresolved-reference list (`unresolved`) -- a rig/HMI
    referencing the same missing signal path twice is reported once, with
    every referencer listed."""
    program = runtime.get_program()

    # logic edge counts, keyed by the referenced node id (top-level graph
    # only -- edges never cross group-nesting levels by raw id, see
    # plc/graph.py, so a group-nested node's "logic usage" is counted from
    # its own group's edges, walked the same way here).
    edge_counts: dict[str, int] = defaultdict(int)

    def count_edges(nodes, edges) -> None:
        for e in edges:
            edge_counts[e.source] += 1
            edge_counts[e.target] += 1
        for n in nodes:
            if n.type == "group" and n.children:
                count_edges(n.children.nodes, n.children.edges)

    count_edges(program.nodes, program.edges)

    rigs = _iter_rig_files()
    screens = _iter_hmi_screen_files()

    hmi_by_signal: dict[str, set[str]] = defaultdict(set)
    rig_by_signal: dict[str, set[str]] = defaultdict(set)
    unresolved_by_path: dict[str, dict] = {}

    def note_unresolved(ref: str, kind: str, name: str) -> None:
        resolved, _kind = resolve_signal_kind(runtime, ref)
        if resolved:
            return
        entry = unresolved_by_path.setdefault(ref, {"path": ref, "referenced_by": []})
        referencer = {"kind": kind, "name": name}
        if referencer not in entry["referenced_by"]:
            entry["referenced_by"].append(referencer)

    for rig_name, rig in rigs:
        for ref in _rig_signal_refs(rig):
            rig_by_signal[_node_id_of(ref)].add(rig_name)
            note_unresolved(ref, "sim_rig", rig_name)

    for screen_name, screen in screens:
        for ref in _hmi_signal_refs(screen):
            hmi_by_signal[_node_id_of(ref)].add(screen_name)
            note_unresolved(ref, "hmi_screen", screen_name)

    rows: list[dict] = []
    for sig in runtime.list_signals():
        path = sig["path"]
        key = _node_id_of(path)
        rows.append({
            "path": path,
            "node_id": sig["node_id"],
            "port": sig["port"],
            "data_type": sig["data_type"],
            "used_by": {
                "logic": edge_counts.get(key, 0),
                "hmi_screens": sorted(hmi_by_signal.get(key, ())),
                "sim_rigs": sorted(rig_by_signal.get(key, ())),
            },
        })

    unresolved = sorted(unresolved_by_path.values(), key=lambda e: e["path"])
    return {"signals": rows, "unresolved": unresolved}
