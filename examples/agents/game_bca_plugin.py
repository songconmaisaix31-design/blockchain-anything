"""Virtuals GAME (Python SDK) compatibility entry for BCA.

The GAME SDK models an action as a Function with a typed argument list. This
module exposes one real GAME Function that invokes the installed BCA CLI with a
fixed subcommand and a JSON payload; it does not implement a second dispatcher
or protocol. A full GAME Agent/Worker run requires GAME_API_KEY from
https://console.game.virtuals.io/ — the --check mode exercises the official
Function contract without calling the hosted planner.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

from game_sdk.game.agent import WorkerConfig
from game_sdk.game.custom_types import Argument, Function, FunctionResultStatus

ROOT = Path(__file__).resolve().parents[2]
CLI = Path(os.environ.get("BCA_CLI", ROOT / "dist" / "cli" / "main.js"))
NODE = os.environ.get("NODE_BIN", "node")


def run_bca(tool: str, payload: dict) -> dict:
    if not re.fullmatch(r"[a-z][a-z0-9_]*", tool):
        raise ValueError(f"invalid BCA tool name: {tool}")
    if not CLI.is_file():
        raise FileNotFoundError(f"BCA CLI not built: {CLI}")
    completed = subprocess.run(
        [NODE, str(CLI), "call", tool, "--input", json.dumps(payload, ensure_ascii=False)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or f"BCA exit {completed.returncode}")
    return json.loads(completed.stdout)


def bca_call(tool: str, input_json: str = "{}"):
    payload = json.loads(input_json) if input_json else {}
    result = run_bca(tool, payload)
    return FunctionResultStatus.DONE, f"BCA tool {tool} completed", {"tool": tool, "result": result}


bca_tool = Function(
    fn_name="bca_call",
    fn_description=(
        "Invoke an installed Blockchain Anything tool through its official CLI. "
        "Use a tool name from `bca tools` and pass its input as a JSON object."
    ),
    args=[
        Argument(name="tool", description="BCA tool name, for example wallet_agentkit_wallet", type="string"),
        Argument(name="input_json", description="JSON object matching the tool input schema", type="string", optional=True),
    ],
    hint='{"tool":"wallet_agentkit_wallet","input_json":"{}"}',
    executable=bca_call,
)


def build_worker() -> WorkerConfig:
    return WorkerConfig(
        id="bca-wallet-worker",
        worker_description="Executes Blockchain Anything wallet, agent and trading tools.",
        get_state_fn=lambda function_result, current_state: {
            "last_bca_result": function_result.info if function_result else None,
            "current_state": current_state,
        },
        action_space=[bca_tool],
        instruction="Call bca_call with an exact BCA tool name and a JSON input object.",
    )


def check() -> int:
    tool = os.environ.get("BCA_CHECK_TOOL", "content_cid")
    payload = os.environ.get("BCA_CHECK_INPUT", '{"path":"README.md"}')
    result = bca_tool.execute(
        fn_id="game-check",
        args={"tool": {"value": tool}, "input_json": {"value": payload}},
    )
    worker = build_worker()
    print(json.dumps({
        "sdk": "game_sdk",
        "function": bca_tool.get_function_def()["fn_name"],
        "status": result.action_status.value,
        "feedback": result.feedback_message,
        "info": result.info,
        "worker": worker.id,
        "actions": list(worker.action_space),
        "full_agent_requires": "GAME_API_KEY from https://console.game.virtuals.io/",
    }, ensure_ascii=False))
    return 0 if result.action_status == FunctionResultStatus.DONE else 1


if __name__ == "__main__":
    if "--check" in sys.argv:
        raise SystemExit(check())
    print("GAME compatibility entry built. Run with --check, or use build_worker() in a GAME Agent.")
