from collections import defaultdict, deque
from typing import Any
from .models import ProgramGraph, NodeDefinition, EdgeDefinition
from .nodes import EXECUTORS
from .custom_blocks import CUSTOM_BLOCKS
from .sandbox import sandbox_pool

PARENT_REF = "$parent"
PATH_SEP = "/"


Endpoint = tuple[str, str]  # (flattened_leaf_node_id, handle)


class _GroupInfo:
    """Resolved metadata for a single group node, keyed by the group's full
    path (e.g. "machine1/process_feed"). Built bottom-up so that by the time
    a group's own info is finalized, every nested group it directly contains
    already has its `_GroupInfo` computed.
    """

    __slots__ = ("path", "gnode", "child_groups", "input_wiring", "output_wiring", "passthrough")

    def __init__(self, path: str, gnode: NodeDefinition):
        self.path = path  # full dotted/slashed path, no trailing separator
        self.gnode = gnode
        self.child_groups: dict[str, "_GroupInfo"] = {}  # local child id -> info
        # Raw (unresolved-through-nesting) wiring declared via $parent edges
        # in this group's own `children.edges`, in terms of LOCAL child ids.
        self.input_wiring: dict[str, list[tuple[str, str]]] = defaultdict(list)
        self.output_wiring: dict[str, list[tuple[str, str]]] = defaultdict(list)
        self.passthrough: dict[str, list[str]] = defaultdict(list)  # in_port -> [out_port]


