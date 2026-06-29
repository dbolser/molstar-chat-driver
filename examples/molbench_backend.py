#!/usr/bin/env python3
"""A model-backed chat backend for molstar-chat-driver, powered by MolBench.

This speaks the same contract the demo's keyword stub does —
    POST /chat  { "prompt": "...", "model": "anthropic:claude-haiku-4-5" }
             -> { "mvsj": "<MVSJ text>" | null, "text"?: "...", "error"?: "..." }
    GET  /models -> { "models": ["..."], "default": "..." }
— but the brains are MolBench's: its schema-primed system prompt and provider
adapters. Any improvement to the prompt, grounding, or harness in MolBench flows
through here with no change to the plugin or the contract.

Prerequisites
-------------
    pip install -e /path/to/MolBench         # makes `molbench` importable
    # provide keys (any of these), e.g. via MolBench's own .env in the cwd:
    #   ANTHROPIC_API_KEY=...  OPENAI_API_KEY=...  GEMINI_API_KEY=...  OPENROUTER_API_KEY=...

Run
---
    python examples/molbench_backend.py            # http://localhost:8787
    PORT=9000 MCD_MODEL=gemini:gemini-2.5-flash python examples/molbench_backend.py

Then point the plugin at it: createHttpBackend('http://localhost:8787/chat').
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from molbench.models import build_model
from molbench.mvs import extract_root
from molbench.runner import build_system_prompts, extract_json_object

PORT = int(os.environ.get("PORT", "8787"))
DEFAULT_MODEL = os.environ.get("MCD_MODEL", "anthropic:claude-haiku-4-5")

# MolBench's real NL->MVS system prompt (schema-primed). This is the value the
# demo's 4-line stub can't match — and the thing MolBench keeps improving.
SYSTEM = build_system_prompts()["mvs"]

# One representative model per provider, offered in the picker when that key is set.
_PROVIDER_DEFAULT = {
    "ANTHROPIC_API_KEY": "anthropic:claude-haiku-4-5",
    "OPENAI_API_KEY": "openai:gpt-4o-mini",
    "GEMINI_API_KEY": "gemini:gemini-2.5-flash",
}


def _load_dotenv() -> None:
    """Best-effort load of a .env in the cwd (e.g. MolBench's), so keys are present."""
    path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def available_models() -> list[str]:
    models = [spec for key, spec in _PROVIDER_DEFAULT.items() if os.environ.get(key)]
    return models or [DEFAULT_MODEL]


def chat(prompt: str, model: str | None) -> dict:
    spec = model or DEFAULT_MODEL
    try:
        raw = build_model(spec).generate(SYSTEM, prompt)
    except Exception as e:  # noqa: BLE001 - surface any provider/setup error to the UI
        return {"mvsj": None, "error": f"{type(e).__name__}: {e}"}
    tree, err = extract_json_object(raw)  # strips ``` fences / prose, parses JSON
    root = None if (err or tree is None) else extract_root(tree)
    if root is None:
        return {"mvsj": None, "text": raw}  # no scene — show the raw reply so failures are visible
    # MolBench's prompt yields a bare {root} tree (its grader needs no envelope), but Mol*
    # requires a full MVS state with metadata.version — wrap it so the scene actually renders.
    mvsj = {"metadata": {"version": "1", "timestamp": datetime.now(timezone.utc).isoformat()}, "root": root}
    return {"mvsj": json.dumps(mvsj)}


class Handler(BaseHTTPRequestHandler):
    def _send(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802 - http.server naming
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/models":
            models = available_models()
            default = DEFAULT_MODEL if DEFAULT_MODEL in models else models[0]
            return self._send({"models": models, "default": default})
        self._send({"error": "not found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0") or "0")
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            data = {}
        self._send(chat(data.get("prompt", ""), data.get("model")))

    def log_message(self, *args) -> None:  # quieter console
        pass


def main() -> None:
    _load_dotenv()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"  MolBench chat backend → http://localhost:{PORT}/chat  [default: {DEFAULT_MODEL}]")
    print(f"  models available: {', '.join(available_models())}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
