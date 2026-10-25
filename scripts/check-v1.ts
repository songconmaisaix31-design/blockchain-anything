import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createToolkit } from '../src/toolkit.js';
import { run } from '../src/development/exec.js';

const repo = process.cwd(); await mkdir('.work', { recursive: true });
const root = await mkdtemp(join(repo, '.work/v1-'));
for (const key of Object.keys(process.env)) if (key.startsWith('BCA_')) delete process.env[key];
process.env.BCA_WORKING_ROOT = root; process.env.BCA_TIMEOUT_MS = '60000';
const toolkit = createToolkit();
const call = (name: string, input: unknown) => toolkit.invoke(name, input) as Promise<any>;
const cli = async (...args: string[]) => {
  const result = await run(process.execPath, [resolve(repo, 'dist/cli/main.js'), ...args], { cwd: root, timeoutMs: 120000 });
  assert.equal(result.exitCode, 0, result.stdout + result.stderr); return JSON.parse(result.stdout);
};
try {
  await cli('init', 'counter');
  assert.equal((await cli('build', 'counter', '--offline')).taskStatus, 'succeeded');
  assert.equal((await cli('test', 'counter', '--offline')).taskStatus, 'succeeded');
  const initial = await readFile(join(root, 'counter/src/Counter.sol'), 'utf8');
  await assert.rejects(() => call('project_init', { dir: 'counter', submit: true }), /exist/i);
  assert.equal(await readFile(join(root, 'counter/src/Counter.sol'), 'utf8'), initial);
  await writeFile(join(root, 'counter/src/Counter.sol'), 'invalid solidity');
  const failed = await run(process.execPath, [resolve(repo, 'dist/cli/main.js'), 'build', 'counter', '--offline'], { cwd: root, timeoutMs: 60000 });
  assert.equal(failed.exitCode, 2); assert.equal(JSON.parse(failed.stdout).taskStatus, 'business_failed');
  await writeFile(join(root, 'counter/src/Counter.sol'), initial);

  await call('project_init', { dir: 'token', template: 'erc20', name: 'V1 Token', symbol: 'V1', supply: '1000', submit: true });
  for (const action of ['compile', 'test']) assert.equal((await call('project_run', { dir: 'token', action, offline: true })).taskStatus, 'succeeded');
  for (const [query, expected] of [['计算文件 CID', 'content_cid'], ['Solana 余额', 'solana_balance'], ['列出交易所', 'ccxt_exchanges']]) {
    const found = await call('capability_search', { query });
    assert.equal(found.matches[0].name, expected, JSON.stringify(found));
  }
  assert.match((await call('content_cid', { path: 'token/src/MyToken.sol' })).cid, /^bafkrei/);
  assert.ok((await call('ccxt_exchanges', {})).exchanges.includes('kraken'));
  assert.equal((await cli('find', 'Solana 余额')).tools.matches[0].name, 'solana_balance');

  const configured = await cli('connect', 'openzeppelin'); assert.equal(configured.taskStatus, 'succeeded');
  assert.equal((await cli('connect', 'openzeppelin')).change.changed, false);
  assert.equal((await call('bridge_servers', {})).servers[0].name, 'openzeppelin');
  const upstream = await call('capability_search', { query: 'generate ERC20', server: 'openzeppelin', details: true });
  const erc20 = upstream.matches.find((item: any) => item.name === 'solidity-erc20');
  assert.ok(erc20?.inputSchema); assert.equal(erc20.readOnly, true);
  const generated = await call('bridge_call', { server: 'openzeppelin', tool: erc20.name, arguments: { name: 'V1Token', symbol: 'V1' } });
  assert.match(JSON.stringify(generated), /contract V1Token/);
  const persisted = await cli('find', 'ERC20', '--server', 'openzeppelin');
  assert.ok(persisted.tools.matches.some((item: any) => item.name === 'solidity-erc20'));

  const report = { version: '1.0.0', node: process.version, platform: process.platform,
    counterCliInitBuildTest: 'passed', existingProjectPreserved: 'passed', failedBuildExit2: 'passed',
    openzeppelinErc20InitCompileTest: 'passed', bilingualCatalogSearch: 'passed', localCid: 'passed', ccxtRegistry: 'passed',
    persistentMcpConfiguration: 'passed', actualUpstreamSearchAndGeneration: 'passed', at: new Date().toISOString() };
  await writeFile(resolve(repo, '.work/v1-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await toolkit.close(); await rm(root, { recursive: true, force: true }); }
