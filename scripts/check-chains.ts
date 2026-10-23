import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  fetchMaybeAttestation,
  fetchMaybeCredential,
  fetchMaybeSchema,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from '@solana/attestation';
import { address, createSolanaRpc } from '@solana/kit';
import { ContractFactory, JsonRpcProvider, Wallet, hexlify, parseEther, randomBytes } from 'ethers';
import { createPublicClient, http, parseAbi, toHex, type Address } from 'viem';
import { chainStorageTools } from '../src/chains/index.js';
import { readConfig } from '../src/config.js';
import { safeError, serializable } from '../src/providers/common.js';
import { easTools } from '../src/providers/eas.js';
import { evmTools } from '../src/providers/evm.js';

const scopes = ['eas', 'sign', 'sui', 'aptos', 'sas', 'walrus', 'seal', 'arweave'] as const;
type Scope = (typeof scopes)[number];
const { values } = parseArgs({ options: { scope: { type: 'string', default: scopes.join(',') } } });
const selected = values.scope!.split(',').map((item) => item.trim()).filter(Boolean);
assert(selected.every((scope) => (scopes as readonly string[]).includes(scope)), '未知 scope');
const root = process.cwd();
const require = createRequire(import.meta.url);
const owned: ChildProcess[] = [];
const results: Array<{ scope: Scope; status: 'passed' | 'skipped' | 'failed'; detail: unknown }> = [];

for (const key of Object.keys(process.env)) if (key.startsWith('BCA_')) delete process.env[key];
process.env.BCA_WORKING_ROOT = root;
process.env.BCA_TIMEOUT_MS = '20000';

function harness() {
  const config = readConfig();
  const implementations = [...evmTools(config), ...easTools(config), ...chainStorageTools()];
  const byName = new Map(implementations.map((tool) => [tool.name, tool]));
  return {
    tools: implementations,
    async call(name: string, input: unknown = {}): Promise<any> {
      const tool = byName.get(name);
      if (!tool) throw new Error(`未知工具：${name}`);
      try {
        return serializable(await tool.execute(input));
      } catch (error) {
        throw safeError(error, config);
      }
    },
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const info = server.address();
  assert(info && typeof info === 'object');
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return info.port;
}

async function startAnvil(): Promise<{ rpc: string; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn(process.env.ANVIL_BIN ?? 'anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  owned.push(child);
  await new Promise<void>((done, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('Anvil 启动超时')), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Listening on')) finish();
    };
    const onExit = (code: number | null) => finish(new Error(`Anvil 启动期间退出 ${code}`));
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.stdout!.off('data', onData);
      child.stderr!.off('data', onData);
      child.off('exit', onExit);
      if (error) reject(error); else done();
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.once('exit', onExit);
  });
  return { rpc: `http://127.0.0.1:${port}`, child };
}

async function stopOwned(): Promise<void> {
  for (const child of owned.reverse()) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
}

function setEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function clearEnv(...keys: string[]): void {
  for (const key of keys) delete process.env[key];
}

