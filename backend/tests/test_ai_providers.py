"""Tests for the AI provider abstraction (backend/ai/providers.py):
provider selection logic (env var combinations), Anthropic<->Gemini tool
schema round-tripping, and Gemini response parsing (including functionCall
handling) via a mocked HTTP client. No real network calls are made.

See docs/VARIABLES.md / DEV_WORKFLOW.md for the wider feature this AI
provider work shipped alongside (variable manager); this file only covers
Part 1 (Gemini support for the AI assistant).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from ai.providers import (  # noqa: E402
    AnthropicProvider,
    GeminiProvider,
    anthropic_tools_to_gemini,
    gemini_tools_to_anthropic,
    select_provider,
)


# ── Provider selection (env var combinations) ───────────────────────────────

@pytest.fixture
def clean_env(monkeypatch):
    for key in ("AI_PROVIDER", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    return monkeypatch


def test_select_provider_none_configured(clean_env):
    assert select_provider() is None


def test_select_provider_anthropic_only(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "ak-123")
    provider = select_provider()
    assert provider is not None
    assert provider.name == "anthropic"
    # `available` requires the underlying anthropic SDK client to have
    # constructed successfully. In some environments the pinned
    # anthropic/httpx combo raises at construction time (unrelated to
    # whether a key was supplied) -- AnthropicProvider degrades to
    # "unavailable" gracefully in that case rather than raising, so this
    # only asserts the provider object exists with the right key recorded,
    # not that the network client construction succeeded.
    assert provider._api_key == "ak-123"


def test_select_provider_gemini_only(clean_env):
    clean_env.setenv("GEMINI_API_KEY", "gk-123")
    provider = select_provider()
    assert provider is not None
    assert provider.name == "gemini"
    assert provider.available


def test_select_provider_both_set_prefers_anthropic(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "ak-123")
    clean_env.setenv("GEMINI_API_KEY", "gk-123")
    provider = select_provider()
    assert provider.name == "anthropic"
    assert provider._api_key == "ak-123"


def test_select_provider_explicit_override_forces_gemini(clean_env):
    # Even with an Anthropic key present, AI_PROVIDER=gemini must win.
    clean_env.setenv("ANTHROPIC_API_KEY", "ak-123")
    clean_env.setenv("GEMINI_API_KEY", "gk-123")
    clean_env.setenv("AI_PROVIDER", "gemini")
    provider = select_provider()
    assert provider.name == "gemini"


def test_select_provider_explicit_override_forces_anthropic(clean_env):
    clean_env.setenv("GEMINI_API_KEY", "gk-123")
    clean_env.setenv("AI_PROVIDER", "anthropic")
    provider = select_provider()
    assert provider.name == "anthropic"
    # No ANTHROPIC_API_KEY set -> provider exists but reports unavailable.
    assert not provider.available


# ── Tool schema conversion round-trip ───────────────────────────────────────

SAMPLE_TOOLS = [
    {
        "name": "add_node",
        "description": "Add a new block",
        "input_schema": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["AND", "OR"]},
                "id": {"type": "string"},
                "position": {
                    "type": "object",
                    "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
                    "required": ["x", "y"],
                },
            },
            "required": ["type", "id"],
        },
    },
    {
        "name": "get_program",
        "description": "Get the current program",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]


def test_anthropic_tools_to_gemini_shape():
    gemini_tools = anthropic_tools_to_gemini(SAMPLE_TOOLS)
    assert len(gemini_tools) == 1
    decls = gemini_tools[0]["function_declarations"]
    assert len(decls) == 2
    add_node_decl = next(d for d in decls if d["name"] == "add_node")
    assert add_node_decl["description"] == "Add a new block"
    assert "parameters" in add_node_decl
    assert add_node_decl["parameters"]["type"] == "object"
    assert set(add_node_decl["parameters"]["properties"].keys()) == {"type", "id", "position"}
    assert add_node_decl["parameters"]["required"] == ["type", "id"]
    # Nested object schema (position.x/y) preserved through conversion.
    pos_schema = add_node_decl["parameters"]["properties"]["position"]
    assert set(pos_schema["properties"].keys()) == {"x", "y"}


def test_gemini_tools_to_anthropic_round_trip():
    gemini_tools = anthropic_tools_to_gemini(SAMPLE_TOOLS)
    declarations = gemini_tools[0]["function_declarations"]
    back = gemini_tools_to_anthropic(declarations)
    assert len(back) == len(SAMPLE_TOOLS)
    by_name = {t["name"]: t for t in back}
    assert by_name["add_node"]["input_schema"]["required"] == ["type", "id"]
    assert set(by_name["add_node"]["input_schema"]["properties"].keys()) == {"type", "id", "position"}
    assert by_name["get_program"]["input_schema"]["properties"] == {}


# ── Gemini response parsing (mocked httpx) ──────────────────────────────────

class _FakeResponse:
    def __init__(self, json_body: dict, status_code: int = 200):
        self._json_body = json_body
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._json_body


class _FakeHttpClient:
    """Stand-in for httpx.AsyncClient: records requests, replays a scripted
    sequence of responses (one per .post call) so multi-turn tool-use loops
    can be exercised without any real network access."""

    def __init__(self, responses: list[dict]):
        self._responses = list(responses)
        self.requests: list[dict] = []

    async def post(self, url, params=None, json=None):
        self.requests.append({"url": url, "params": params, "json": json})
        body = self._responses.pop(0)
        return _FakeResponse(body)

    async def aclose(self):
        pass


def _text_response(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def _function_call_response(name: str, args: dict) -> dict:
    return {
        "candidates": [
            {"content": {"parts": [{"functionCall": {"name": name, "args": args}}]}}
        ]
    }


@pytest.mark.asyncio
async def test_gemini_provider_plain_text_response_no_tools():
    fake_client = _FakeHttpClient([_text_response("Hello from Gemini")])
    provider = GeminiProvider(api_key="gk-test", http_client=fake_client)

    async def run_tool(name, args):
        raise AssertionError("tool should not be called for a plain text response")

    text, tool_log = await provider.run_turn([], "hi", [], "system prompt", run_tool)
    assert text == "Hello from Gemini"
    assert tool_log == []
    assert len(fake_client.requests) == 1
    sent = fake_client.requests[0]["json"]
    assert sent["systemInstruction"]["parts"][0]["text"] == "system prompt"
    assert "tools" not in sent  # no tools were passed in


@pytest.mark.asyncio
async def test_gemini_provider_function_call_then_final_text():
    fake_client = _FakeHttpClient([
        _function_call_response("get_program", {}),
        _text_response("Added the block you asked for."),
    ])
    provider = GeminiProvider(api_key="gk-test", http_client=fake_client)

    calls = []

    async def run_tool(name, args):
        calls.append((name, args))
        return {"nodes": [], "edges": []}

    text, tool_log = await provider.run_turn([], "build me something", SAMPLE_TOOLS, "sys", run_tool)

    assert text == "Added the block you asked for."
    assert calls == [("get_program", {})]
    assert len(tool_log) == 1
    assert tool_log[0]["name"] == "get_program"
    assert tool_log[0]["result"] == {"nodes": [], "edges": []}

    # Second request must include the model's function call + our
    # functionResponse appended to `contents`.
    assert len(fake_client.requests) == 2
    second_payload = fake_client.requests[1]["json"]
    roles = [c["role"] for c in second_payload["contents"]]
    assert roles == ["user", "model", "user"]
    fn_response_part = second_payload["contents"][-1]["parts"][0]
    assert fn_response_part["functionResponse"]["name"] == "get_program"


@pytest.mark.asyncio
async def test_gemini_provider_wraps_non_dict_tool_result():
    fake_client = _FakeHttpClient([
        _function_call_response("test_custom_block", {"code": "..."}),
        _text_response("done"),
    ])
    provider = GeminiProvider(api_key="gk-test", http_client=fake_client)

    async def run_tool(name, args):
        return 42  # non-dict result

    await provider.run_turn([], "test it", SAMPLE_TOOLS, "sys", run_tool)
    second_payload = fake_client.requests[1]["json"]
    fn_response = second_payload["contents"][-1]["parts"][0]["functionResponse"]
    assert fn_response["response"] == {"result": 42}


@pytest.mark.asyncio
async def test_gemini_provider_no_candidates_returns_empty():
    fake_client = _FakeHttpClient([{"candidates": []}])
    provider = GeminiProvider(api_key="gk-test", http_client=fake_client)

    async def run_tool(name, args):
        raise AssertionError("should not be called")

    text, tool_log = await provider.run_turn([], "hi", [], "sys", run_tool)
    assert text == ""
    assert tool_log == []


def test_gemini_provider_available_reflects_api_key():
    assert GeminiProvider(api_key="").available is False
    assert GeminiProvider(api_key="gk-123").available is True


def test_anthropic_provider_unavailable_without_key():
    provider = AnthropicProvider(api_key="")
    assert provider.available is False


# ── run_assistant() end-to-end with the "not configured" path ──────────────

@pytest.mark.asyncio
async def test_run_assistant_not_configured_message(monkeypatch):
    """When neither API key is set, run_assistant must return the graceful
    'not configured' message (existing behavior) rather than raising."""
    import ai.assistant as assistant_module

    monkeypatch.setattr(assistant_module, "_provider", None)
    monkeypatch.setattr(assistant_module, "_AVAILABLE", False)

    response = await assistant_module.run_assistant("hello", [])
    assert "not configured" in response.message
    assert response.tool_calls == []
    assert response.pending_ops == []


@pytest.mark.asyncio
async def test_run_assistant_uses_gemini_provider_end_to_end(monkeypatch):
    """Full round trip through run_assistant() with a fake Gemini provider,
    verifying tool execution actually reaches the real _execute_tool_async
    dispatcher (get_program) and the response shape matches AIChatResponse."""
    import ai.assistant as assistant_module

    fake_client = _FakeHttpClient([
        _function_call_response("get_program", {}),
        _text_response("Here is your program."),
    ])
    gemini = GeminiProvider(api_key="gk-test", http_client=fake_client)
    monkeypatch.setattr(assistant_module, "_provider", gemini)
    monkeypatch.setattr(assistant_module, "_AVAILABLE", True)

    response = await assistant_module.run_assistant("what's in my program?", [])
    assert response.message == "Here is your program."
    assert len(response.tool_calls) == 1
    assert response.tool_calls[0]["name"] == "get_program"
