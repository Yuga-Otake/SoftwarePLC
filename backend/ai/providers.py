"""AI provider abstraction: Anthropic (tool use) and Gemini (function calling).

`assistant.py` drives a provider-agnostic conversation loop against whichever
`AIProvider` is selected (see `select_provider`). Both providers expose the
same three-method contract:

    provider.available            -> bool
    provider.name                 -> "anthropic" | "gemini"
    await provider.run_turn(messages, tools, system_prompt, run_tool)

`run_turn` performs ONE full assistant turn: it may call tools zero or more
times (invoking the provided async `run_tool(name, input) -> Any` callback
for each), and returns the final `(text, tool_call_log)` once the model stops
requesting tool calls. `messages` is a provider-native running conversation
list that the caller (assistant.py) owns and reuses across turns; each
provider knows how to append to its own message format.

Anthropic uses the official SDK (`anthropic` package, unchanged from the
original implementation). Gemini has no new SDK dependency: it's a thin
`httpx`-based REST client against the `generateContent` endpoint, keeping the
project's existing dependency footprint unchanged per the task requirements.
"""

from __future__ import annotations

import json
import os
from typing import Any, Awaitable, Callable

RunTool = Callable[[str, dict], Awaitable[Any]]


# ── Tool schema conversion ──────────────────────────────────────────────────
# Tools are authored once, in Anthropic's `input_schema` shape (the original
# format used throughout this codebase). Gemini's function-calling format
# uses `parameters` instead of `input_schema` and does not support JSON
# Schema's `additionalProperties`/certain keywords, but for the schemas this
# project defines (plain object/array/string/number/boolean/enum) a
# structural copy with the key renamed is sufficient.

def anthropic_tools_to_gemini(tools: list[dict]) -> list[dict]:
    """Convert Anthropic-style tool defs (`input_schema`) into a single Gemini
    `tools` entry with `function_declarations` (`parameters`)."""
    def convert_schema(schema: dict) -> dict:
        if not isinstance(schema, dict):
            return schema
        out: dict[str, Any] = {}
        for k, v in schema.items():
            if k == "properties" and isinstance(v, dict):
                out[k] = {pk: convert_schema(pv) for pk, pv in v.items()}
            elif k == "items" and isinstance(v, dict):
                out[k] = convert_schema(v)
            else:
                out[k] = v
        return out

    declarations = []
    for t in tools:
        declarations.append({
            "name": t["name"],
            "description": t.get("description", ""),
            "parameters": convert_schema(t.get("input_schema", {"type": "object", "properties": {}})),
        })
    return [{"function_declarations": declarations}]


def gemini_tools_to_anthropic(function_declarations: list[dict]) -> list[dict]:
    """Inverse of the above -- mostly used by tests to verify round-tripping,
    but also documents the shape so future providers can reuse it."""
    tools = []
    for d in function_declarations:
        tools.append({
            "name": d["name"],
            "description": d.get("description", ""),
            "input_schema": d.get("parameters", {"type": "object", "properties": {}}),
        })
    return tools


class AIProvider:
    """Common interface implemented by AnthropicProvider / GeminiProvider."""

    name: str = ""

    @property
    def available(self) -> bool:
        raise NotImplementedError

    async def run_turn(
        self,
        history: list[dict],
        message: str,
        tools: list[dict],
        system_prompt: str,
        run_tool: RunTool,
    ) -> tuple[str, list[dict]]:
        """Run a full conversation turn (including any tool-use round trips)
        and return (final_text, tool_call_log)."""
        raise NotImplementedError


