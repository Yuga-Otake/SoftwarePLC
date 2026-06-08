"""Process-isolated execution pool for user/AI-written custom code blocks.

Each worker is a separate OS process so that runaway or crashing user code
cannot affect the main PLC engine. Workers that exceed the timeout are
terminated and replaced (multiprocessing.Process is used directly, rather
than ProcessPoolExecutor, because individual stuck workers must be
terminate()-able).

Defense in depth:
  1. Process boundary   — crashes/infinite loops stay isolated
  2. Resource limits    — CPU time & memory capped via resource.setrlimit
  3. Restricted globals — only a safe subset of builtins + a module allowlist
  4. Timeout + restart  — jobs that don't return in time kill their worker
"""

from __future__ import annotations

import asyncio
import builtins
import multiprocessing as mp
import queue
import time
from typing import Any

# ── Restricted execution environment for user code ──────────────────────────

_SAFE_BUILTIN_NAMES = (
    "abs", "all", "any", "bool", "dict", "divmod", "enumerate", "filter",
    "float", "frozenset", "int", "isinstance", "len", "list", "map", "max",
    "min", "pow", "print", "range", "reversed", "round", "set", "sorted",
    "str", "sum", "tuple", "zip", "True", "False", "None",
)

# Pure-stdlib modules that are safe to import in a sandboxed subprocess
# (no filesystem/network/process access). This is the practical compromise
# for "writing blocks in Python without pulling in arbitrary pip libraries".
_ALLOWED_MODULES = {
    "math", "statistics", "random", "re", "json", "datetime", "time",
    "collections", "itertools", "functools", "string",
}


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if name.split(".")[0] not in _ALLOWED_MODULES:
        raise ImportError(
            f"module '{name}' is not available in custom code blocks "
            f"(allowed: {', '.join(sorted(_ALLOWED_MODULES))})"
        )
    return builtins.__import__(name, globals, locals, fromlist, level)


def _make_safe_globals() -> dict[str, Any]:
    safe_builtins = {n: getattr(builtins, n) for n in _SAFE_BUILTIN_NAMES if hasattr(builtins, n)}
    safe_builtins["__import__"] = _safe_import
    return {"__builtins__": safe_builtins}


# ── Worker process entry point ───────────────────────────────────────────────

def _apply_resource_limits():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
        # RLIMIT_AS caps virtual address space, not actual (RSS) usage. A forked
        # worker inherits the parent's mappings (asyncio loop, multiprocessing
        # queues/semaphores accumulated across respawns, etc.), whose VSZ alone
        # settles around ~256MB in this process — a tighter limit here makes
        # every allocation in the child fail immediately with MemoryError,
        # which looks like a hung/timed-out worker from the pool's perspective.
        # 1GB leaves headroom above that baseline while still catching genuine
        # runaway allocations (e.g. building huge lists/strings).
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
    except Exception:
        pass  # not available on all platforms (e.g. some sandboxes)


def _worker_main(input_q: mp.Queue, output_q: mp.Queue):
    _apply_resource_limits()
    compiled_cache: dict[str, Any] = {}

    while True:
        try:
            job = input_q.get()
        except (EOFError, OSError):
            break
        if job is None:
            break

        code, inputs, state, params = job
        t0 = time.monotonic()
        try:
            fn = compiled_cache.get(code)
            if fn is None:
                namespace = _make_safe_globals()
                exec(compile(code, "<custom_block>", "exec"), namespace)
                fn = namespace.get("execute")
                if fn is None or not callable(fn):
                    raise RuntimeError("code must define a function: execute(inputs, state, params)")
                compiled_cache.clear()
                compiled_cache[code] = fn

            outputs, new_state = fn(dict(inputs), dict(state), dict(params))
            elapsed_ms = (time.monotonic() - t0) * 1000
            output_q.put((dict(outputs), dict(new_state), None, elapsed_ms))
        except Exception as exc:
            elapsed_ms = (time.monotonic() - t0) * 1000
            output_q.put(({}, dict(state), f"{type(exc).__name__}: {exc}", elapsed_ms))


def _blocking_get(q: mp.Queue, timeout: float):
    return q.get(timeout=timeout)


# ── Worker handle & pool ─────────────────────────────────────────────────────

class _Worker:
    def __init__(self):
        self.input_q: mp.Queue = mp.Queue()
        self.output_q: mp.Queue = mp.Queue()
        self.process = mp.Process(
            target=_worker_main, args=(self.input_q, self.output_q), daemon=True
        )
        self.process.start()
        self.lock = asyncio.Lock()

    def terminate(self):
        try:
            self.process.terminate()
            self.process.join(timeout=1.0)
        except Exception:
            pass
        for q in (self.input_q, self.output_q):
            try:
                q.close()
            except Exception:
                pass


class SandboxPool:
    """Pool of persistent, isolated worker processes for custom code blocks."""

    def __init__(self, num_workers: int = 2, timeout_ms: float = 200.0):
        self.num_workers = num_workers
        self.timeout_ms = timeout_ms
        self._workers: list[_Worker] = []
        self._rr_index = 0
        self._started = False

    def start(self):
        if self._started:
            return
        self._workers = [_Worker() for _ in range(self.num_workers)]
        self._started = True

    def stop(self):
        for w in self._workers:
            w.terminate()
        self._workers = []
        self._started = False

    async def run(
        self,
        code: str,
        inputs: dict[str, Any],
        state: dict[str, Any],
        params: dict[str, Any],
        timeout_ms: float | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any], str | None, float]:
        """Execute `code`'s execute(inputs, state, params) in an isolated process.

        Returns (outputs, new_state, error_or_None, elapsed_ms).
        On timeout the worker is terminated and respawned, and an error is returned.
        """
        if not self._started:
            self.start()

        timeout = (timeout_ms if timeout_ms is not None else self.timeout_ms) / 1000.0
        idx = self._rr_index
        self._rr_index = (self._rr_index + 1) % len(self._workers)
        worker = self._workers[idx]

        async with worker.lock:
            return await self._run_on_worker(idx, code, inputs, state, params, timeout)

    async def _run_on_worker(self, idx, code, inputs, state, params, timeout):
        worker = self._workers[idx]
        loop = asyncio.get_running_loop()

        # Drain stale results from a previous timeout, if any
        while True:
            try:
                worker.output_q.get_nowait()
            except queue.Empty:
                break

        worker.input_q.put((code, dict(inputs), dict(state), dict(params)))
        try:
            outputs, new_state, error, elapsed_ms = await loop.run_in_executor(
                None, _blocking_get, worker.output_q, timeout
            )
            return outputs, new_state, error, elapsed_ms
        except queue.Empty:
            worker.terminate()
            self._workers[idx] = _Worker()
            return (
                {},
                dict(state),
                f"タイムアウト: {timeout * 1000:.0f}ms以内に応答がなかったためプロセスを再起動しました",
                timeout * 1000,
            )


sandbox_pool = SandboxPool()
