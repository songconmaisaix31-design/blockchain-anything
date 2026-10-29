import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { createToolkit } from '../src/toolkit.js';
import { ProcessTreeStdioClientTransport } from '../src/bridge/session.js';

async function checkWindowsProcessTrees() {
  assert.equal(process.platform, 'win32', '--windows-tree 需要 Windows');
  type Process = { ProcessId: number; ParentProcessId: number; Created: string };
  const processes = async (): Promise<Process[]> => {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{Name='Created';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress"],
    { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  };
  const descendants = (all: Process[], root: number) => {
    const selected = new Set([root]);
    for (let size = 0; size !== selected.size;) {
      size = selected.size;
      for (const item of all) if (selected.has(item.ParentProcessId)) selected.add(item.ProcessId);
    }
    return all.filter((item) => selected.has(item.ProcessId));
  };
  const assertGone = async (owned: Process[]) => {
    const remaining = (await processes()).filter((item) => owned.some((prior) => prior.ProcessId === item.ProcessId && prior.Created === item.Created));
    assert.deepEqual(remaining, [], '本次 transport 启动的进程树必须全部退出');
  };
  const official = new ProcessTreeStdioClientTransport({ command: 'npx', args: ['--no-install', '@openzeppelin/contracts-mcp'], stderr: 'pipe' });
  official.stderr?.on('data', () => {});
  const client = new Client({ name: 'bca-session-check', version: '1.0.0' });
  try {
    await client.connect(official, { timeout: 30_000 });
    assert.ok(official.pid);
    const rootPid = official.pid;
    const owned = descendants(await processes(), rootPid);
    assert.ok(owned.length >= 2, '通过真实 npx 启动的官方 OpenZeppelin 必须包含后代进程');
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'solidity-erc20'));
    const generated = await client.callTool({ name: 'solidity-erc20', arguments: { name: 'TreeToken', symbol: 'TREE' } });
    assert.match(JSON.stringify(generated), /contract TreeToken/);
    await client.close();
    await official.close();
    await assertGone(owned);
    console.log(JSON.stringify({ check: '官方 OpenZeppelin 正常关闭', transportPid: rootPid, observedPids: owned.map((item) => item.ProcessId), remaining: 0 }));
  } finally { await official.close(); }

  await mkdir(resolve('.work'), { recursive: true });
  const isolated = await mkdtemp(resolve('.work/oauth-session-'));
  const cache = resolve(isolated, 'oauth-cache'); await mkdir(cache);
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((done, reject) => listener.close((error) => error ? reject(error) : done()));
  const remote = new ProcessTreeStdioClientTransport({ command: 'npx',
    args: ['-y', 'mcp-remote@0.15.2', 'https://api.dune.com/mcp/v1', String(port), '--auth-timeout', '120'],
    env: { MCP_REMOTE_CONFIG_DIR: cache }, stderr: 'pipe' });
  remote.stderr?.on('data', () => {});
  const remoteClient = new Client({ name: 'bca-oauth-timeout-check', version: '1.0.0' });
  let settled = false;
  // 为官方 metadata 发现与客户端注册的网络请求留出时间，仍须观察真实 OAuth 等待和初始化超时。
  const connected = remoteClient.connect(remote, { timeout: 60_000 }).then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
  try {
    // 只检查官方 OAuth 写出的文件名，不读取验证信息或令牌内容。
    let authorizationPending = false;
    const deadline = Date.now() + 50_000;
    while (!settled && Date.now() < deadline) {
      authorizationPending = (await readdir(cache, { recursive: true })).some((name) => name.includes('code_verifier'));
      if (authorizationPending) break;
      await delay(100);
    }
    assert.ok(authorizationPending, '真实官方服务必须进入独立缓存下的 OAuth 等待');
    assert.ok(remote.pid);
    const rootPid = remote.pid;
    const owned = descendants(await processes(), rootPid);
    assert.ok(owned.length >= 3, '真实 mcp-remote 必须存在 npx 与后代进程');
    const error = await connected;
    assert.ok(error instanceof Error);
    assert.match(error.message, /timed out|timeout/i);
    await remote.close();
    await assertGone(owned);
    console.log(JSON.stringify({ check: '官方 Dune OAuth 初始化超时', transportPid: rootPid, observedPids: owned.map((item) => item.ProcessId), remaining: 0, isolatedCache: cache }));
  } finally { await remote.close(); await connected; }
}

