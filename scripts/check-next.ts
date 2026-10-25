import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContractFactory, JsonRpcProvider, id, zeroPadValue, toBeHex } from 'ethers';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createToolkit } from '../src/toolkit.js';
import { run, resolveExecutable } from '../src/development/exec.js';

const root = process.cwd(); const work = resolve(root, '.work/next');
await mkdir(work, { recursive: true });
for (const key of Object.keys(process.env)) if (key.startsWith('BCA_')) delete process.env[key];
process.env.BCA_WORKING_ROOT = root; process.env.BCA_TIMEOUT_MS = '20000';
const report: Record<string, unknown> = { environment: { node: process.version, platform: process.platform, arch: process.arch }, at: new Date().toISOString() };
const mode = process.argv[2] ?? 'all';

if (mode === 'all' || mode === 'discovery') {
  const toolkit = createToolkit();
  const call = (name: string, input: unknown) => toolkit.invoke(name, input) as Promise<any>;
  try {
    // This environment has no RPC, signer or write permission. Local work must remain usable.
    for (const [query, task, tool] of [
      ['只编译合约', 'compile', 'dev_forge_build'],
      ['compile my Solidity contract', 'compile', 'dev_forge_build'],
      ['只测试合约', 'test', 'dev_forge_test'],
    ]) {
      const { candidates: [match] } = await call('workstation_search', { query, context: { dir: 'examples/contracts' } });
      assert.equal(match.task, task); assert.equal(match.executable, true);
      assert.deepEqual(match.steps.map((step: any) => step.tool), [tool]);
      assert.deepEqual(match.missingCapabilities, []);
    }
    const deployment = await call('workstation_search', { query: '部署合约', context: { dir: 'examples/contracts' } });
    assert.equal(deployment.candidates[0].executable, false);
    assert.ok(deployment.candidates[0].missingCapabilities.some((item: any) => item.name === 'dev_forge_deploy_local'));
    const diagnosis = await call('workstation_search', { query: '交易失败', context: { chainId: '31337', hash: `0x${'ab'.repeat(32)}` } });
    assert.equal(diagnosis.candidates[0].executable, false);
    assert.ok(diagnosis.candidates[0].missingCapabilities.some((item: any) => item.name === 'workstation_diagnose'));
    const ambiguous = await call('workstation_guide', { id: 'evm-develop', context: { dir: '.' } });
    assert.ok(ambiguous.factsNeeded.includes('provider'));
    const compact = await call('capability_list', {});
    assert.ok(compact.every((item: any) => !item.inputSchema && !item.availability.verification));
    assert.ok((await call('capability_list', { name: 'content_cid' }))[0].inputSchema);
    const cli = spawnSync(process.execPath, ['dist/cli/main.js', 'find', '只编译合约', '--dir', 'examples/contracts'], { cwd: root, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).candidates[0].steps[0].tool, 'dev_forge_build');
    report.taskDiscovery = { localCompileAndTestWithoutRpc: 'passed', deploymentStillRequiresPermission: 'passed', cliFind: 'passed' };
  } finally { await toolkit.close(); }
}

