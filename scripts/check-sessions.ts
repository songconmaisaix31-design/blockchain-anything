import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createToolkit } from '../src/toolkit.js';

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