async function easChecks(): Promise<{ status: 'passed'; detail: unknown }> {
  process.env.BCA_IPV4_ONLY = 'true';
  const { rpc } = await startAnvil();
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
    await (await deployer.sendTransaction({ to: wallet.address, value: parseEther('10') })).wait();
    setEnv({
      BCA_RPC_URL: rpc,
      BCA_CHAIN_ID: '31337',
      BCA_EAS_ADDRESS: await eas.getAddress(),
      BCA_SCHEMA_REGISTRY_ADDRESS: await registry.getAddress(),
      BCA_ALLOW_WRITES: 'true',
      BCA_PRIVATE_KEY: wallet.privateKey,
      BCA_WORKING_ROOT: root,
    });
    const { call } = harness();
    const schema = 'string cid,uint256 size,bytes content';
    const fields = (cid: string) => [
      { name: 'cid', type: 'string', value: cid },
      { name: 'size', type: 'uint256', value: '42' },
      { name: 'content', type: 'bytes', value: hexlify(randomBytes(16)) },
    ];
    const encoded = await call('eas_schema_encode', { schema, fields: fields('bafkreicheck') });
    const decoded = await call('eas_schema_decode', { schema, data: encoded.data });
    assert.equal(decoded.fields[0].value.value, 'bafkreicheck');
    assert.equal(BigInt(decoded.fields[1].value.value), 42n);

    const registered = await call('eas_schema_register', { schema, revocable: true, submit: true });
    assert.match(registered.uid, /^0x[0-9a-f]{64}$/);
    const stored = await call('eas_schema_get', { uid: registered.uid });
    assert.equal(stored.found, true);
    assert.equal(stored.schema.schema, schema);

    const attested = await call('eas_attest', { schema: registered.uid, data: encoded.data, revocable: true, submit: true });
    const record = await call('eas_get', { uid: attested.uid });
    assert.equal(record.found, true);
    assert.equal(record.attestation.revocationTime, '0');

    const encoded2 = await call('eas_schema_encode', { schema, fields: fields('bafkreicheck2') });
    const multi = await call('eas_multi_attest', {
      requests: [{ schema: registered.uid, attestations: [
        { revocable: true, data: encoded.data },
        { revocable: true, data: encoded2.data },
      ] }],
      submit: true,
    });
    assert.equal(multi.uids.length, 2);
    for (const uid of multi.uids) assert.equal((await call('eas_get', { uid })).found, true);

    const timestamp = await call('eas_timestamp', { data: hexlify(randomBytes(32)), submit: true });
    assert(BigInt(timestamp.timestamp) > 0n);

    const privateData = await call('eas_private_data_build', {
      values: [
        { type: 'string', name: 'cid', value: 'bafkreicheck' },
        { type: 'uint256', name: 'size', value: '42' },
      ],
      indexes: [0, 1],
    });
    assert.match(privateData.root, /^0x[0-9a-f]{64}$/);
    assert.equal((await call('eas_private_data_verify', { root: privateData.root, proof: privateData.proof })).valid, true);
    const tampered = structuredClone(privateData.proof);
    const leaf = tampered.leaves.find((item: { type: string }) => item.type === 'string');
    assert(leaf);
    leaf.value = 'tampered';
    assert.equal((await call('eas_private_data_verify', { root: privateData.root, proof: tampered })).valid, false);
    assert.equal((await call('eas_private_data_verify_tree', { tree: privateData.tree })).matches, true);

    const delegated = await call('eas_delegated_sign', { schema: registered.uid, revocable: true, data: encoded.data, submit: true });
    const delegatedAttest = await call('eas_delegated_attest', {
      schema: registered.uid,
      revocable: true,
      data: encoded.data,
      attester: delegated.response.message.attester,
      deadline: delegated.response.message.deadline,
      signature: delegated.response.signature,
      submit: true,
    });
    assert.match(delegatedAttest.uid, /^0x[0-9a-f]{64}$/);
    const delegatedRevokeSign = await call('eas_delegated_sign_revoke', { schema: registered.uid, uid: delegatedAttest.uid, submit: true });
    await call('eas_delegated_revoke', {
      schema: registered.uid,
      uid: delegatedAttest.uid,
      revoker: delegatedRevokeSign.response.message.revoker,
      deadline: delegatedRevokeSign.response.message.deadline,
      signature: delegatedRevokeSign.response.signature,
      submit: true,
    });
    assert.notEqual((await call('eas_get', { uid: delegatedAttest.uid })).attestation.revocationTime, '0');

    const revoked = await call('eas_multi_revoke', {
      requests: [{ schema: registered.uid, revocations: multi.uids.map((uid: string) => ({ uid })) }],
      submit: true,
    });
    assert.equal(revoked.revoked, 2);
    for (const uid of multi.uids) assert.notEqual((await call('eas_get', { uid })).attestation.revocationTime, '0');

    const viemChain = await call('viem_chain');
    assert.equal(viemChain.connectionVerified, true);
    const viemBlock = await call('viem_block', { block: 'latest' });
    assert(Number(viemBlock.block.number) >= 0);
    const viemBalance = await call('viem_balance', { address: wallet.address });
    assert(BigInt(viemBalance.balanceWei) > 0n);
    assert(BigInt(viemBalance.balanceWei) < parseEther('10'));
    const viemRead = await call('viem_read', {
      address: await eas.getAddress(),
      abi: easArtifact.abi,
      functionName: 'version',
    });
    assert.equal(typeof viemRead.result, 'string');
    const viemTransaction = await call('viem_transaction', { hash: attested.transactionHash });
    assert.equal(viemTransaction.found, true);
    assert.equal(viemTransaction.receiptFound, true);
    const viemLogs = await call('viem_logs', { address: await eas.getAddress(), fromBlock: '0', toBlock: 'latest' });
    assert(viemLogs.count > 0);

    return {
      status: 'passed',
      detail: {
        chainId: '31337',
        registry: await registry.getAddress(),
        eas: await eas.getAddress(),
        schema: registered.uid,
        attestation: attested.uid,
        multiUids: multi.uids,
        timestamp: timestamp.timestamp,
        privateDataRoot: privateData.root,
        delegatedUid: delegatedAttest.uid,
        viemVersion: viemRead.result,
        viemLogs: viemLogs.count,
        viemTransaction: attested.transactionHash,
      },
    };
  } finally {
    provider.destroy();
    clearEnv('BCA_RPC_URL', 'BCA_CHAIN_ID', 'BCA_EAS_ADDRESS', 'BCA_SCHEMA_REGISTRY_ADDRESS', 'BCA_ALLOW_WRITES', 'BCA_PRIVATE_KEY', 'BCA_WORKING_ROOT', 'BCA_IPV4_ONLY');
  }
}