if (mode === 'all' || mode === 'regressions') {
  process.env.BCA_PRIVATE_KEY = 'invalid'; process.env.BCA_IPFS_URL = 'invalid';
  const bad = createToolkit();
  assert.match((await bad.invoke('content_cid', { path: 'README.md' }) as any).cid, /^bafkrei/);
  const capabilities = await bad.invoke('capability_list', {}) as any[];
  assert.equal(capabilities.find((item) => item.name === 'ipfs_read').availability.status, 'configuration_error');
  await assert.rejects(() => bad.invoke('ipfs_status', {}), /配置错误/);
  await bad.close(); delete process.env.BCA_PRIVATE_KEY; delete process.env.BCA_IPFS_URL;
  report.configurationIsolation = 'passed: invalid signer/IPFS does not prevent CID or discovery';

  const rpcRequests: any[] = [];
  const rpc = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const q = JSON.parse(raw); rpcRequests.push(q);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, ...(q.method === 'eth_chainId' ? { result: '0x7a69' } : q.method === 'eth_getLogs' ? { result: [] } : { error: { code: -32005, message: 'rate limited' } }) }));
  });
  await new Promise<void>((done) => rpc.listen(0, '127.0.0.1', done));
  process.env.BCA_RPC_URL = `http://127.0.0.1:${(rpc.address() as any).port}`; process.env.BCA_CHAIN_ID = '31337';
  const fault = createToolkit(); const hash = `0x${'11'.repeat(32)}`;
  try {
    const topics = [hash, null, [hash]];
    await fault.invoke('viem_logs', { topics, fromBlock: '2', toBlock: '9' });
    assert.deepEqual(rpcRequests.find((q) => q.method === 'eth_getLogs').params[0], { fromBlock: '0x2', toBlock: '0x9', topics });
    await assert.rejects(() => fault.invoke('viem_transaction', { hash }), /getTransaction.*状态未知/s);
    await assert.rejects(() => fault.invoke('viem_logs', { topics: ['0x1234'] }));
    report.controlledRpc = 'passed: raw topics/OR/null positions preserved; rate limit throws stage-specific unknown, malformed topic rejected';
  } finally { await fault.close(); await new Promise<void>((done) => rpc.close(() => done())); }

  const marker = resolve(work, 'descendant.log');
  await writeFile(marker, '');
  const descendant = `const fs=require('fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},'x'),20);`;
  const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setTimeout(()=>{},10000);`;
  const started = Date.now();
  const timeoutLimitMs = 3000;
  await assert.rejects(() => run(process.execPath, ['-e', parent], { cwd: root, timeoutMs: timeoutLimitMs }), /未完成/);
  const timeoutElapsedMs = Date.now() - started;
  assert.ok(timeoutElapsedMs < timeoutLimitMs + 3000, `超时清理未在运行限额 + 2 秒清理边界 + 1 秒调度余量内结束：${timeoutElapsedMs}`);
  const bytes = (await stat(marker)).size;
  assert.ok(bytes > 0, '测试后代须先实际写入，才可验证超时后的停止语义');
  await new Promise((done) => setTimeout(done, 120));
  assert.equal((await stat(marker)).size, bytes);
  assert.equal((await run(process.execPath, ['-e', 'process.stdout.write("ok")'], { cwd: root, timeoutMs: 2000 })).stdout, 'ok');
  await assert.rejects(() => run(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("xxxxxxxx"),1)'], { cwd: root, timeoutMs: 2000, maxBytes: 32 }), /输出超过/);
  await writeFile(marker, '');
  const abort = new AbortController(); const cancelling = run(process.execPath, ['-e', parent], { cwd: root, timeoutMs: 10000, signal: abort.signal });
  const cancelled = assert.rejects(() => cancelling, /已取消/);
  const readyDeadline = Date.now() + 5000;
  while ((await stat(marker)).size === 0 && Date.now() < readyDeadline) await new Promise((done) => setTimeout(done, 25));
  const wroteBeforeCancel = (await stat(marker)).size > 0;
  abort.abort();
  await cancelled;
  assert.ok(wroteBeforeCancel, '取消前须确认后代已开始写入');
  const finalBytes = (await stat(marker)).size; await new Promise((done) => setTimeout(done, 100)); assert.equal((await stat(marker)).size, finalBytes);
  report.processTree = { timeoutElapsedMs, timeoutLimitMs, cleanupDeadlineMs: 2000, timeoutAndCheckElapsedMs: Date.now() - started, noFurtherDescendantWrites: true, outputLimit: 'passed', cancellation: 'passed', normalRun: 'passed' };

  await writeFile(resolve(work, 'Invalid.sol'), 'pragma solidity ^0.8.20; contract Broken { bad syntax }');
  const cli = spawnSync(process.execPath, ['dist/cli/main.js', 'call', 'dev_solidity_compile', '--input', JSON.stringify({ path: '.work/next/Invalid.sol' })], { cwd: root, env: process.env, encoding: 'utf8' });
  assert.equal(cli.status, 2, cli.stdout + cli.stderr); assert.equal(JSON.parse(cli.stdout).taskStatus, 'business_failed');
  const mcp = new Client({ name: 'next-check', version: '1' });
  try {
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/main.js')], cwd: root, env: { BCA_WORKING_ROOT: root } }));
    const result = await mcp.callTool({ name: 'dev_solidity_compile', arguments: { path: '.work/next/Invalid.sol' } });
    assert.equal(result.isError, true); assert.equal((result.structuredContent as any).result.taskStatus, 'business_failed');
  } finally { await mcp.close(); }
  report.failureContract = 'passed: CLI exit 2; MCP isError true; official compiler diagnostics retained';
  delete process.env.BCA_RPC_URL; delete process.env.BCA_CHAIN_ID;
  await writeFile(resolve(work, 'result-regressions.json'), JSON.stringify(report, null, 2));
}

if (mode === 'all' || mode === 'onchain') {
  const net = await import('node:net'); const socket = net.createServer();
  await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done)); const port = (socket.address() as any).port;
  await new Promise<void>((done) => socket.close(() => done()));
  const node = spawn(resolveExecutable('anvil'), ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--steps-tracing'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; node.stdout.on('data', (chunk) => { output += chunk; }); node.stderr.on('data', (chunk) => { output += chunk; });
  const rpc = `http://127.0.0.1:${port}`;
  process.env.BCA_RPC_URL = rpc; process.env.BCA_CHAIN_ID = '31337'; process.env.BCA_ALLOW_WRITES = 'true';
  const provider = new JsonRpcProvider(rpc, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const toolkit = createToolkit(); const call = (name: string, input: unknown = {}) => toolkit.invoke(name, input) as Promise<any>;
  try {
    const deadline = Date.now() + 10000; while (!output.includes('Listening on') && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    assert.match(output, /Listening on/);
    await mkdir(resolve(work, 'contracts/src'), { recursive: true }); await mkdir(resolve(work, 'contracts/test'), { recursive: true });
    await writeFile(resolve(work, 'contracts/foundry.toml'), '[profile.default]\nsrc="src"\ntest="test"\nsolc_version="0.8.35"\nlibs=["../../../node_modules"]\nremappings=["@openzeppelin/=../../../node_modules/@openzeppelin/"]\n');
    await writeFile(resolve(work, 'contracts/src/AcceptanceToken.sol'), `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract AcceptanceToken is ERC20 {
  event Ping(uint256 indexed group, uint256 indexed item);
  event Noise(uint256 indexed group);
  constructor() ERC20("Acceptance", "ACC") { _mint(msg.sender, 1000); }
  function ping(uint256 group, uint256 item) external { emit Ping(group, item); emit Noise(group); }
}
`);
    await writeFile(resolve(work, 'contracts/test/AcceptanceToken.t.sol'), `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../src/AcceptanceToken.sol";
contract AcceptanceTokenTest {
 function testTransfer() public { AcceptanceToken t = new AcceptanceToken(); require(t.totalSupply() == 1000); t.transfer(address(1), 7); require(t.balanceOf(address(1)) == 7); }
}
`);
    const compiled = await call('dev_solidity_compile', { path: '.work/next/contracts/src/AcceptanceToken.sol' }); assert.equal(compiled.success, true);
    await writeFile(resolve(work, 'compiled.json'), JSON.stringify(compiled));
    const contract = compiled.contracts.find((c: any) => c.name === 'AcceptanceToken');
    const signer = await provider.getSigner(0); const other = await provider.getSigner(1);
    const deployed = await new ContractFactory(contract.abi, contract.bytecode, signer).deploy(); await deployed.waitForDeployment(); const address = await deployed.getAddress();
    const a = await (await (deployed as any).ping(1, 9)).wait(); await (await (deployed as any).ping(2, 9)).wait(); await (await (deployed as any).ping(3, 8)).wait();
    const topic1 = zeroPadValue(toBeHex(1), 32); const topic2 = zeroPadValue(toBeHex(2), 32);
    const logs = await call('viem_logs', { address, fromBlock: '0', toBlock: 'latest', topics: [id('Ping(uint256,uint256)'), [topic1, topic2], null] });
    assert.equal(logs.count, 2); assert.ok(logs.logs.every((l: any) => l.topics[0] === id('Ping(uint256,uint256)')));
    assert.equal((await call('viem_transaction', { hash: a.hash })).status, 'confirmed');
    assert.equal((await call('viem_transaction', { hash: `0x${'ab'.repeat(32)}` })).status, 'not_found');
    await provider.send('evm_setAutomine', [false]);
    const pending = await signer.sendTransaction({ to: address, data: deployed.interface.encodeFunctionData('ping', [1, 3]), gasLimit: 100000 });
    assert.equal((await call('viem_transaction', { hash: pending.hash })).status, 'pending'); await provider.send('evm_setAutomine', [true]); await provider.send('evm_mine', []);
    const reverted = await other.sendTransaction({ to: address, data: deployed.interface.encodeFunctionData('transfer', [await signer.getAddress(), 20]), gasLimit: 100000 });
    await reverted.wait().catch(() => {});
    const diagnosis = await call('workstation_diagnose', { hash: reverted.hash, artifact: '.work/next/compiled.json', contractName: 'AcceptanceToken' });
    await writeFile(resolve(work, 'diagnosis.json'), JSON.stringify(diagnosis, null, 2));
    assert.equal(diagnosis.status, 'failed'); assert.equal(diagnosis.diagnosis.decodedError.errorName, 'ERC20InsufficientBalance');
    assert.ok(diagnosis.diagnosis.sourceLocation, JSON.stringify(diagnosis.gaps));
    report.transactionDiagnosis = { hash: reverted.hash, chainId: 31337, blockNumber: diagnosis.receipt.blockNumber, source: diagnosis.diagnosis.sourceLocation, error: diagnosis.diagnosis.decodedError, complete: diagnosis.complete };
    report.realLogs = { count: logs.count, includesNoise: false, positionalOrFilter: true, transactionStates: ['confirmed', 'pending', 'not_found', 'failed'] };
    const project = await call('dev_project', { dir: '.work/next/contracts' }); assert.equal(project.selected, 'foundry');
    const build = await call('dev_forge_build', { dir: '.work/next/contracts', offline: true }); assert.equal(build.taskStatus, 'succeeded', JSON.stringify(build));
    const tests = await call('dev_forge_test', { dir: '.work/next/contracts', matchPath: 'test/AcceptanceToken.t.sol', offline: true }); assert.equal(tests.taskStatus, 'succeeded', JSON.stringify(tests));
    const deployment = await call('dev_forge_deploy_local', { dir: '.work/next/contracts', contract: 'src/AcceptanceToken.sol:AcceptanceToken', from: await signer.getAddress(), submit: true });
    assert.equal(deployment.taskStatus, 'succeeded', JSON.stringify(deployment));
    const read = await call('viem_read', { address: deployment.deployment.deployedTo, abi: contract.abi, functionName: 'totalSupply' }); assert.equal(read.result, '1000');
    report.contractWorkflow = { framework: 'Foundry 1.7.1', dependency: '@openzeppelin/contracts 5.6.1', compiler: compiled.compiler, compile: 'passed', test: 'testTransfer passed', deployment: deployment.deployment, totalSupply: read.result };
    for (const query of ['为什么我的交易失败了', 'debug transaction revert']) assert.equal((await call('workstation_search', { query })).candidates[0].id, 'evm-diagnose');
    for (const query of ['开发一个 ERC20 合约', 'compile Solidity contract']) assert.equal((await call('workstation_search', { query })).candidates[0].id, 'evm-develop');
    assert.equal((await call('workstation_search', { query: '查天气' })).candidates.length, 0);
    assert.equal((await call('workstation_search', { query: 'Solana transaction failed' })).candidates.length, 0);
    report.discovery = 'passed: Chinese/English, unrelated query and unsupported chain';
  } finally { await toolkit.close(); provider.destroy(); node.kill(); await once(node, 'close'); }
}
await writeFile(resolve(work, `result-${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
