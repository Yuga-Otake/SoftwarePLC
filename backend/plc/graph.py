from collections import defaultdict, deque
from typing import Any
from .models import ProgramGraph
from .nodes import EXECUTORS
from .custom_blocks import CUSTOM_BLOCKS
from .sandbox import sandbox_pool


class PLCGraph:
    def __init__(self, graph: ProgramGraph):
        self.nodes = {n.id: n for n in graph.nodes}
        self.edges = list(graph.edges)
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
    ) -> tuple[dict[str, dict[str, Any]], dict[str, dict]]:
        """Execute all nodes in topological order.

        Built-in blocks run synchronously (fast path); custom Python code
        blocks are awaited in an isolated subprocess via the sandbox pool.

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
