import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ContractFactory, JsonRpcProvider, Wallet, ZeroHash, hexlify, parseEther } from 'ethers';
import { CID } from 'multiformats/cid';
import { createToolkit } from '../src/toolkit.js';
import { run } from '../src/development/exec.js';

const { values } = parseArgs({ options: { scope: { type: 'string', default: 'onchain,ipfs,package' } } });
const scopes = values.scope!.split(',');
assert(scopes.every((scope) => ['core', 'onchain', 'ipfs', 'interfaces', 'package', 'windows', 'development'].includes(scope)), '未知 scope');
const root = process.cwd();
for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('BCA_')) delete process.env[key];
process.env.BCA_WORKING_ROOT = root;
process.env.BCA_TIMEOUT_MS = '15000';
const cleanEnv = { ...process.env };
const local = createToolkit();
const bytes = await readFile(resolve(root, 'README.md'));
await mkdir(resolve(root, '.work'), { recursive: true });
const work = await mkdtemp(resolve(root, '.work/smoke-'));
const owned: ChildProcess[] = [];
const require = createRequire(import.meta.url);
const invoke = (name: string, input: unknown = {}) => local.invoke(name, input) as Promise<any>;
const content = await invoke('content_cid', { path: 'README.md' });
assert.equal(content.bytes, bytes.length);
assert.equal(content.format, 'raw');
assert.equal(content.importedToIpfs, false);
const inspected = await invoke('content_inspect', { cid: content.cid });
assert.equal(inspected.codec, 0x55);
assert.equal(inspected.multihash.digestHex, createHash('sha256').update(bytes).digest('hex'));

function command(executable: string, args: string[], env = cleanEnv, cwd = root) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${executable} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return address.port;
}

async function service(name: string, executable: string, args: string[], readyText: string, env = cleanEnv) {
  const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  owned.push(child);
  const log = createWriteStream(resolve(work, `${name}.log`));
  child.stdout!.pipe(log, { end: false });
  child.stderr!.pipe(log, { end: false });
  child.once('close', () => log.end());
  await new Promise<void>((done, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error(`${name} 启动超时；日志：${work}`)), 30_000);
    const onExit = (code: number | null) => finish(new Error(`${name} 启动期间退出 ${code}；日志：${work}`));
    const onData = (chunk: Buffer) => { output += chunk.toString(); if (output.includes(readyText)) finish(); };
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.off('error', finish);
      child.off('exit', onExit);
      child.stdout!.off('data', onData);
      child.stderr!.off('data', onData);
      if (error) reject(error); else done();
    };
    child.once('error', finish);
    child.once('exit', onExit);
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
  });
  console.log(JSON.stringify({ service: name, pid: child.pid, log: resolve(work, `${name}.log`) }));
}

