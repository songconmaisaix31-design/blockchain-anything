import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/mcp/main.js';
import { createToolkit } from '../src/toolkit.js';
import { loadMcpServers } from '../src/bridge/config.js';

// 用仓库自己构建出的真实官方 MCP 服务验证桥接的 stdio 与 Streamable HTTP。
// 外部供应商端点需要网络和操作者授权，不在此脚本内伪造。
const root = process.cwd();
const handler = createMcpHandler(() => createMcpServer(), { legacy: 'stateless' });
const httpServer = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const webRequest = new Request(new URL(request.url ?? '/', 'http://127.0.0.1'), {
    method: request.method,
    headers: request.headers as Record<string, string>,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  });
  try {
    const webResponse = await handler.fetch(webRequest);
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' });
    response.end(error instanceof Error ? error.message : 'handler failed');
  }
});
await new Promise<void>((ready) => httpServer.listen(0, '127.0.0.1', ready));
const address = httpServer.address();
const port = typeof address === 'object' && address ? address.port : 0;

const configPath = resolve(root, '.work/bridge-check-config.json');
await mkdir(resolve(root, '.work'), { recursive: true });
const configuration = {
  mcpServers: {
    'bca-self': {
      transport: 'stdio', readOnlyTools: ['content_cid'],
      command: process.execPath,
      args: [resolve(root, 'dist/mcp/main.js')],
      cwd: root,
      env: { BCA_WORKING_ROOT: root },
    },
    'bca-http': { readOnlyTools: ['content_cid'], url: `http://127.0.0.1:${port}/mcp` },
  },
};
await writeFile(configPath, JSON.stringify(configuration, null, 2));

for (const key of Object.keys(process.env)) if (key.toUpperCase() === 'BCA_MCP_SERVERS') delete process.env[key];
process.env.BCA_MCP_CONFIG = configPath;
const toolkit = createToolkit();
const call = async (name: string, input: unknown = {}) => toolkit.invoke(name, input) as Promise<any>;

try {
  const servers = await call('bridge_servers');
  assert.equal(servers.configured, 2);
  assert.deepEqual(servers.servers.map((server: { transport: string }) => server.transport).sort(), ['http', 'stdio']);
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

  const httpDiscovered = await call('bridge_discover', { server: 'bca-http' });
  assert.ok(httpDiscovered.connectionVerified);
  assert.equal(httpDiscovered.transport, 'http');
  assert.ok(httpDiscovered.tools.length >= 20);
  const httpCalled = await call('bridge_call', {
    server: 'bca-http',
    tool: 'content_cid',
    arguments: { path: 'README.md' },
  });
  assert.equal(httpCalled.result.structuredContent.result.cid, structured.cid);

  const updated = { mcpServers: { 'bca-copy': configuration.mcpServers['bca-self'], 'bca-http': configuration.mcpServers['bca-http'] } };
  assert.equal(JSON.stringify(updated).length, JSON.stringify(configuration).length);
  await writeFile(configPath, JSON.stringify(updated, null, 2));
  const reloaded = await call('bridge_call', { server: 'bca-copy', tool: 'content_cid', arguments: { path: 'README.md' } });
  assert.equal(reloaded.result.structuredContent.result.cid, structured.cid);
  await assert.rejects(() => call('bridge_discover', { server: 'bca-self' }), /未知 MCP 服务/);
  delete process.env.BCA_MCP_CONFIG;
  process.env.BCA_MCP_SERVERS = JSON.stringify({ mcpServers: { local: { ...configuration.mcpServers['bca-self'], env: { BCA_WORKING_ROOT: '${BCA_CHECK_ROOT}' } } } });
  process.env.BCA_CHECK_ROOT = root;
  const first = (await loadMcpServers()).local;
  assert(first?.transport === 'stdio');
  assert.equal(first.env.BCA_WORKING_ROOT, root);
  process.env.BCA_CHECK_ROOT = resolve(root, '.work');
  const second = (await loadMcpServers()).local;
  assert(second?.transport === 'stdio');
  assert.equal(second.env.BCA_WORKING_ROOT, resolve(root, '.work'));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    tools: discovered.tools.length,
    cid: structured.cid,
    transports: ['stdio', 'http'],
    httpPort: port,
    sameLengthConfigReload: true,
    environmentReload: true,
  }, null, 2)}\n`);
} finally {
  await toolkit.close();
  await handler.close();
  await new Promise<void>((closed) => httpServer.close(() => closed()));
}
