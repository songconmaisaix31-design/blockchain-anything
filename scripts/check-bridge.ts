import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createToolkit } from '../src/toolkit.js';

// 用仓库自己构建出的真实官方 MCP stdio 服务验证桥接的初始化、tools/list 和 tools/call。
// 外部供应商端点需要网络和操作者授权，不在此脚本内伪造。
const root = process.cwd();
const configPath = resolve(root, '.work/bridge-check-config.json');
await mkdir(resolve(root, '.work'), { recursive: true });
await writeFile(configPath, JSON.stringify({
  mcpServers: {
    'bca-self': {
      transport: 'stdio',
      command: process.execPath,
      args: [resolve(root, 'dist/mcp/main.js')],
      cwd: root,
      env: { BCA_WORKING_ROOT: root },
    },
  },
}, null, 2));

process.env.BCA_MCP_CONFIG = configPath;
const toolkit = createToolkit();
const call = async (name: string, input: unknown = {}) => toolkit.invoke(name, input) as Promise<any>;

const servers = await call('bridge_servers');
assert.equal(servers.configured, 1);
assert.equal(servers.servers[0].transport, 'stdio');
assert.ok(servers.presets.some((preset: { id: string }) => preset.id === 'coingecko'));

const discovered = await call('bridge_discover', { server: 'bca-self' });
assert.ok(discovered.connectionVerified);
assert.ok(discovered.tools.length >= 20);
assert.ok(discovered.tools.some((tool: { name: string }) => tool.name === 'bridge_call'));
assert.ok(discovered.tools.every((tool: { name: string; inputSchema: unknown }) => tool.name && tool.inputSchema));

const called = await call('bridge_call', {
  server: 'bca-self',
  tool: 'content_cid',
  arguments: { path: 'README.md' },
});
const structured = called.result.structuredContent.result;
assert.match(structured.cid, /^bafkrei/);
assert.ok(structured.bytes > 0);

await assert.rejects(
  () => call('bridge_call', { server: 'bca-self', tool: 'no_such_tool', arguments: {} }),
  /not found|未知/i,
);

process.stdout.write(`${JSON.stringify({ ok: true, tools: discovered.tools.length, cid: structured.cid }, null, 2)}\n`);