async function evmChecks() {
  const port = await freePort();
  await service('anvil', process.env.ANVIL_BIN ?? 'anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337'], 'Listening on');
  const rpc = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(rpc, 31337, { staticNetwork: true, cacheTimeout: -1 });
  try {
    const registryArtifact = require('@ethereum-attestation-service/eas-contracts/artifacts/contracts/SchemaRegistry.sol/SchemaRegistry.json');
    const easArtifact = require('@ethereum-attestation-service/eas-contracts/artifacts/contracts/EAS.sol/EAS.json');
    const deployer = await provider.getSigner(0);
    const registry = await new ContractFactory(registryArtifact.abi, registryArtifact.bytecode, deployer).deploy();
    await registry.waitForDeployment();
    const eas = await new ContractFactory(easArtifact.abi, easArtifact.bytecode, deployer).deploy(await registry.getAddress());
    await eas.waitForDeployment();
    const wallet = Wallet.createRandom();
    await (await deployer.sendTransaction({ to: wallet.address, value: parseEther('1') })).wait();
    Object.assign(process.env, { BCA_RPC_URL: rpc, BCA_CHAIN_ID: '31337', BCA_EAS_ADDRESS: await eas.getAddress(), BCA_SCHEMA_REGISTRY_ADDRESS: await registry.getAddress(), BCA_ALLOW_WRITES: 'true', BCA_PRIVATE_KEY: wallet.privateKey });
    const toolkit = createToolkit();
    const call = (name: string, input: unknown = {}) => toolkit.invoke(name, input) as Promise<any>;
    assert.equal((await call('evm_chain')).chainId, '31337');
    assert.equal((await call('evm_balance', { address: wallet.address })).balanceWei, parseEther('1').toString());
    assert.equal((await call('eas_status')).contractCodeVerified, true);
    const schema = 'string cid,bytes content';
    const encoded = await call('eas_schema_encode', { schema, fields: [{ name: 'cid', type: 'string', value: content.cid }, { name: 'content', type: 'bytes', value: hexlify(bytes) }] });
    const decoded = await call('eas_schema_decode', { schema, data: encoded.data });
    assert.equal(decoded.fields[0].value.value, content.cid);
    assert.equal(decoded.fields[1].value.value, hexlify(bytes));
    if (scopes.includes('development')) {
      const compiled = await call('dev_solidity_compile', { path: 'examples/contracts/src/Counter.sol' });
      assert.equal(compiled.success, true);
      const artifact = compiled.contracts.find((contract: { name: string }) => contract.name === 'Counter');
      assert(artifact);
      const counter = await new ContractFactory(artifact.abi, artifact.bytecode, deployer).deploy();
      await counter.waitForDeployment();
      const address = await counter.getAddress();
      assert.equal((await call('dev_cast_chain_id')).chainId, '31337');
      assert(BigInt((await call('dev_cast_block_number')).blockNumber) > 0n);
      assert.equal((await call('dev_cast_balance', { address: wallet.address })).balanceWei, parseEther('1').toString());
      assert.equal((await call('dev_cast_call', { to: address, signature: 'get()(uint256)' })).parsed[0], 0);
      assert.equal((await call('viem_chain')).chainId, '31337');
      assert.equal((await call('viem_balance', { address: wallet.address })).balanceWei, parseEther('1').toString());
      assert(BigInt((await call('viem_block')).block.number) > 0n);
      assert.equal((await call('viem_read', { address, abi: artifact.abi, functionName: 'get' })).result, '0');
      const increment = await counter.getFunction('increment')();
      await increment.wait();
      assert.equal((await call('viem_read', { address, abi: artifact.abi, functionName: 'get' })).result, '1');
      const transaction = await call('viem_transaction', { hash: increment.hash });
      assert.equal(transaction.found, true);
      assert.equal(transaction.receiptFound, true);
      assert.equal((await call('viem_logs', { address, fromBlock: '0' })).count, 0);
      console.log(JSON.stringify({ scope: 'development', compiler: compiled.compiler, cast: true, viem: true, contract: address, incrementHash: increment.hash }));
    }
    if (scopes.includes('onchain')) {
      const registered = await call('eas_schema_register', { schema, revocable: true, submit: true });
      assert.equal(registered.receipt.status, 1);
      const storedSchema = await call('eas_schema_get', { uid: registered.uid });
      assert.equal(storedSchema.found, true);
      assert.equal(storedSchema.schema.schema, schema);
      const attested = await call('eas_attest', { schema: registered.uid, data: encoded.data, revocable: true, submit: true });
      assert.equal(attested.receipt.status, 1);
      const before = await call('eas_get', { uid: attested.uid });
      assert.equal(before.found, true);
      assert.equal(before.attestation.schema, registered.uid);
      assert.equal(before.attestation.data, encoded.data);
      assert.equal(before.attestation.attester, wallet.address);
      assert.equal(before.attestation.revocationTime, '0');
      const receipt = await call('evm_receipt', { transactionHash: attested.transactionHash });
      assert.equal(receipt.found, true);
      assert.equal(receipt.receipt.hash, attested.transactionHash);
      assert.equal(receipt.receipt.status, 1);
      const revoked = await call('eas_revoke', { schema: registered.uid, uid: attested.uid, submit: true });
      assert.equal(revoked.receipt.status, 1);
      const after = await call('eas_get', { uid: attested.uid });
      assert(BigInt(after.attestation.revocationTime) > 0n);
      assert.equal(after.attestation.data, encoded.data);
      console.log(JSON.stringify({ scope: 'onchain', chainId: '31337', registry: await registry.getAddress(), eas: await eas.getAddress(), schema: registered.uid, uid: attested.uid, transactions: [registered.transactionHash, attested.transactionHash, revoked.transactionHash], revocationTime: after.attestation.revocationTime, cid: content.cid, bytes: bytes.length }));
    }
    if (scopes.includes('core')) {
      const signature = await wallet.signMessage(content.cid);
      const personal = await call('evm_verify_message', { message: content.cid, signature, expectedSigner: wallet.address });
      assert.equal(personal.signatureValid, true);
      assert.equal(personal.recoveredSigner, wallet.address);
      assert.equal((await call('evm_verify_message', { message: `${content.cid}!`, signature, expectedSigner: wallet.address })).signatureValid, false);
      const signed = await call('eas_offchain_sign', { schema: ZeroHash, data: encoded.data, revocable: true, time: String((await provider.getBlock('latest'))!.timestamp), submit: true });
      assert.equal(signed.onchainSubmitted, false);
      assert.equal(signed.attestation.version, 2);
      const verified = await call('eas_offchain_verify', { expectedSigner: wallet.address, attestation: signed.attestation });
      assert.equal(verified.signatureValid, true);
      assert.equal(verified.domainChecked, true);
      for (const flag of ['revocationChecked', 'timestampChecked', 'expirationChecked', 'trustChecked']) assert.equal(verified[flag], false);
      const changed = structuredClone(signed.attestation);
      changed.message.data = hexlify(bytes.subarray(1));
      assert.equal((await call('eas_offchain_verify', { expectedSigner: wallet.address, attestation: changed })).signatureValid, false);
      process.env.BCA_CHAIN_ID = '84532';
      await assert.rejects(createToolkit().invoke('evm_chain', {}), /chain ID 不匹配/);
      console.log(JSON.stringify({ scope: 'core', eip191: true, offchainVersion: 2, tamperingRejected: true, chainMismatchRejected: true }));
    }
  } finally {
    provider.destroy();
    for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('BCA_')) delete process.env[key];
    Object.assign(process.env, cleanEnv);
  }
}