const signAbi = parseAbi([
  'function schemaCounter() view returns (uint64)',
  'function attestationCounter() view returns (uint64)',
]);

async function signChecks(): Promise<{ status: 'passed' | 'skipped'; detail: unknown }> {
  setEnv({
    BCA_RPC_URL: 'https://sepolia.drpc.org',
    BCA_CHAIN_ID: '11155111',
    BCA_WORKING_ROOT: root,
    BCA_ALLOW_WRITES: 'true',
    BCA_PRIVATE_KEY: Wallet.createRandom().privateKey,
  });
  try {
    const { call } = harness();
    const status = await call('sign_status');
    assert.equal(status.chainId, '11155111');
    assert.equal(status.contractCodeVerified, true);
    const publicClient = createPublicClient({ transport: http('https://sepolia.drpc.org', { timeout: 20_000, retryCount: 0 }) });
    const schemaCounter = await publicClient.readContract({ address: status.address as Address, abi: signAbi, functionName: 'schemaCounter' });
    const attestationCounter = await publicClient.readContract({ address: status.address as Address, abi: signAbi, functionName: 'attestationCounter' });
    let schema: unknown = null;
    let attestation: unknown = null;
    if (schemaCounter > 1n) {
      schema = await call('sign_schema_get', { schemaId: toHex(schemaCounter - 1n) });
    }
    if (attestationCounter > 1n) {
      attestation = await call('sign_attestation_get', { attestationId: toHex(attestationCounter - 1n) });
    }
    // 公开 Sepolia 上的单字段 string Schema；只做链下委托签名，不广播交易。
    const delegated = await call('sign_delegated_sign_attestation', {
      schemaId: '0xdb63',
      data: { TEST: 'bca-check' },
      indexingValue: 'bca-check',
      submit: true,
    });
    assert.equal(delegated.signatureValid, true);
    assert.equal(delegated.onchainSubmitted, false);
    return {
      status: schema && attestation ? 'passed' : 'skipped',
      detail: {
        chainId: status.chainId,
        address: status.address,
        version: status.version,
        schemaCounter: schemaCounter.toString(),
        attestationCounter: attestationCounter.toString(),
        schemaRead: schema !== null,
        attestationRead: attestation !== null,
        delegatedSignatureValid: delegated.signatureValid,
        delegatedHash: delegated.delegatedHash,
      },
    };
  } finally {
    clearEnv('BCA_RPC_URL', 'BCA_CHAIN_ID', 'BCA_WORKING_ROOT', 'BCA_ALLOW_WRITES', 'BCA_PRIVATE_KEY');
  }
}

