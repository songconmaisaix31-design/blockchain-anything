import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parse } from 'smol-toml';
import { run, runNpm } from '../src/development/exec.js';

const root = process.cwd(); await mkdir('.work/package', { recursive: true });
const packed = await runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', resolve('.work/package')], root);
assert.equal(packed.exitCode, 0, packed.stderr);
const artifact = JSON.parse(packed.stdout)[0];
// npm exec caches a local package by its path; a reused filename can run old bytes.
const tarball = resolve('.work/package', `blockchain-anything-${artifact.shasum}.tgz`);
await copyFile(resolve('.work/package', artifact.filename), tarball);
const project = await mkdtemp(join(tmpdir(), 'bca-setup-'));
const cleanEnv: Record<string, string | undefined> = {};
for (const key of Object.keys(process.env)) if (key.startsWith('BCA_')) { cleanEnv[key] = undefined; delete process.env[key]; }
const mcp = new Client({ name: 'packed-setup-check', version: '1' });
try {
  await mkdir(join(project, '.codex'));
  for (const file of ['AGENTS.md', 'CLAUDE.md']) await writeFile(join(project, file), '# Existing project rules\nPreserve this instruction.\n');
  await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'existing' }, bca: { env: { BCA_RPC_URL: 'http://127.0.0.1:1', BCA_CHAIN_ID: '31337' } } } }));
  await writeFile(join(project, '.codex/config.toml'), '# user comment kept in backup\nmodel="user-choice"\n[mcp_servers.other]\ncommand="existing"\n');
  let setup;
  if (process.platform === 'win32') {
    // npm/cli#9959: noninteractive npm exec can hang before launching the CLI.
    // Install the real artifact, then invoke its Node entry directly.
    const bootstrap = join(project, '.bootstrap');
    await mkdir(bootstrap);
    await writeFile(join(bootstrap, 'package.json'), '{"private":true}');
    console.log('Installing actual Windows tarball…');
    await runNpm(['install', '--prefix', bootstrap, '--omit=dev', '--no-audit', '--no-fund', tarball], project, { forwardOutput: true });
    setup = await run(process.execPath, [join(bootstrap, 'node_modules/blockchain-anything/dist/cli/main.js'), 'setup', '--client', 'both', '--install'],
      { cwd: project, timeoutMs: 600_000, maxBytes: 4 * 1024 * 1024, forwardOutput: true });
  } else {
    console.log('Installing from actual tarball through npm exec…');
    setup = await runNpm(['exec', '--yes', '--package', tarball, '--', 'bca', 'setup', '--client', 'both', '--install'], project, { timeoutMs: 600_000, forwardOutput: true });
  }
  assert.equal(setup.exitCode, 0, setup.stdout + setup.stderr);
  const first = JSON.parse(setup.stdout); assert.equal(first.taskStatus, 'succeeded');
  const claude = JSON.parse(await readFile(join(project, '.mcp.json'), 'utf8'));
  const codex = parse(await readFile(join(project, '.codex/config.toml'), 'utf8')) as any;
  assert.equal(claude.mcpServers.other.command, 'existing'); assert.equal(codex.model, 'user-choice'); assert.equal(codex.mcp_servers.other.command, 'existing');
  assert.equal(claude.mcpServers.bca.env.BCA_RPC_URL, 'http://127.0.0.1:1');
  assert.ok((await readdir(project)).some((name) => name.startsWith('.mcp.json.bca-backup-')));
  const config = claude.mcpServers.bca;
  assert.ok(config.args[0].startsWith(join(project, '.bca/runtime')), config.args[0]);
  // Verify the installed artifact, where dependency overrides alone are ignored.
  const installedRequire = createRequire(config.args[0]);
  const cheqdRequire = createRequire(installedRequire.resolve('@cheqd/ts-proto-cjs/package.json'));
  assert.equal(cheqdRequire('protobufjs/package.json').version, '7.6.3');
  const icsRequire = createRequire(installedRequire.resolve('@confio/ics23'));
  assert.equal(icsRequire('protobufjs/package.json').version, '7.6.3');
  const { ics23 } = installedRequire('@confio/ics23');
  const proof = ics23.ExistenceProof.create({ key: Buffer.from('key'), value: Buffer.from('value') });
  const decodedProof = ics23.ExistenceProof.decode(ics23.ExistenceProof.encode(proof).finish());
  assert.equal(Buffer.from(decodedProof.value).toString(), 'value');
  const { QueryDidDocRequest } = cheqdRequire('./cheqd/did/v2/query.js');
  const request = QueryDidDocRequest.fromPartial({ id: 'did:cheqd:testnet:12345678-1234-1234-1234-123456789012' });
  assert.equal(QueryDidDocRequest.decode(QueryDidDocRequest.encode(request).finish()).id, request.id);
  const cli = resolve(config.args[0], '../../cli/main.js');
  console.log('Checking repeat setup and installed MCP…');
  const second = await run(process.execPath, [cli, 'setup', '--client', 'both', '--install'], { cwd: project, env: { ...cleanEnv, ...config.env }, timeoutMs: 120000, maxBytes: 4 * 1024 * 1024 });
  assert.equal(second.exitCode, 0, second.stdout + second.stderr);
  assert.ok(JSON.parse(second.stdout).changes.every((change: any) => change.changed === false), second.stdout);
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const text = await readFile(join(project, file), 'utf8');
    assert.match(text, /Preserve this instruction/); assert.match(text, /BCA-WORKFLOW.md/);
    assert.equal(text.split('<!-- bca:start -->').length, 2);
  }
  await mcp.connect(new StdioClientTransport({ command: config.command, args: config.args, cwd: project, env: config.env }));
  const list = await mcp.listTools(); assert.ok(list.tools.some((tool) => tool.name === 'workstation_search'));
  const cid = await mcp.callTool({ name: 'content_cid', arguments: { path: 'BCA-WORKFLOW.md' } }); assert.ok(!cid.isError); assert.match(JSON.stringify(cid), /bafkrei/);
  const doctor = await run(process.execPath, [cli, 'doctor'], { cwd: project, env: { ...cleanEnv, ...config.env }, timeoutMs: 30000, maxBytes: 4 * 1024 * 1024 });
  assert.equal(doctor.exitCode, 0, doctor.stderr); const diagnosed = JSON.parse(doctor.stdout);
  for (const name of ['Node', 'forge', 'cast', 'anvil', 'codex MCP config', 'claude MCP config']) assert.equal(diagnosed.checks.find((item: any) => item.name === name).status, 'passed', doctor.stdout);
  assert.ok(diagnosed.checks.some((item: any) => item.name === 'capabilities'), 'failed client check must not stop doctor');
  // A normal terminal invocation has no MCP-injected BCA_COMPONENTS_DIR.
  for (const args of [['init', 'counter'], ['build', 'counter'], ['test', 'counter']]) {
    const executed = await run(process.execPath, [cli, ...args], { cwd: project, env: cleanEnv, timeoutMs: 120000 });
    assert.equal(executed.exitCode, 0, executed.stdout + executed.stderr);
    assert.equal(JSON.parse(executed.stdout).taskStatus, 'succeeded');
  }
  const report = { artifact: artifact.filename, shasum: artifact.shasum, integrity: artifact.integrity, entry: process.platform === 'win32' ? 'npm install <actual.tgz>; node <installed CLI> setup --client both --install' : 'npm exec --yes --package <actual.tgz> -- bca setup --client both --install',
    persistentRuntime: true, components: 'official Foundry 1.7.1', preservedOtherClientConfig: true, preservedBcaEnv: true, backups: true, idempotent: true,
    preservedClientInstructions: true, installedCliInitBuildTest: 'passed',
    installedMcpCid: 'passed', installedWorkstationDiscovery: 'passed', doctor: diagnosed.checks.filter((item: any) => item.name !== 'capabilities'),
    clientUiAuthorization: 'not tested: configuration and real MCP launch only', platform: process.platform, at: new Date().toISOString() };
  await writeFile(resolve('.work/package/result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: true, artifact: report.artifact, checks: report.doctor }, null, 2));
} finally { await mcp.close(); await rm(project, { recursive: true, force: true }); }