def flatten_program(program: ProgramGraph) -> ProgramGraph:
    """Recursively expand `type: "group"` nodes into a flat execution graph.

    The runtime engine has no concept of hierarchy: this is a load-time
    transform only. Child node/edge ids are namespaced by path (e.g.
    `machine1/latch1`) so they stay globally unique after flattening.

    Group boundary ports are resolved as pure wiring passthroughs: an edge
    inside `children` that references the reserved node id `$parent` (with
    `handle` = the group's port id) is rewritten to connect directly to
    whatever is wired to the group's port from the *outside* (for inputs), or
    whatever the outside reads from the group (for outputs). No group node
    survives into the flattened graph, at any nesting depth.

    See docs/HIERARCHY.md for the JSON format and worked examples.
    """
    flat_nodes: list[NodeDefinition] = []
    edge_seq = [0]

    def next_edge_id() -> str:
        edge_seq[0] += 1
        return f"__flat_e{edge_seq[0]}"

    def qualify(path_prefix: str, local_id: str) -> str:
        return f"{path_prefix}{PATH_SEP}{local_id}" if path_prefix else local_id

    # ── Pass 1: walk the tree, emit plain leaf nodes (qualified), and build
    # a _GroupInfo for every group node, keyed by full path. ─────────────────
    def collect(nodes: list[NodeDefinition], path_prefix: str) -> dict[str, _GroupInfo]:
        """Emit plain nodes at this level and return {local_id: _GroupInfo}
        for the group nodes declared at this level."""
        local_groups: dict[str, _GroupInfo] = {}
        for n in nodes:
            full_id = qualify(path_prefix, n.id)
            if n.type != "group":
                flat_nodes.append(n.model_copy(update={"id": full_id}))
                continue
            info = _GroupInfo(full_id, n)
            children = n.children or ProgramGraph()
            info.child_groups = collect(children.nodes, full_id)
            for cedge in children.edges:
                if cedge.source == PARENT_REF and cedge.target == PARENT_REF:
                    info.passthrough[cedge.source_handle].append(cedge.target_handle)
                elif cedge.source == PARENT_REF:
                    info.input_wiring[cedge.source_handle].append((cedge.target, cedge.target_handle))
                elif cedge.target == PARENT_REF:
                    info.output_wiring[cedge.target_handle].append((cedge.source, cedge.source_handle))
            local_groups[n.id] = info
        return local_groups

    root_groups = collect(program.nodes, "")

    # ── Pass 2: resolve each group's input/output port -> leaf endpoints,
    # fully dereferencing through nested groups. Memoized by path since a
    # group's ports may be read multiple times (fan-out). ───────────────────
    _input_cache: dict[str, dict[str, list[Endpoint]]] = {}
    _output_cache: dict[str, dict[str, list[Endpoint]]] = {}

    def resolve_input_port(info: _GroupInfo, port_id: str) -> list[Endpoint]:
        """Leaf endpoints that should receive whatever drives `info`'s input
        port `port_id` (i.e. targets of the group's input-port passthrough)."""
        cached = _input_cache.setdefault(info.path, {})
        if port_id in cached:
            return cached[port_id]
        cached[port_id] = []  # guard against pathological cycles
        result: list[Endpoint] = []
        for (local_id, handle) in info.input_wiring.get(port_id, []):
            result.extend(resolve_endpoint_as_target(info, local_id, handle))
        # A direct input->output passthrough also means external readers of
        # the corresponding output port(s) resolve to whatever feeds this
        # input port (handled in resolve_output_port via `passthrough`), not
        # here — nothing further to add for input_wiring.
        cached[port_id] = result
        return result

    def resolve_output_port(info: _GroupInfo, port_id: str) -> list[Endpoint]:
        """Leaf endpoints that produce the value read from `info`'s output
        port `port_id`."""
        cached = _output_cache.setdefault(info.path, {})
        if port_id in cached:
            return cached[port_id]
        cached[port_id] = []
        result: list[Endpoint] = []
        for (local_id, handle) in info.output_wiring.get(port_id, []):
            result.extend(resolve_endpoint_as_source(info, local_id, handle))
        cached[port_id] = result
        return result

    def resolve_endpoint_as_target(info: _GroupInfo, local_id: str, handle: str) -> list[Endpoint]:
        """`local_id` is a child of `info` (by local id). Resolve `local_id.handle`
        as something that can be *written to* (i.e. an input): a leaf node
        handle directly, or — if local_id is a nested group — that group's
        resolved input port."""
        child_info = info.child_groups.get(local_id)
        if child_info is not None:
            return resolve_input_port(child_info, handle)
        return [(qualify(info.path, local_id), handle)]

    def resolve_endpoint_as_source(info: _GroupInfo, local_id: str, handle: str) -> list[Endpoint]:
        """Same as above but resolving something that can be *read from*
        (i.e. an output)."""
        child_info = info.child_groups.get(local_id)
        if child_info is not None:
            return resolve_output_port(child_info, handle)
        return [(qualify(info.path, local_id), handle)]

    # ── Pass 3: walk the tree again, splicing every non-$parent edge at
    # every level into fully-resolved leaf-to-leaf flat edges. Group
    # endpoints (as source or target) fan out through resolve_output_port /
    # resolve_input_port; direct passthrough (group used as both the
    # boundary-in and boundary-out with no internal wiring) is handled via
    # `passthrough_drivers`, populated as we discover what feeds a group's
    # input ports from its parent. ───────────────────────────────────────────
    flat_edges: list[EdgeDefinition] = []
    # group_path -> {input_port_id: [external driver endpoints]}
    passthrough_drivers: dict[str, dict[str, list[Endpoint]]] = defaultdict(lambda: defaultdict(list))

    def endpoints_for_source(local_groups: dict[str, _GroupInfo], path_prefix: str, node_id: str, handle: str) -> list[Endpoint]:
        info = local_groups.get(node_id)
        if info is None:
            return [(qualify(path_prefix, node_id), handle)]
        eps = list(resolve_output_port(info, handle))
        # direct passthrough: this group's output port `handle` may also be
        # fed by an input port with no internal node (declared via
        # info.passthrough: in_port -> [out_port, ...]).
        for in_port, out_ports in info.passthrough.items():
            if handle in out_ports:
                eps.extend(passthrough_drivers[info.path].get(in_port, []))
        return eps

    def endpoints_for_target(local_groups: dict[str, _GroupInfo], path_prefix: str, node_id: str, handle: str) -> list[Endpoint]:
        info = local_groups.get(node_id)
        if info is None:
            return [(qualify(path_prefix, node_id), handle)]
        return list(resolve_input_port(info, handle))

    def splice(nodes: list[NodeDefinition], edges: list[EdgeDefinition], path_prefix: str, local_groups: dict[str, _GroupInfo]):
        # First, record external drivers feeding each group's input ports at
        # this level (needed for direct passthrough resolution), THEN emit
        # flat edges, THEN recurse into each group's children.
        for edge in edges:
            tgt_info = local_groups.get(edge.target)
            if tgt_info is not None:
                src_eps = endpoints_for_source(local_groups, path_prefix, edge.source, edge.source_handle)
                passthrough_drivers[tgt_info.path][edge.target_handle].extend(src_eps)

        for edge in edges:
            src_eps = endpoints_for_source(local_groups, path_prefix, edge.source, edge.source_handle)
            tgt_eps = endpoints_for_target(local_groups, path_prefix, edge.target, edge.target_handle)
            for (src_id, src_handle) in src_eps:
                for (tgt_id, tgt_handle) in tgt_eps:
                    flat_edges.append(EdgeDefinition(
                        id=next_edge_id(),
                        source=src_id,
                        source_handle=src_handle,
                        target=tgt_id,
                        target_handle=tgt_handle,
                    ))

        for local_id, info in local_groups.items():
            children = info.gnode.children or ProgramGraph()
            inner_edges = [e for e in children.edges if e.source != PARENT_REF and e.target != PARENT_REF]
            splice(children.nodes, inner_edges, info.path, info.child_groups)

    splice(program.nodes, program.edges, "", root_groups)

    return ProgramGraph(nodes=flat_nodes, edges=flat_edges)