async function ipfsChecks() {
  const binary = process.env.KUBO_BIN ?? 'ipfs';
  const env = { ...cleanEnv, IPFS_PATH: resolve(work, 'kubo') };
  const apiPort = await freePort();
  command(binary, ['init', '--profile=test'], env);
  command(binary, ['config', 'Addresses.API', `/ip4/127.0.0.1/tcp/${apiPort}`], env);
  command(binary, ['config', 'Addresses.Gateway', '/ip4/127.0.0.1/tcp/0'], env);
  command(binary, ['config', '--json', 'Addresses.Swarm', '[]'], env);
  command(binary, ['bootstrap', 'rm', '--all'], env);
  await service('kubo', binary, ['daemon', '--offline'], 'Daemon is ready', env);
  Object.assign(process.env, { BCA_IPFS_URL: `http://127.0.0.1:${apiPort}`, BCA_ALLOW_WRITES: 'true' });
  try {
    const toolkit = createToolkit();
    const status = await toolkit.invoke('ipfs_status', {}) as any;
    assert.equal(status.connectionVerified, true);
    const added = await toolkit.invoke('ipfs_add', { path: 'README.md', submit: true }) as any;
    assert.equal(added.format, 'unixfs');
    assert.equal(added.pinned, true);
    assert.equal(added.bytes, bytes.length);
    assert.equal(CID.parse(added.cid).code, 0x70);
    assert.notEqual(added.cid, content.cid);
    const read = await toolkit.invoke('ipfs_read', { cid: added.cid, maxBytes: bytes.length }) as any;
    assert.equal(read.encoding, 'base64');
    assert.equal(read.bytes, bytes.length);
    assert.deepEqual(Buffer.from(read.data, 'base64'), bytes);
    await assert.rejects(toolkit.invoke('ipfs_read', { cid: added.cid, maxBytes: bytes.length - 1 }), /超过读取字节上限/);
    console.log(JSON.stringify({ scope: 'ipfs', version: status.version.version, rawCid: content.cid, unixfsCid: added.cid, bytes: read.bytes, identicalBytes: true, offline: true, repo: env.IPFS_PATH }));
  } finally {
    delete process.env.BCA_IPFS_URL;
    delete process.env.BCA_ALLOW_WRITES;
  }
}