async function suiChecks(): Promise<{ status: 'passed'; detail: unknown }> {
  setEnv({
    BCA_SUI_NETWORK: 'mainnet',
    BCA_SUI_RPC_URL: 'https://fullnode.mainnet.sui.io:443',
    BCA_WORKING_ROOT: root,
  });
  try {
    const { call } = harness();
    const status = await call('sui_status');
    assert.equal(status.connectionVerified, true);
    const object = await call('sui_object', { objectId: '0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2' });
    assert.equal(object.object.objectId, '0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2');
    const balance = await call('sui_balance', { owner: '0x2' });
    assert.equal(typeof balance.balance.balance, 'string');
    const transaction = await call('sui_transaction', { digest: object.object.previousTransaction });
    assert(transaction.transaction);
    return {
      status: 'passed',
      detail: {
        chainIdentifier: status.chainIdentifier,
        objectVersion: object.object.version,
        balance: balance.balance.balance,
        transaction: transaction.transaction.digest ?? object.object.previousTransaction,
      },
    };
  } finally {
    clearEnv('BCA_SUI_NETWORK', 'BCA_SUI_RPC_URL', 'BCA_WORKING_ROOT');
  }
}

async function aptosChecks(): Promise<{ status: 'passed'; detail: unknown }> {
  setEnv({
    BCA_APTOS_NETWORK: 'mainnet',
    BCA_APTOS_NODE_URL: 'https://fullnode.mainnet.aptoslabs.com/v1',
    BCA_WORKING_ROOT: root,
  });
  try {
    const { call } = harness();
    const status = await call('aptos_status');
    assert.equal(status.connectionVerified, true);
    const account = await call('aptos_account', { accountAddress: '0x1' });
    assert(account.account);
    const balance = await call('aptos_balance', { accountAddress: '0x1' });
    assert.equal(typeof balance.balanceOctas, 'string');
    const resource = await call('aptos_resource', { accountAddress: '0x1', resourceType: '0x1::account::Account' });
    assert.equal(resource.resourceType, '0x1::account::Account');
    assert.equal(typeof resource.data.sequence_number, 'string');
    return {
      status: 'passed',
      detail: {
        chainId: status.ledger.chain_id,
        ledgerVersion: status.ledger.ledger_version,
        sequenceNumber: account.account.sequence_number,
        balanceOctas: balance.balanceOctas,
      },
    };
  } finally {
    clearEnv('BCA_APTOS_NETWORK', 'BCA_APTOS_NODE_URL', 'BCA_WORKING_ROOT');
  }
}

