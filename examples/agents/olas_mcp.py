"""MCP consumer for an existing Olas/Open Autonomy skill. Requires `pip install mcp`.

The host agent owns scheduling and approval. BCA supplies tools only.
Run: python examples/agents/olas_mcp.py /absolute/path/to/bca/dist/mcp/main.js
"""
import asyncio
import json
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def call_bca(entrypoint: str, name: str, arguments: dict):
    # Forward only explicitly configured BCA options, not unrelated host secrets.
    env = {k: v for k, v in os.environ.items() if k.startswith("BCA_") or k in ("PATH", "HOME", "SYSTEMROOT")}
    server = StdioServerParameters(command="node", args=[entrypoint], env=env)
    async with stdio_client(server) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            result = await session.call_tool(name, arguments)
            if result.is_error:
                raise RuntimeError(result.content)
            return result.model_dump(mode="json", by_alias=True)


if __name__ == "__main__":
    print(json.dumps(asyncio.run(call_bca(sys.argv[1], "content_cid", {"path": "README.md"}))))