async function interfaceChecks(cli: string, mcp: string, cwd: string) {
  const result = JSON.parse(command(process.execPath, [cli, 'call', 'content_cid', '--input', JSON.stringify({ path: 'README.md' })], cleanEnv, cwd));
  assert.deepEqual(result, content);
  const rejected = spawnSync(process.execPath, [cli, 'call', 'content_cid', '--input', '{'], { cwd, env: cleanEnv, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  if (rejected.error) throw rejected.error;
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  const client = new Client({ name: 'bca-real-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [mcp], cwd, env: cleanEnv as Record<string, string>, stderr: 'pipe' });
  let stderr = '';
  const errors: Error[] = [];
  client.onerror = (error) => errors.push(error);
  transport.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), local.tools.map((tool) => tool.name).sort());
    const called = await client.callTool({ name: 'content_cid', arguments: { path: 'README.md' } });
    assert.notEqual(called.isError, true);
    assert.deepEqual(called.structuredContent, { result: content });
    const failed = await client.callTool({ name: 'content_cid', arguments: {} });
    assert.equal(failed.isError, true);
    assert.equal(failed.content[0]?.type, 'text');
    assert.equal(errors.length, 0);
    assert.equal(stderr, '');
    return listed.tools.length;
  } finally {
    await client.close();
  }
}

async function windowsChecks() {
  assert.equal(process.platform, 'win32', 'windows 范围需要真实 Windows 系统');
  const workspace = resolve(work, '中文 空格');
  const restricted = resolve(work, 'restricted');
  await cp(resolve(root, 'examples/contracts'), workspace, { recursive: true, filter: (path) => !['out', 'cache'].includes(path.split(/[\\/]/).at(-1)!) });
  await cp(resolve(root, 'README.md'), resolve(workspace, 'README.md'));
  await mkdir(resolve(restricted, 'test'), { recursive: true });
  await cp(resolve(root, 'examples/contracts/test/Counter.t.sol'), resolve(restricted, 'test/Counter.t.sol'));
  await symlink(resolve(workspace, 'src'), resolve(restricted, 'src'), 'junction');
  try {
    process.env.BCA_WORKING_ROOT = workspace;
    const allowed = createToolkit();
    assert.equal((await allowed.invoke('content_cid', { path: 'README.md' }) as any).cid, content.cid);
    assert.equal((await allowed.invoke('dev_solidity_compile', { path: 'test/Counter.t.sol' }) as any).success, true);
    process.env.BCA_WORKING_ROOT = restricted;
    const confined = createToolkit();
    const denied = await confined.invoke('dev_solidity_compile', { path: 'test/Counter.t.sol' }) as any;
    assert.equal(denied.success, false);
    assert(denied.diagnostics.some((item: { message: string }) => item.message.includes('import 超出 BCA_WORKING_ROOT')));
    await assert.rejects(confined.invoke('content_cid', { path: 'src/Counter.sol' }), /超出 BCA_WORKING_ROOT/);
    await assert.rejects(confined.invoke('dev_forge_build', { dir: 'src', offline: true }), /超出 BCA_WORKING_ROOT/);
    await mkdir(resolve(restricted, 'skills'));
    await cp(resolve(root, 'README.md'), resolve(workspace, 'SKILL.md'));
    await symlink(workspace, resolve(restricted, 'skills/external'), 'junction');
    process.env.BCA_SKILLS_ROOT = resolve(restricted, 'skills');
    await assert.rejects(confined.invoke('dev_skill_read', { name: 'external' }), /超出 BCA_SKILLS_ROOT/);
    const skillParent = resolve(work, 'skill-parent');
    await mkdir(skillParent);
    await symlink(skillParent, resolve(work, 'skill-root'), 'junction');
    await mkdir(resolve(skillParent, 'local'));
    await cp(resolve(root, 'README.md'), resolve(skillParent, 'local/SKILL.md'));
    process.env.BCA_SKILLS_ROOT = resolve(work, 'skill-root');
    assert.equal((await confined.invoke('dev_skill_read', { name: 'local' }) as any).content, bytes.toString('utf8'));
    process.env.BcA_PrIvAtE_KeY = Wallet.createRandom().privateKey;
    process.env.BcA_McP_SeRvErS = JSON.stringify({ mcpServers: {} });
    process.env.BcA_McP_CoNfIg = resolve(work, 'mcp.json');
    for (const key of ['BcA_Api_ToKeN', 'BcA_AuTh', 'BcA_SeCrEt', 'BcA_PaSsWoRd']) process.env[key] = process.execPath;
    const child = await run(process.execPath, ['-e', 'console.log(JSON.stringify(Object.keys(process.env).filter(key => { const name = key.toUpperCase(); return ["BCA_MCP_SERVERS", "BCA_MCP_CONFIG"].includes(name) || (name.startsWith("BCA_") && /KEY|TOKEN|AUTH|SECRET|PASSWORD/.test(name)); })))'], { cwd: workspace, timeoutMs: 10000 });
    assert.equal(child.exitCode, 0);
    assert.deepEqual(JSON.parse(child.stdout), []);
    console.log(JSON.stringify({ scope: 'windows', unicodeAndSpaces: true, junctionRejected: true, skillRootJunction: true, childCredentialsRemoved: true }));
  } finally {
    for (const key of Object.keys(process.env)) if (key.toUpperCase().startsWith('BCA_')) delete process.env[key];
    Object.assign(process.env, cleanEnv);
  }
}

try {
  console.log(JSON.stringify({ scopes, tools: local.tools.length, work }));
  if (scopes.includes('windows')) await windowsChecks();
  if (scopes.includes('core') || scopes.includes('onchain') || scopes.includes('development')) await evmChecks();
  if (scopes.includes('ipfs')) await ipfsChecks();
  if (scopes.includes('interfaces')) {
    const tools = await interfaceChecks(resolve(root, 'dist/cli/main.js'), resolve(root, 'dist/mcp/main.js'), root);
    console.log(JSON.stringify({ scope: 'interfaces', tools }));
  }
  if (scopes.includes('package')) {
    assert(process.env.npm_execpath, '请通过 npm run smoke 执行打包检查');
    const npm = process.env.npm_execpath;
    const packed = JSON.parse(command(process.execPath, [npm, 'pack', '--json', '--pack-destination', work]));
    const tarball = resolve(work, packed[0].filename);
    const installed = resolve(work, 'installed');
    await mkdir(installed);
    command(process.execPath, [npm, 'install', '--prefix', installed, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--package-lock=false', tarball]);
    const packageRoot = resolve(installed, 'node_modules/blockchain-anything');
    const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
    const tools = await interfaceChecks(resolve(packageRoot, manifest.bin.bca), resolve(packageRoot, manifest.exports['./mcp'].import), installed);
    console.log(JSON.stringify({ scope: 'package', tarball, installed, tools, cli: manifest.bin.bca, mcp: manifest.exports['./mcp'].import }));
  }
} finally {
  for (const child of owned.reverse()) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      assert(child.kill(), `无法终止本次创建的进程 ${child.pid}`);
      await exited;
    }
    console.log(JSON.stringify({ cleanup: 'stopped', pid: child.pid, exitCode: child.exitCode, signal: child.signalCode }));
  }
}