if (process.argv.includes('--windows-tree')) {
  await checkWindowsProcessTrees();
} else {

const root = process.cwd(); const work = resolve('.work/sessions');
await mkdir(work, { recursive: true });
const starts = resolve(work, 'starts.jsonl'); await writeFile(starts, '');
const upstream = resolve('node_modules/@openzeppelin/contracts-mcp/dist/cli.js');
const wrapper = resolve(work, 'official.mjs');
await writeFile(wrapper, `import {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(starts)},JSON.stringify({pid:process.pid,at:Date.now()})+'\\n');\nawait import(${JSON.stringify(pathToFileURL(upstream).href)});\n`);
const config: any = { mcpServers: { openzeppelin: { preset: 'openzeppelin', command: process.execPath, args: [wrapper], env: { SESSION_TEST_IDENTITY: 'one' } }, broken: { url: 'https://example.invalid', headers: { Authorization: '${BCA_UNSET_TEST_KEY}' } } } };
delete process.env.BCA_MCP_CONFIG;
process.env.BCA_MCP_SERVERS = JSON.stringify(config);
const toolkit = createToolkit();
const call = (name: string, input: unknown) => toolkit.invoke(name, input) as Promise<any>;
const startsRead = async () => (await readFile(starts, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const arguments_ = { name: 'SessionToken', symbol: 'SES' };
try {
  const listed = await call('bridge_servers', {}); assert.ok(listed.configurationErrors.broken); assert.equal(listed.configured, 1);
  const ephemeralStart = Date.now();
  for (let i = 0; i < 2; i++) {
    const result = await call('bridge_call', { server: 'openzeppelin', tool: 'solidity-erc20', arguments: arguments_ });
    assert.match(JSON.stringify(result), /contract SessionToken/);
  }
  const ephemeralMs = Date.now() - ephemeralStart;
  assert.equal((await startsRead()).length, 2);
  const sessionStart = Date.now(); const opened = await call('bridge_open', { server: 'openzeppelin' });
  const session = opened.session;
  const refreshed = await call('bridge_refresh', { server: 'openzeppelin', session });
  assert.equal(refreshed.businessVerified, false); assert.ok(refreshed.tools.find((tool: any) => tool.name === 'solidity-erc20')?.inputSchema);
  for (let i = 0; i < 2; i++) await call('bridge_call', { server: 'openzeppelin', session, tool: 'solidity-erc20', arguments: arguments_ });
  assert.equal((await startsRead()).length, 3);
  const sessionMs = Date.now() - sessionStart;
  const again = await call('bridge_refresh', { server: 'openzeppelin', session }); assert.equal(again.changed, false); assert.equal(again.schemaDigest, refreshed.schemaDigest);
  config.mcpServers.openzeppelin.env.SESSION_TEST_IDENTITY = 'two'; process.env.BCA_MCP_SERVERS = JSON.stringify(config);
  await assert.rejects(() => call('bridge_call', { server: 'openzeppelin', session, tool: 'solidity-erc20', arguments: arguments_ }), /凭据已变更/);
  assert.equal((await startsRead()).length, 3, 'credential change must not replay');
  const next = await call('bridge_open', { server: 'openzeppelin' });
  const pid = (await startsRead()).at(-1).pid; process.kill(pid, 'SIGTERM'); await new Promise((done) => setTimeout(done, 120));
  await assert.rejects(() => call('bridge_call', { server: 'openzeppelin', session: next.session, tool: 'solidity-erc20', arguments: arguments_ }), /断开|closed|会话/i);
  assert.equal((await startsRead()).length, 4, 'disconnect must not replay');
  const recovered = await call('bridge_open', { server: 'openzeppelin' });
  await call('bridge_call', { server: 'openzeppelin', session: recovered.session, tool: 'solidity-erc20', arguments: arguments_ });
  await call('bridge_close', { session: recovered.session });
  const report = { upstream: '@openzeppelin/contracts-mcp@0.8.0', tool: 'solidity-erc20', ephemeral: { calls: 2, starts: 2, elapsedMs: ephemeralMs },
    session: { calls: 2, starts: 1, includesExplicitDiscovery: true, elapsedMs: sessionMs }, schemaDigest: refreshed.schemaDigest, upstreamTools: refreshed.tools.length,
    malformedSupplierIsolation: 'passed', credentialChangeInvalidates: 'passed, no replay', disconnect: 'passed, no replay', explicitReconnect: 'passed', at: new Date().toISOString() };
  await writeFile(resolve(work, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await toolkit.close(); }
}
