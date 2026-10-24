import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, delimiter } from 'node:path';
import { ContractFactory, JsonRpcProvider } from 'ethers';
import { createToolkit } from '../src/toolkit.js';
import { resolveExecutable } from '../src/development/exec.js';

// Focused real-tool checks for previously untested paths. Optional dependencies
// are prepared explicitly by the operator; no account services are simulated.
const root = process.cwd();
const work = resolve('.work/handoff');
await mkdir(work, { recursive: true });
const mode = process.argv[2];
assert.ok(['proxies', 'hardhat', 'slither', 'schema'].includes(mode!), 'Choose proxies|hardhat|slither|schema');
process.env.BCA_WORKING_ROOT = root;
process.env.BCA_TIMEOUT_MS = '60000';
const report: Record<string, any> = { mode, at: new Date().toISOString(), node: process.version, platform: process.platform };

if (mode === 'proxies') {
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done));
  const port = (socket.address() as any).port;
  await new Promise<void>((done) => socket.close(() => done()));
  const node = spawn(resolveExecutable('anvil'), ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--steps-tracing'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; node.stdout.on('data', (chunk) => { output += chunk; }); node.stderr.on('data', (chunk) => { output += chunk; });
  process.env.BCA_RPC_URL = `http://127.0.0.1:${port}`; process.env.BCA_CHAIN_ID = '31337';
  const provider = new JsonRpcProvider(process.env.BCA_RPC_URL, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const kit = createToolkit(); const call = (name: string, input: unknown) => kit.invoke(name, input) as Promise<any>;
  try {
    const deadline = Date.now() + 10000;
    while (!output.includes('Listening on') && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    assert.match(output, /Listening on/);
    await writeFile(resolve(work, 'ProxyCases.sol'), `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
contract Implementation {
  error NeedBalance(uint256 amount);
  function init() external {}
  function fail() external pure { revert NeedBalance(7); }
}
contract CloneFactory {
  event Created(address clone);
  function create(address implementation) external { emit Created(Clones.clone(implementation)); }
}
contract NestedCaller {
  function go(address target) external { Implementation(target).fail(); }
}
`);
    const compiled = await call('dev_solidity_compile', { path: '.work/handoff/ProxyCases.sol' });
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    await writeFile(resolve(work, 'proxy-compiled.json'), JSON.stringify(compiled));
    const signer = await provider.getSigner(0);
    const deploy = async (name: string, args: any[] = []) => {
      const artifact = compiled.contracts.find((c: any) => c.name === name);
      const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
      await contract.waitForDeployment(); return contract as any;
    };
    const implementation = await deploy('Implementation'); const implementationAddress = await implementation.getAddress();
    const init = implementation.interface.encodeFunctionData('init');
    const proxy = await deploy('ERC1967Proxy', [implementationAddress, init]);
    const factory = await deploy('CloneFactory');
    const created = await (await factory.create(implementationAddress)).wait();
    const cloneAddress = factory.interface.parseLog(created.logs[0]).args.clone;
    const beacon = await deploy('UpgradeableBeacon', [implementationAddress, await signer.getAddress()]);
    const beaconProxy = await deploy('BeaconProxy', [await beacon.getAddress(), init]);
    const nested = await deploy('NestedCaller');
    const block = String(await provider.getBlockNumber());
    const cases = [
      { address: await proxy.getAddress(), pattern: 'ERC-1967', implementation: implementationAddress },
      { address: cloneAddress, pattern: 'ERC-1167', implementation: implementationAddress },
      { address: await beaconProxy.getAddress(), pattern: 'ERC-1967-beacon-unsupported', implementation: null },
      { address: implementationAddress, pattern: 'unrecognized', implementation: null },
    ];
    report.proxies = [];
    for (const item of cases) {
      const result = await call('evm_proxy', { address: item.address, block });
      assert.equal(result.pattern, item.pattern); assert.equal(result.implementation, item.implementation);
      if (item.pattern.includes('beacon')) assert.equal(result.beacon, await beacon.getAddress());
      report.proxies.push(result);
    }
    report.diagnoses = [];
    for (const [label, to, data, contractName] of [
      ['direct', implementationAddress, implementation.interface.encodeFunctionData('fail'), 'Implementation'],
      ['erc1967', await proxy.getAddress(), implementation.interface.encodeFunctionData('fail'), 'Implementation'],
      ['erc1167', cloneAddress, implementation.interface.encodeFunctionData('fail'), 'Implementation'],
      ['nested', await nested.getAddress(), nested.interface.encodeFunctionData('go', [implementationAddress]), 'NestedCaller'],
    ]) {
      const tx = await signer.sendTransaction({ to, data, gasLimit: 500000 }); await tx.wait().catch(() => {});
      const result = await call('workstation_diagnose', { hash: tx.hash, artifact: '.work/handoff/proxy-compiled.json', contractName });
      assert.equal(result.status, 'failed'); assert.equal(result.source.bytecodeMatched, true);
      const depths = [...new Set(result.trace.trace.structLogs.map((s: any) => s.depth))];
      if (label === 'direct') { assert.equal(result.complete, true); assert.ok(result.diagnosis.sourceLocation); }
      else { assert.ok(depths.length > 1); assert.equal(result.complete, false); assert.equal(result.diagnosis.sourceLocation, null); assert.ok(result.gaps.length > 0); }
      report.diagnoses.push({ label, hash: tx.hash, block: result.receipt.blockNumber, depths, complete: result.complete, diagnosis: result.diagnosis, gaps: result.gaps });
    }
  } finally { await kit.close(); provider.destroy(); node.kill(); await once(node, 'close'); }
}

if (mode === 'hardhat') {
  const dir = '.work/handoff/hardhat'; await mkdir(resolve(dir, 'contracts'), { recursive: true }); await mkdir(resolve(dir, 'test'), { recursive: true });
  const compilerPath = process.env.BCA_SOLC_PATH;
  await writeFile(resolve(dir, 'hardhat.config.ts'), `export default { solidity: ${JSON.stringify({ version: '0.8.35', ...(compilerPath ? { path: compilerPath } : {}) })} };\n`);
  await writeFile(resolve(dir, 'contracts/Counter.sol'), 'pragma solidity ^0.8.20; contract Counter { uint256 public n; function increment() external { n++; } }');
  const test = resolve(dir, 'test/Counter.t.sol');
  const passing = 'pragma solidity ^0.8.20; import "../contracts/Counter.sol"; contract CounterTest { function testIncrement() public { Counter c = new Counter(); c.increment(); require(c.n() == 1, "increment"); } }';
  await writeFile(test, passing);
  const kit = createToolkit();
  try {
    const project = await kit.invoke('dev_project', { dir }) as any; assert.equal(project.selected, 'hardhat');
    const compile = await kit.invoke('dev_hardhat_compile', { dir }) as any; assert.equal(compile.taskStatus, 'succeeded', JSON.stringify(compile));
    const passed = await kit.invoke('dev_hardhat_test', { dir, path: 'test/Counter.t.sol' }) as any;
    assert.equal(passed.taskStatus, 'succeeded', JSON.stringify(passed)); assert.match(passed.stdout, /1 passing/);
    await writeFile(test, passing.replace('c.n() == 1', 'c.n() == 2'));
    const failed = await kit.invoke('dev_hardhat_test', { dir, path: 'test/Counter.t.sol' }) as any;
    assert.equal(failed.taskStatus, 'business_failed'); assert.notEqual(failed.exitCode, 0); assert.match(failed.stdout + failed.stderr, /increment/);
    report.hardhat = { version: JSON.parse(await readFile(resolve(dir, 'node_modules/hardhat/package.json'), 'utf8')).version, project: project.selected, compile, passed, failed };
  } finally { await writeFile(test, passing); await kit.close(); }
}

if (mode === 'slither') {
  if (process.env.BCA_SLITHER_BIN_DIR) process.env.PATH = process.env.BCA_SLITHER_BIN_DIR + delimiter + process.env.PATH;
  await writeFile(resolve(work, 'Finding.sol'), 'pragma solidity ^0.8.20; contract Finding { address public owner; constructor() { owner=msg.sender; } function risky() external view returns (bool) { return tx.origin == owner; } }');
  await writeFile(resolve(work, 'Broken.sol'), 'pragma solidity ^0.8.20; contract Broken { invalid syntax }');
  const kit = createToolkit();
  try {
    const finding = await kit.invoke('dev_slither_analyze', { target: '.work/handoff/Finding.sol' }) as any;
    assert.equal(finding.result.success, true); assert.ok(finding.result.results.detectors.length > 0); assert.notEqual(finding.exitCode, 0); assert.equal(finding.taskStatus, 'succeeded');
    let broken: any;
    try {
      broken = await kit.invoke('dev_slither_analyze', { target: '.work/handoff/Broken.sol' });
      assert.equal(broken.result.success, false); assert.equal(broken.taskStatus, 'execution_failed');
    } catch (error) {
      // Slither may exit before its JSON writer on a compiler failure.
      assert.match((error as Error).message, /slither 失败/);
      broken = { executionRejected: true, error: (error as Error).message };
    }
    report.slither = { finding, broken };
  } finally { await kit.close(); }
}

if (mode === 'schema') {
  const upstream = resolve(work, 'dynamic-server.mjs');
  await writeFile(upstream, `import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
const s = new McpServer({name:'bca-schema-lifecycle-fixture',version:'1'});
const ok = async () => ({content:[{type:'text',text:'ok'}]});
s.registerTool('grow',{inputSchema:z.object({})},async()=>{
 s.registerTool('added_read',{inputSchema:z.object({}),annotations:{readOnlyHint:true}},ok);
 s.registerTool('added_write',{inputSchema:z.object({}),annotations:{readOnlyHint:true}},ok);
 return ok();
});
serveStdio(()=>s);
`);
  delete process.env.BCA_MCP_CONFIG; delete process.env.BCA_ALLOW_WRITES;
  process.env.BCA_MCP_SERVERS = JSON.stringify({ mcpServers: { lifecycle: { command: process.execPath, args: [upstream], cwd: root, readOnlyTools: ['grow', 'added_read'] } } });
  const kit = createToolkit(); const call = (name: string, input: unknown) => kit.invoke(name, input) as Promise<any>;
  try {
    const { session } = await call('bridge_open', { server: 'lifecycle' });
    const before = await call('bridge_refresh', { server: 'lifecycle', session }); assert.equal(before.tools.length, 1);
    await call('bridge_call', { server: 'lifecycle', session, tool: 'grow' });
    await new Promise((done) => setTimeout(done, 100));
    // No explicit refresh and no TTL expiry: list_changed must invalidate cache.
    await call('bridge_call', { server: 'lifecycle', session, tool: 'added_read' });
    const after = await call('bridge_refresh', { server: 'lifecycle', session });
    assert.notEqual(before.schemaDigest, after.schemaDigest); assert.equal(after.tools.length, 3);
    assert.equal(after.businessVerified, false); assert.equal(after.authorizationChanged, false); assert.equal(after.status, 'discovered_unverified');
    await assert.rejects(() => call('bridge_call', { server: 'lifecycle', session, tool: 'added_write' }), /BCA_ALLOW_WRITES|写入/);
    report.schema = { before, after, notificationInvalidation: 'passed', unapprovedReadOnlyHintRejected: true, scope: 'controlled real MCP SDK transport lifecycle, not external provider business verification' };
  } finally { await kit.close(); }
}
report.passed = true;
await writeFile(resolve(work, `result-${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