class PLCGraph:
    def __init__(self, graph: ProgramGraph):
        flat = flatten_program(graph)
        self.nodes = {n.id: n for n in flat.nodes}
        self.edges = list(flat.edges)
        self._build_adjacency()

    def _build_adjacency(self):
        # target_node -> {target_handle: (source_node, source_handle)}
        self.input_map: dict[str, dict[str, tuple[str, str]]] = defaultdict(dict)
        for edge in self.edges:
            self.input_map[edge.target][edge.target_handle] = (edge.source, edge.source_handle)

    def topological_sort(self) -> list[str]:
        in_degree: dict[str, int] = defaultdict(int)
        adj: dict[str, set[str]] = defaultdict(set)

        for edge in self.edges:
            if edge.source in self.nodes and edge.target in self.nodes:
                adj[edge.source].add(edge.target)
                in_degree[edge.target] += 1

        queue = deque(
            node_id for node_id in self.nodes if in_degree[node_id] == 0
        )
        result: list[str] = []
        while queue:
            node_id = queue.popleft()
            result.append(node_id)
            for successor in sorted(adj[node_id]):
                in_degree[successor] -= 1
                if in_degree[successor] == 0:
                    queue.append(successor)

        # Include any remaining (cycle fallback)
        seen = set(result)
        for node_id in sorted(self.nodes):
            if node_id not in seen:
                result.append(node_id)

        return result

    async def execute(
        self,
        node_states: dict[str, dict],
        io_values: dict[str, Any],
        now_ms: float | None = None,
        var_store: dict[str, Any] | None = None,
    ) -> tuple[dict[str, dict[str, Any]], dict[str, dict]]:
        """Execute all nodes in topological order.

        Built-in blocks run synchronously (fast path); custom Python code
        blocks are awaited in an isolated subprocess via the sandbox pool.

        `now_ms` is the current time in milliseconds as reported by the
        runtime's clock (real or virtual). It is injected into built-in node
        params under the reserved `_now_ms` key so time-dependent blocks
        (TON/TOFF) can be driven by a virtual clock in tests without calling
        `time.time()` directly. Custom (sandboxed) code blocks run in a
        separate process and are unaffected by this.

        `var_store` is the runtime's mutable {variable_id: value} dict (see
        PLCRuntime._var_values / docs/VARIABLES.md), injected under the
        reserved `_var_store` params key for VAR_READ/VAR_WRITE nodes. It is
        the SAME dict object across the whole scan (not copied), so a
        VAR_WRITE earlier in topological order within one scan is visible to
        a VAR_READ later in the same scan, and any write is visible to every
        node next scan regardless of topological order.

        Returns (current_outputs, new_states).
        """
        current_outputs: dict[str, dict[str, Any]] = {}
        new_states: dict[str, dict] = {}

        for node_id in self.topological_sort():
            node = self.nodes.get(node_id)
            if node is None:
                continue

            executor = EXECUTORS.get(node.type)
            custom_def = None
            if executor is None:
                custom_def = CUSTOM_BLOCKS.get(node.type)
                if custom_def is None:
                    continue

            # Resolve inputs from upstream outputs
            inputs: dict[str, Any] = {}
            for target_handle, (src_id, src_handle) in self.input_map.get(node_id, {}).items():
                if src_id in current_outputs:
                    val = current_outputs[src_id].get(src_handle)
                    if val is not None:
                        inputs[target_handle] = val

            params = dict(node.params)
            if node.type == "DigitalInput":
                params["value"] = io_values.get(node_id, params.get("value", False))

            if executor is not None and now_ms is not None:
                params["_now_ms"] = now_ms
            if executor is not None and var_store is not None:
                params["_var_store"] = var_store

            if executor is not None:
                state = node_states.get(node_id, executor.default_state())
                outputs, new_state = executor.execute(inputs, state, params)
            else:
                state = node_states.get(node_id, {})
                outputs, new_state, error, exec_ms = await sandbox_pool.run(
                    custom_def.code, inputs, state, params
                )
                new_state = dict(new_state)
                if error:
                    # Keep last known-good outputs so the canvas doesn't flicker to blank
                    outputs = state.get("_last_outputs") or {p.name: None for p in custom_def.output_ports}
                    new_state["_error"] = error
                else:
                    new_state.pop("_error", None)
                new_state["_last_outputs"] = outputs
                new_state["_exec_ms"] = round(exec_ms, 3)

            current_outputs[node_id] = outputs
            new_states[node_id] = new_state

        return current_outputs, new_states