class AnthropicProvider(AIProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str | None = None):
        self._api_key = api_key
        self.model = model or os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
        self._client = None
        if api_key:
            try:
                import anthropic
                self._client = anthropic.Anthropic(api_key=api_key)
            except Exception:
                # Constructing the SDK client can fail for reasons unrelated
                # to whether an API key was supplied (e.g. an
                # anthropic/httpx version mismatch raising TypeError at
                # construction time). Treat any such failure the same as
                # "SDK not installed": the provider reports itself as
                # unavailable rather than crashing provider selection /
                # module import.
                self._client = None

    @property
    def available(self) -> bool:
        return bool(self._api_key) and self._client is not None

    async def run_turn(self, history, message, tools, system_prompt, run_tool):
        messages = list(history) + [{"role": "user", "content": message}]
        tool_call_log: list[dict] = []

        while True:
            response = self._client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=system_prompt,
                tools=tools,
                messages=messages,
            )

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            text_blocks = [b for b in response.content if b.type == "text"]

            if not tool_uses:
                final_text = " ".join(b.text for b in text_blocks)
                return final_text, tool_call_log

            tool_results = []
            for tu in tool_uses:
                result = await run_tool(tu.name, tu.input)
                tool_call_log.append({"name": tu.name, "input": tu.input, "result": result})
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": json.dumps(result),
                })

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})


class GeminiProvider(AIProvider):
    """REST-based Gemini function-calling client (no `google-generativeai`
    SDK dependency -- uses the project's existing `httpx` dependency)."""

    name = "gemini"
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: str, model: str | None = None, http_client=None):
        self._api_key = api_key
        self.model = model or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        # `http_client` injection point for tests (an httpx.AsyncClient-like
        # object with `.post(url, json=...) -> Response`).
        self._http_client = http_client

    @property
    def available(self) -> bool:
        return bool(self._api_key)

    def _client(self):
        if self._http_client is not None:
            return self._http_client
        import httpx
        return httpx.AsyncClient(timeout=60.0)

    async def _post(self, client, payload: dict) -> dict:
        url = f"{self.BASE_URL}/{self.model}:generateContent"
        resp = await client.post(url, params={"key": self._api_key}, json=payload)
        resp.raise_for_status()
        return resp.json()

    async def run_turn(self, history, message, tools, system_prompt, run_tool):
        # `history` here is a list of Gemini `contents` entries (role/parts),
        # not Anthropic-shaped -- assistant.py keeps per-provider history.
        contents = list(history) + [{"role": "user", "parts": [{"text": message}]}]
        gemini_tools = anthropic_tools_to_gemini(tools) if tools else None
        tool_call_log: list[dict] = []

        owns_client = self._http_client is None
        client = self._client()
        try:
            while True:
                payload: dict[str, Any] = {
                    "contents": contents,
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                }
                if gemini_tools:
                    payload["tools"] = gemini_tools

                data = await self._post(client, payload)
                candidates = data.get("candidates") or []
                if not candidates:
                    return "", tool_call_log

                parts = candidates[0].get("content", {}).get("parts", [])
                function_calls = [p["functionCall"] for p in parts if "functionCall" in p]
                text_parts = [p.get("text", "") for p in parts if "text" in p]

                if not function_calls:
                    return " ".join(t for t in text_parts if t), tool_call_log

                # Model's turn (including function call parts) must be
                # echoed back into the conversation before our response.
                contents.append({"role": "model", "parts": parts})

                response_parts = []
                for fc in function_calls:
                    fn_name = fc.get("name", "")
                    fn_args = fc.get("args", {}) or {}
                    result = await run_tool(fn_name, fn_args)
                    tool_call_log.append({"name": fn_name, "input": fn_args, "result": result})
                    response_parts.append({
                        "functionResponse": {
                            "name": fn_name,
                            "response": _as_gemini_function_response(result),
                        }
                    })
                contents.append({"role": "user", "parts": response_parts})
        finally:
            if owns_client:
                await client.aclose()


def _as_gemini_function_response(result: Any) -> dict:
    """Gemini expects `functionResponse.response` to be an object; wrap
    non-dict results (lists, primitives) so arbitrary tool results round-trip
    cleanly."""
    if isinstance(result, dict):
        return result
    return {"result": result}


def select_provider() -> AIProvider | None:
    """Pick a provider based on `AI_PROVIDER` env var, or auto-detect from
    which API key is present. Returns None if nothing is configured (existing
    "not configured" behavior preserved)."""
    forced = os.getenv("AI_PROVIDER", "").strip().lower()
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")

    if forced == "anthropic":
        return AnthropicProvider(anthropic_key)
    if forced == "gemini":
        return GeminiProvider(gemini_key)

    if anthropic_key:
        return AnthropicProvider(anthropic_key)
    if gemini_key:
        return GeminiProvider(gemini_key)
    return None
