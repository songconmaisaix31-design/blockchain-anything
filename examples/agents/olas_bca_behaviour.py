"""Olas / Open Autonomy AEA compatibility entry for BCA.

This uses the official Open AEA `Behaviour` and `SkillContext` classes. A full
AEA run still requires the agent project, connections and (for Open Autonomy
services) Tendermint/IPFS; this entry proves the skill-side call path without
inventing another scheduler.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

from aea.skills.base import Behaviour, SkillContext

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
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip())
    return json.loads(completed.stdout)


class BcaCallBehaviour(Behaviour):
    """A real AEA Behaviour that calls one configured BCA tool."""

    def setup(self) -> None:
        self.tool = os.environ.get("BCA_OLAS_TOOL", "content_cid")
        self.payload = json.loads(os.environ.get("BCA_OLAS_INPUT", '{"path":"README.md"}'))
        self.last_result: dict | None = None

    def act(self) -> None:
        self.last_result = run_bca(self.tool, self.payload)

    def teardown(self) -> None:
        return None


if __name__ == "__main__":
    context = SkillContext()
    behaviour = BcaCallBehaviour(name="bca-call", skill_context=context)
    behaviour.setup()
    behaviour.act()
    print(json.dumps({
        "sdk": "open-aea",
        "behaviour": behaviour.name,
        "tool": behaviour.tool,
        "result": behaviour.last_result,
        "full_agent_requires": "AEA project + connections; Open Autonomy services also require Tendermint/IPFS",
    }, ensure_ascii=False))
