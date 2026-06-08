"""Claude AI assistant with tool use for PLC program manipulation."""

import json
import os
import uuid
from typing import Any

from plc.models import AIChatResponse, PendingOperation
from plc.nodes import NODE_CATALOG
from plc import custom_blocks
from plc.sandbox import sandbox_pool
from plc.runtime import runtime

try:
    import anthropic
    _client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    _AVAILABLE = bool(os.getenv("ANTHROPIC_API_KEY"))
except ImportError:
    _client = None
    _AVAILABLE = False

MODEL = "claude-sonnet-4-6"

_TOOLS = [
    {
        "name": "get_program",
        "description": "Get the current PLC program (all nodes and edges)",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_runtime_state",
        "description": "Get the current runtime state of all blocks (live output values)",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "add_node",
        "description": "Add a new block to the PLC program canvas",
        "input_schema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "description": "Block type",
                    "enum": list(NODE_CATALOG.keys()),
                },
                "id": {"type": "string", "description": "Unique ID for this block"},
                "params": {"type": "object", "description": "Block parameters (e.g. PT for TON, PV for CTU)"},
                "position": {
                    "type": "object",
                    "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                    "required": ["x", "y"],
                },
                "label": {"type": "string", "description": "Human-readable label"},
            },
            "required": ["type", "id", "position"],
        },
    },
    {
        "name": "add_edge",
        "description": "Connect an output port of one block to an input port of another",
        "input_schema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Source node ID"},
                "source_handle": {"type": "string", "description": "Source port name (e.g. OUT, Q, ET)"},
                "target": {"type": "string", "description": "Target node ID"},
                "target_handle": {"type": "string", "description": "Target port name (e.g. IN, IN1, CU)"},
            },
            "required": ["source", "source_handle", "target", "target_handle"],
        },
    },
    {
        "name": "delete_node",
        "description": "Remove a block and all its connections",
        "input_schema": {
            "type": "object",
            "properties": {"node_id": {"type": "string"}},
            "required": ["node_id"],
        },
    },
    {
        "name": "set_parameter",
        "description": "Change a block's parameter (e.g. timer preset time)",
        "input_schema": {
            "type": "object",
            "properties": {
                "node_id": {"type": "string"},
                "params": {"type": "object", "description": "Parameters to update"},
            },
            "required": ["node_id", "params"],
        },
    },
    {
        "name": "create_custom_block",
        "description": (
            "Create a new reusable block whose logic is written in Python. Use this when "
            "the desired behavior is awkward to express by wiring together existing blocks "
            "(e.g. unit conversion, string/number processing, custom math). The code runs "
            "in an isolated sandboxed process each scan cycle, with the exact same contract "
            "as a built-in block: a top-level function "
            "`execute(inputs: dict, state: dict, params: dict) -> tuple[dict, dict]` "
            "that returns (outputs, new_state). Only these stdlib modules may be imported: "
            "math, statistics, random, re, json, datetime, time, collections, itertools, "
            "functools, string. No file/network/process access is available. "
            "Always call test_custom_block afterwards to verify it works before explaining it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Human-readable block name"},
                "description": {"type": "string", "description": "What the block does"},
                "code": {
                    "type": "string",
                    "description": "Python source defining execute(inputs, state, params) -> (outputs, new_state)",
                },
                "input_ports": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "data_type": {"type": "string", "enum": ["bool", "int", "float", "str"]},
                            "description": {"type": "string"},
                        },
                        "required": ["name", "data_type"],
                    },
                },
                "output_ports": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "data_type": {"type": "string", "enum": ["bool", "int", "float", "str"]},
                            "description": {"type": "string"},
                        },
                        "required": ["name", "data_type"],
                    },
                },
                "params_schema": {"type": "object", "description": "Map of param name -> default value"},
            },
            "required": ["name", "code", "input_ports", "output_ports"],
        },
    },
    {
        "name": "test_custom_block",
        "description": "Run a custom block's code once in the sandbox with sample inputs to verify it works before creating it",
        "input_schema": {
            "type": "object",
            "properties": {
                "code": {"type": "string"},
                "inputs": {"type": "object", "description": "Sample input values, e.g. {\"IN\": true}"},
                "params": {"type": "object", "description": "Sample parameter values"},
            },
            "required": ["code"],
        },
    },
]