async function solanaProgramAccounts(discriminator: string): Promise<string[]> {
  const response = await fetch('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getProgramAccounts',
      params: [SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS, {
        encoding: 'base64',
        dataSlice: { offset: 0, length: 0 },
        filters: [{ memcmp: { offset: 0, bytes: discriminator } }],
      }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as { result?: Array<{ pubkey: string }>; error?: { message: string } };
  if (payload.error) throw new Error(payload.error.message);
  return (payload.result ?? []).map((entry) => entry.pubkey);
}

async function sasChecks(): Promise<{ status: 'passed' | 'skipped'; detail: unknown }> {
  setEnv({
    BCA_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
    BCA_WORKING_ROOT: root,
  });
  try {
    const { call } = harness();
    const status = await call('sas_status');
    assert.equal(status.executable, true);
    const rpc = createSolanaRpc('https://api.mainnet-beta.solana.com');
    // 主网实际账户 discriminator：Credential=0、Schema=1、Attestation=2（base58 首字节 1/2/3）。
    const credentialAddresses = await solanaProgramAccounts('1');
    const schemaAddresses = await solanaProgramAccounts('2');
    const attestationAddresses = await solanaProgramAccounts('3');
    if (credentialAddresses.length === 0) {
      return { status: 'skipped', detail: { reason: '主网未发现 Credential 账户', slot: status.slot } };
    }
    const credentialAccount = await fetchMaybeCredential(rpc as never, address(credentialAddresses[0]!));
    assert.equal(credentialAccount.exists, true);
    if (!credentialAccount.exists) throw new Error('Credential 账户不存在');
    const credentialName = new TextDecoder().decode(credentialAccount.data.name).replace(/\0+$/u, '');
    const credential = await call('sas_credential_get', { authority: credentialAccount.data.authority, name: credentialName });
    assert.equal(credential.found, true);
    assert.equal(credential.address, credentialAccount.address);

    let schemaDetail: unknown = null;
    let attestationDetail: unknown = null;
    if (schemaAddresses.length > 0) {
      const schemaAccount = await fetchMaybeSchema(rpc as never, address(schemaAddresses[0]!));
      if (schemaAccount.exists) {
        schemaDetail = await call('sas_schema_get', {
          credential: schemaAccount.data.credential,
          name: schemaAccount.data.name,
          version: schemaAccount.data.version,
        });
        assert.equal((schemaDetail as any).address, schemaAccount.address);
      }
    }
    if (attestationAddresses.length > 0) {
      const attestationAccount = await fetchMaybeAttestation(rpc as never, address(attestationAddresses[0]!));
      if (attestationAccount.exists) {
        attestationDetail = await call('sas_attestation_get', {
          credential: attestationAccount.data.credential,
          schema: attestationAccount.data.schema,
          nonce: attestationAccount.data.nonce,
        });
        assert.equal((attestationDetail as any).address, attestationAccount.address);
      }
    }
    return {
      status: 'passed',
      detail: {
        programId: status.programId,
        slot: status.slot,
        credentialAddress: credential.address,
        credentialName,
        schemas: schemaAddresses.length,
        attestations: attestationAddresses.length,
        schemaVerified: schemaDetail !== null,
        attestationVerified: attestationDetail !== null,
      },
    };
  } finally {
    clearEnv('BCA_SOLANA_RPC_URL', 'BCA_WORKING_ROOT');
  }
}

async function walrusChecks(): Promise<{ status: 'passed' | 'skipped'; detail: unknown }> {
  setEnv({
    BCA_SUI_NETWORK: 'testnet',
    BCA_SUI_RPC_URL: 'https://fullnode.testnet.sui.io:443',
    BCA_WORKING_ROOT: root,
  });
  try {
    const { call } = harness();
    const status = await call('walrus_status');
    assert.equal(status.connectionVerified, true);
    let blobObject: unknown = null;
    try {
      blobObject = await call('walrus_blob_object', { blobObjectId: '0xe91eee8c5b6f35b9a250cfc29e30f0d9e5463a21fd8d1ddb0fc22d44db4eac50' });
    } catch (error) {
      blobObject = { error: error instanceof Error ? error.message : String(error) };
    }
    return {
      status: 'passed',
      detail: {
        chainIdentifier: status.chainIdentifier,
        storageCost: status.storageCostFor1MiB1Epoch,
        blobObject,
        blobRead: '未执行：Testnet 无稳定 blob 固定样本，且本轨道不执行存储写入',
      },
    };
  } finally {
    clearEnv('BCA_SUI_NETWORK', 'BCA_SUI_RPC_URL', 'BCA_WORKING_ROOT');
  }
}

async function sealChecks(): Promise<{ status: 'passed' | 'skipped'; detail: unknown }> {
  setEnv({
    BCA_SUI_NETWORK: 'testnet',
    BCA_SUI_RPC_URL: 'https://fullnode.testnet.sui.io:443',
    BCA_SEAL_SERVERS: JSON.stringify([
      { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
      { objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', weight: 1 },
      { objectId: '0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98', weight: 1, aggregatorUrl: 'https://seal-aggregator-testnet.mystenlabs.com' },
    ]),
    BCA_SEAL_THRESHOLD: '2',
    // Seal SDK 要求包对象的第一个版本；testnet 原始包 ID 来自官方 Published.toml。
    BCA_SEAL_PACKAGE_ID: '0x4614e5da0136ee7d464992ddd3719d388ae2bfdb48dfec6d9ad579f87341f2e1',
    BCA_WORKING_ROOT: root,
  });
  try {
    const { call } = harness();
    const status = await call('seal_status');
    assert(status.servers.length >= 2);
    const encrypted = await call('seal_encrypt', {
      id: `0x${Buffer.from('bca-check', 'utf8').toString('hex')}`,
      threshold: 2,
      data: Buffer.from('seal-check', 'utf8').toString('base64'),
    });
    assert.equal(encrypted.keyReturned, false);
    assert.equal(encrypted.threshold, 2);
    const parsed = await call('seal_parse', { data: encrypted.data });
    assert.equal(parsed.id, encrypted.id);
    return {
      status: 'passed',
      detail: {
        servers: status.servers.map((server: any) => server.objectId),
        packageId: encrypted.packageId,
        id: encrypted.id,
        threshold: parsed.threshold,
        ciphertextBytes: encrypted.bytes,
        decrypt: '未执行：需要应用自己的 Move seal_approve 策略包和钱包签名会话',
      },
    };
  } finally {
    clearEnv('BCA_SUI_NETWORK', 'BCA_SUI_RPC_URL', 'BCA_SEAL_SERVERS', 'BCA_SEAL_THRESHOLD', 'BCA_SEAL_PACKAGE_ID', 'BCA_WORKING_ROOT');
  }
}

async function arweaveChecks(): Promise<{ status: 'passed'; detail: unknown }> {
  setEnv({ BCA_ARWEAVE_GATEWAY: 'https://arweave.net', BCA_WORKING_ROOT: root });
  try {
    const { call } = harness();
    const status = await call('arweave_status');
    assert.equal(status.connectionVerified, true);
    // 主网真实 HTML 数据交易（12517 字节），元数据与数据均从配置网关读取。
    const transaction = await call('arweave_transaction', { id: 'bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U' });
    assert.equal(transaction.found, true);
    const data = await call('arweave_data', { id: transaction.id, maxBytes: 20_000 });
    assert.equal(data.bytes, Number(transaction.transaction.data_size));
    assert.equal(Buffer.from(data.data, 'base64').subarray(0, 3).toString('utf8'), '\n<!');
    return {
      status: 'passed',
      detail: {
        network: status.network.network,
        height: status.network.height,
        transaction: transaction.id,
        dataSize: data.bytes,
        status: transaction.status.status,
      },
    };
  } finally {
    clearEnv('BCA_ARWEAVE_GATEWAY', 'BCA_WORKING_ROOT');
  }
}

const runners: Record<Scope, () => Promise<{ status: 'passed' | 'skipped'; detail: unknown }>> = {
  eas: easChecks as () => Promise<{ status: 'passed' | 'skipped'; detail: unknown }>,
  sign: signChecks,
  sui: suiChecks,
  aptos: aptosChecks,
  sas: sasChecks,
  walrus: walrusChecks,
  seal: sealChecks,
  arweave: arweaveChecks,
};

await mkdir(resolve(root, '.work'), { recursive: true });
const work = await mkdtemp(resolve(root, '.work/chains-check-'));
console.log(JSON.stringify({ scopes: selected, work }));
try {
  for (const scope of selected as Scope[]) {
    try {
      const result = await runners[scope]();
      results.push({ scope, ...result });
      console.log(JSON.stringify({ scope, status: result.status, detail: result.detail }));
    } catch (error) {
      results.push({ scope, status: 'failed', detail: error instanceof Error ? error.message : String(error) });
      console.log(JSON.stringify({ scope, status: 'failed', error: error instanceof Error ? error.message : String(error) }));
      process.exitCode = 1;
    }
  }
} finally {
  await stopOwned();
  console.log(JSON.stringify({ results }));
}
