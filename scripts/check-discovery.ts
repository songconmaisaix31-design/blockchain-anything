import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createToolkit } from '../src/toolkit.js';
import { inspectProviders, loadMcpConfiguration, MCP_PRESETS } from '../src/bridge/config.js';

const repo = process.cwd();
const work = resolve(repo, '.work');
await mkdir(work, { recursive: true });
const root = await mkdtemp(join(work, 'discovery-'));
for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('BCA_')) delete process.env[key];
process.env.BCA_WORKING_ROOT = root;
process.env.BCA_TIMEOUT_MS = '60000';
const toolkit = createToolkit();
const call = (name: string, input: unknown) => toolkit.invoke(name, input) as Promise<any>;
const path = join(root, '.bca/mcp.json');
const readConfiguration = async () => JSON.parse(await readFile(path, 'utf8'));
const saveConfiguration = async (mcpServers: Record<string, unknown>) => writeFile(path, JSON.stringify({ mcpServers }, null, 2) + '\n');

try {
  const missing = await call('capability_search', { query: '用 Dune 查询 Base 最近七天的交易量' });
  assert.deepEqual(missing.providers.map((item: any) => item.id), ['dune']);
  assert.equal(missing.matches.length, 0);
  assert.deepEqual(missing.providers[0].missingEnvironment, ['BCA_DUNE_API_KEY']);
  assert.deepEqual(missing.chains.chains, ['base']);
  assert.equal(missing.providers[0].nextCall.tool, 'bridge_configure');
  await assert.rejects(() => readFile(path), { code: 'ENOENT' });
  for (const query of ['帮我查询数据', 'query data', '写一首春天的诗']) {
    const result = await call('capability_search', { query });
    assert.equal(result.matches.length, 0, query);
    assert.equal(result.providers.length, 0, query);
  }
  const solana = await call('capability_search', { query: 'Solana NFT' });
  assert.ok(!solana.matches.some((item: any) => item.name === 'solana_balance'));
  const duneSolana = await call('capability_search', { query: 'Dune Solana 数据分析' });
  assert.equal(duneSolana.providers[0].chainSupport, 'listed');
  const compile = await call('capability_search', { query: '只编译合约' });
  assert.ok(compile.matches.some((item: any) => /compile|build/.test(item.name)));
  assert.ok(!compile.matches.some((item: any) => /deploy|sign/.test(item.name)));
  const security = await call('capability_search', { query: '检查合约源码安全' });
  assert.ok(security.matches.some((item: any) => item.name === 'dev_slither_analyze'));
  assert.ok(!security.matches.some((item: any) => item.name === 'dev_forge_verify'));
  assert.ok(!security.providers.some((item: any) => ['openzeppelin', 'thirdweb'].includes(item.id)));

  const connected = await call('bridge_configure', { preset: 'dune', name: 'analytics', submit: true });
  assert.deepEqual(connected.missingEnvironment, ['BCA_DUNE_API_KEY']);
  assert.equal((await readConfiguration()).mcpServers.analytics.headers['x-dune-api-key'], '${BCA_DUNE_API_KEY}');
  assert.equal((await call('bridge_configure', { preset: 'dune', name: 'analytics', submit: true })).change.changed, false);
  const alias = await call('capability_search', { query: 'analytics 查询数据' });
  assert.equal(alias.providers[0].servers[0].name, 'analytics');
  assert.match(alias.providers[0].errors[0], /BCA_DUNE_API_KEY/);
  await call('bridge_configure', { preset: 'dune', name: 'research', submit: true });
  const selectedAlias = await inspectProviders('analytics 查询数据', root);
  assert.equal(selectedAlias.ambiguity, null);
  assert.deepEqual(selectedAlias.matches[0]!.servers.map((server) => server.name), ['analytics']);
  assert.match((await inspectProviders('Dune', root)).ambiguity!, /多个配置/);

  await call('bridge_configure', { preset: 'goplus', submit: true });
  await call('bridge_configure', { preset: 'slither', submit: true });
  await call('bridge_configure', { preset: 'allium', submit: true });
  const defaults = await readConfiguration();
  assert.deepEqual(defaults.mcpServers.goplus.args, MCP_PRESETS.find((preset) => preset.id === 'goplus')!.args);
  assert.deepEqual((await inspectProviders('goplus', root)).matches[0]!.missingEnvironment, ['BCA_GOPLUS_API_KEY', 'BCA_GOPLUS_API_SECRET']);
  assert.equal(defaults.mcpServers.slither.command, 'uvx');
  assert.ok(defaults.mcpServers.allium.args.includes('mcp-remote@0.15.2'));

  defaults.mcpServers.analytics.headers = { 'x-dune-api-key': '${BCA_CUSTOM_DUNE_KEY}' };
  defaults.mcpServers.analytics.readOnlyTools = ['listBlockchains'];
  await saveConfiguration(defaults.mcpServers);
  const preserved = await call('bridge_configure', { preset: 'dune', name: 'analytics', submit: true });
  assert.deepEqual(preserved.missingEnvironment, ['BCA_CUSTOM_DUNE_KEY']);
  assert.deepEqual((await readConfiguration()).mcpServers.analytics, defaults.mcpServers.analytics);

  // 使用无认证的真实官方地址检验配置覆盖；业务连接单独执行。
  await saveConfiguration({ analytics: { url: 'https://api.dune.com/mcp/v1', headers: {} },
    custom: { preset: 'dune', command: 'npx', args: ['-y', 'mcp-remote@0.15.2', 'https://api.dune.com/mcp/v1'] },
    other: { preset: 'thirdweb', url: 'https://api.thirdweb.com/mcp', headers: {} },
    authorized: { preset: 'allium', headers: {} } });
  const configuration = await loadMcpConfiguration(root);
  assert.deepEqual(configuration.errors, {});
  assert.ok(configuration.configured.every((server) => server.missingEnvironment.length === 0));
  assert.equal(configuration.configured.find((server) => server.name === 'analytics')!.preset, 'dune');
  assert.deepEqual((await inspectProviders('authorized', root)).matches[0]!.requirements, []);

  await saveConfiguration({});
  await call('bridge_configure', { preset: 'openzeppelin', name: 'contracts', submit: true });
  const upstream = await call('capability_search', { query: 'contracts ERC721', details: true });
  assert.equal(upstream.source.server, 'contracts');
  const erc721 = upstream.matches.find((item: any) => item.name === 'solidity-erc721');
  assert.ok(erc721?.inputSchema);
  const schemaResult = await call(erc721.schemaCall.tool, erc721.schemaCall.input);
  assert.equal(schemaResult.matches[0].name, 'solidity-erc721');
  assert.ok(schemaResult.matches[0].inputSchema);
  const generated = await call('bridge_call', { server: 'contracts', tool: 'solidity-erc721',
    arguments: { name: 'DiscoveryNFT', symbol: 'DISC', mintable: true, uriStorage: true } });
  assert.match(JSON.stringify(generated), /contract DiscoveryNFT/);
  const unsupported = await call('capability_search', { query: 'contracts 写一首诗' });
  assert.equal(unsupported.matches.length, 0);

  if (process.argv.includes('--dune')) {
    await saveConfiguration({ analytics: { preset: 'dune', headers: {} } });
    await assert.rejects(() => call('capability_search', { query: 'analytics 查询数据' }), /401|403|unauthorized|authorization|authentication|missing credentials/i);
  }
  console.log(JSON.stringify({ providerSelection: 'passed', missingCredentialsAndAliases: 'passed',
    authenticationDefaultsAndPreservation: 'passed', taskMatching: 'passed', actualOpenZeppelinCatalogAndGeneration: 'passed',
    duneWithoutAuthorization: process.argv.includes('--dune') ? 'rejected by official endpoint' : 'not run' }, null, 2));
} finally {
  await toolkit.close();
  assert.ok(root.startsWith(work + sep));
  await rm(root, { recursive: true, force: true });
}