_SYSTEM_PROMPT = """You are an expert PLC (Programmable Logic Controller) programmer and assistant.
You help users build automation logic using Function Block Diagram (FBD) blocks.

Available block types:
- DigitalInput: External input signal (can be toggled from UI). Output: OUT(bool)
- DigitalOutput: External output signal (displayed in UI). Input: IN(bool)
- AND: Logical AND of all connected inputs. Inputs: IN1-IN4(bool). Output: OUT(bool)
- OR: Logical OR of all connected inputs. Inputs: IN1-IN4(bool). Output: OUT(bool)
- NOT: Logical NOT. Input: IN(bool). Output: OUT(bool)
- TON: On-delay timer. Inputs: IN(bool). Params: PT(ms). Outputs: Q(bool), ET(float ms)
- TOFF: Off-delay timer. Input: IN(bool). Params: PT(ms). Outputs: Q(bool), ET(float ms)
- CTU: Count-up counter. Inputs: CU(bool), R(bool). Params: PV(int). Outputs: Q(bool), CV(int)
- SR: Set-dominant flip-flop. Inputs: S(bool), R(bool). Output: Q(bool)
- RS: Reset-dominant flip-flop. Inputs: S(bool), R(bool). Output: Q(bool)
- COMP: Comparator. Input: IN(float). Params: LIMIT(float), OP(str: >, <, >=, <=, ==). Output: OUT(bool)

When designing programs:
1. Data flows left to right: inputs → logic → outputs
2. Use SR/RS flip-flops for latching (memory) behavior
3. Use TON for on-delay, TOFF for off-delay
4. Use CTU for counting events
5. Position blocks at reasonable coordinates (x: 100-1200, y: 50-600)

You can also create new block types written in Python with `create_custom_block`,
for logic that's awkward to express by wiring built-in blocks together (unit
conversion, string/number processing, custom formulas, etc). The code is executed
in an isolated sandboxed subprocess every scan cycle using the exact same contract
as built-in blocks: a function `execute(inputs, state, params) -> (outputs, new_state)`.
Always verify the code with `test_custom_block` before finalizing it — this keeps the
process transparent and trustworthy. Once created, the block appears in the palette
and can be wired in like any other block.

Always use the tools to inspect the current program before making changes.
After making changes, briefly explain what you added and how it works."""


def _execute_tool(tool_name: str, tool_input: dict) -> Any:
    """Execute a tool call and return the result."""
    if tool_name == "get_program":
        return runtime.get_program().model_dump()

    if tool_name == "get_runtime_state":
        return runtime.get_current_state()

    if tool_name == "add_node":
        op = PendingOperation(
            op="add_node",
            payload={
                "id": tool_input.get("id") or f"{tool_input['type'].lower()}_{uuid.uuid4().hex[:6]}",
                "type": tool_input["type"],
                "params": tool_input.get("params", {}),
                "position": tool_input.get("position", {"x": 300, "y": 200}),
                "label": tool_input.get("label", ""),
            },
        )
        runtime.pending_ops.append(op)
        return {"ok": True, "id": op.payload["id"]}

    if tool_name == "add_edge":
        op = PendingOperation(
            op="add_edge",
            payload={
                "id": f"e_{uuid.uuid4().hex[:8]}",
                "source": tool_input["source"],
                "source_handle": tool_input["source_handle"],
                "target": tool_input["target"],
                "target_handle": tool_input["target_handle"],
            },
        )
        runtime.pending_ops.append(op)
        return {"ok": True}

    if tool_name == "delete_node":
        op = PendingOperation(op="delete_node", payload={"node_id": tool_input["node_id"]})
        runtime.pending_ops.append(op)
        return {"ok": True}

    if tool_name == "set_parameter":
        op = PendingOperation(
            op="set_parameter",
            payload={"node_id": tool_input["node_id"], "params": tool_input["params"]},
        )
        runtime.pending_ops.append(op)
        return {"ok": True}

    if tool_name == "create_custom_block":
        block_id = f"custom_{tool_input['name'].lower().replace(' ', '_')}_{uuid.uuid4().hex[:6]}"
        op = PendingOperation(
            op="create_custom_block",
            payload={
                "id": block_id,
                "name": tool_input["name"],
                "description": tool_input.get("description", ""),
                "code": tool_input["code"],
                "input_ports": tool_input.get("input_ports", []),
                "output_ports": tool_input.get("output_ports", []),
                "params_schema": tool_input.get("params_schema", {}),
            },
        )
        runtime.pending_ops.append(op)
        return {"ok": True, "id": block_id}

    return {"error": f"Unknown tool: {tool_name}"}


async def _execute_tool_async(tool_name: str, tool_input: dict) -> Any:
    """Async tools (those that need to await the sandboxed process pool)."""
    if tool_name == "test_custom_block":
        outputs, new_state, error, exec_ms = await sandbox_pool.run(
            tool_input["code"],
            tool_input.get("inputs", {}),
            {},
            tool_input.get("params", {}),
        )
        return {"outputs": outputs, "new_state": new_state, "error": error, "exec_ms": round(exec_ms, 3)}

    return _execute_tool(tool_name, tool_input)


async def run_assistant(message: str, history: list[dict]) -> AIChatResponse:
    if not _AVAILABLE or _client is None:
        return AIChatResponse(
            message="AI assistant is not configured. Set ANTHROPIC_API_KEY environment variable.",
            tool_calls=[],
            pending_ops=[],
        )

    # Clear previous pending ops
    runtime.pending_ops = []

    messages = list(history) + [{"role": "user", "content": message}]
    tool_call_log: list[dict] = []

    while True:
        response = _client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=_SYSTEM_PROMPT,
            tools=_TOOLS,
            messages=messages,
        )

        # Collect tool uses
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        text_blocks = [b for b in response.content if b.type == "text"]

        if not tool_uses:
            # Final response
            final_text = " ".join(b.text for b in text_blocks)
            return AIChatResponse(
                message=final_text,
                tool_calls=tool_call_log,
                pending_ops=[op.model_dump() for op in runtime.pending_ops],
            )

        # Execute tools and record results
        tool_results = []
        for tu in tool_uses:
            result = await _execute_tool_async(tu.name, tu.input)
            tool_call_log.append({
                "name": tu.name,
                "input": tu.input,
                "result": result,
            })
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tu.id,
                "content": json.dumps(result),
            })

        # Append assistant message and tool results
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})
