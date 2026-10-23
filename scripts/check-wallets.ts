import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { AgentRuntime } from '@elizaos/core';
import { Wallet } from 'ethers';
import { createElizaPlugin } from '../src/agents/eliza.js';
import { serializable } from '../src/providers/common.js';
import { walletAgentTools } from '../src/wallets/index.js';

const root = process.cwd();
const envBefore = { ...process.env };
const owned: ChildProcess[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  return address.port;
}

async function startAnvil(): Promise<{ rpc: string; child: ChildProcess; account: string; key: string }> {
  const port = await freePort();
  const key = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const child = spawn(process.env.ANVIL_BIN ?? 'anvil', ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  owned.push(child);
  await new Promise<void>((done, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Anvil 启动超时')), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Listening on')) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        done();
      }
    };
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Anvil 启动期间退出 ${code}`)); });
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
  });
  return { rpc: `http://127.0.0.1:${port}`, child, account, key };
}

const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);

try {
  const anvil = await startAnvil();
  Object.assign(process.env, {
    BCA_RPC_URL: anvil.rpc,
    BCA_CHAIN_ID: '31337',
    BCA_PRIVATE_KEY: anvil.key,
    BCA_X402_PRIVATE_KEY: Wallet.createRandom().privateKey,
    BCA_ALLOW_WRITES: 'true',
    BCA_TIMEOUT_MS: '30000',
    BCA_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
    BCA_SAFE_CHAIN_ID: '84532',
    BCA_SAFE_RPC_URL: 'https://sepolia.base.org',
    BCA_CCXT_EXCHANGE: 'kraken',
  });
  for (const key of ['BANKR_API_KEY', 'BCA_BANKR_API_KEY', 'BRIAN_API_KEY', 'BCA_BRIAN_API_KEY', 'HEURIST_API_KEY', 'BCA_HEURIST_API_KEY']) delete process.env[key];

  const tools = walletAgentTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.size, tools.length, '工具名不能重复');
  console.log(json({ scope: 'catalog', count: tools.length }));

  const call = async (name: string, input: unknown = {}) => {
    const tool = byName.get(name);
    assert(tool, `缺少工具 ${name}`);
    return tool.execute(input);
  };
  const optional = async (name: string, input: unknown = {}) => {
    try {
      const result = await call(name, input);
      console.log(json({ scope: 'optional', name, ok: true, result }));
      return result;
    } catch (error) {
      console.log(json({ scope: 'optional', name, ok: false, error: error instanceof Error ? error.message : String(error) }));
      return undefined;
    }
  };

  const wallet = await call('wallet_agentkit_wallet') as Record<string, any>;
  assert.equal(wallet.address, anvil.account);
  assert.equal(String(wallet.chainId), '31337');
  assert(BigInt(wallet.balanceWei) > 0n);
  console.log(json({ scope: 'agentkit', wallet: wallet.address, chainId: String(wallet.chainId), provider: wallet.provider }));

  const actions = await call('wallet_agentkit_actions') as { actions: Array<{ name: string }> };
  assert(actions.actions.some((action) => action.name.endsWith('get_wallet_details')));
  assert(actions.actions.some((action) => action.name.endsWith('native_transfer')));

  const transfer = await call('wallet_agentkit_transfer_local', {
    to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    valueWei: '1',
    submit: true,
  }) as Record<string, any>;
  assert.equal(transfer.receipt.status, 'success');
  assert.equal(transfer.localOnly, true);
  console.log(json({ scope: 'agentkit-transfer', hash: transfer.transactionHash, status: transfer.receipt.status }));

  const solana = await call('wallet_solana_balance') as Record<string, any>;
  assert.equal(solana.connectionVerified, true);
  assert.equal(typeof solana.address, 'string');
  assert(Number(solana.lamports) >= 0);
  console.log(json({ scope: 'solana', address: solana.address, lamports: solana.lamports, signerMode: solana.signerMode }));

  const tps = await call('wallet_solana_tps') as Record<string, any>;
  assert(Number(tps.tps) > 0);
  console.log(json({ scope: 'solana-tps', tps: tps.tps }));

  const solanaActions = await call('wallet_solana_actions') as { actions: Array<{ name: string }>; methods: string[] };
  assert(solanaActions.actions.some((action) => action.name === 'GET_TOKEN_DATA'));
  assert(solanaActions.methods.includes('get_balance'));
  const tokenAddress = await call('wallet_solana_token_address', { ticker: 'SOL' }) as Record<string, any>;
  assert.match(tokenAddress.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  console.log(json({ scope: 'solana-token-address', ticker: tokenAddress.ticker, address: tokenAddress.address }));
  await optional('wallet_solana_token_data', { mint: 'So11111111111111111111111111111111111111112' });

  const predicted = await call('wallet_safe_predict', {
    owners: [anvil.account],
    threshold: 1,
  }) as Record<string, any>;
  assert.equal(String(predicted.chainId), '84532');
  assert.equal(predicted.deployed, false);
  const signed = await call('wallet_safe_sign_transaction', {
    owners: [anvil.account],
    threshold: 1,
    to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    valueWei: '1',
    submit: true,
  }) as Record<string, any>;
  assert.match(signed.safeTxHash, /^0x[0-9a-f]{64}$/);
  assert.match(signed.signature, /^0x[0-9a-f]+$/);
  assert.equal(signed.executed, false);
  console.log(json({ scope: 'safe', safeAddress: predicted.safeAddress, safeTxHash: signed.safeTxHash }));

  await assert.rejects(call('wallet_safe_service'), /BCA_SAFE_API_KEY|BCA_SAFE_TX_SERVICE_URL/);

  const supported = await call('wallet_x402_supported') as { kinds: unknown[] };
  assert(Array.isArray(supported.kinds) && supported.kinds.length > 0);
  const payment = await call('wallet_x402_create_payment', {
    network: 'eip155:84532',
    amount: '1000',
    payTo: '0x0000000000000000000000000000000000000001',
    resourceUrl: 'https://example.com/bca-check',
    submit: true,
  }) as Record<string, any>;
  assert.match(payment.paymentPayload.payload.signature, /^0x[0-9a-f]+$/);
  assert.equal(payment.settled, false);
  console.log(json({ scope: 'x402', signer: payment.signer, asset: payment.paymentRequirements.asset, kinds: supported.kinds.length }));
  await optional('wallet_x402_verify', {
    paymentPayload: payment.paymentPayload,
    paymentRequirements: payment.paymentRequirements,
  });

  const catalog = await call('wallet_mesh_catalog') as Record<string, any>;
  assert(Number(catalog.count) > 0);
  const schema = await call('wallet_mesh_schema', { agentIds: ['TrendingTokenAgent'] }) as Record<string, any>;
  assert(schema.agents.TrendingTokenAgent.tools.length > 0);
  console.log(json({ scope: 'mesh', agents: catalog.count, lastUpdated: catalog.lastUpdated }));

  const ticker = await call('trading_ccxt_ticker', { symbol: 'BTC/USD', exchange: 'kraken' }) as Record<string, any>;
  assert(Number(ticker.ticker.last) > 0);
  console.log(json({ scope: 'ccxt', exchange: ticker.exchange, symbol: ticker.symbol, last: ticker.ticker.last }));

  await assert.rejects(call('wallet_bankr_wallet'), /BANKR_API_KEY/);
  await assert.rejects(call('wallet_brian_ask', { prompt: 'check' }), /BRIAN_API_KEY/);
  console.log(json({ scope: 'credentials', bankr: 'missing-key-fails', brian: 'missing-key-fails' }));

  const goat = await call('wallet_goat_status') as Record<string, any>;
  assert.equal(goat.integrated, false);
  assert.match(goat.readmeStatus, /Archived/);

  const plugin = createElizaPlugin(tools);
  const runtime = new AgentRuntime({
    character: { name: 'BCA Wallet Check', bio: ['check'], templates: {}, messageExamples: [], postExamples: [], topics: [], adjectives: [], knowledge: [], plugins: [], secrets: {} },
    logLevel: 'error',
  });
  await runtime.registerPlugin(plugin as never);
  assert.equal(runtime.actions.length, tools.length);
  const elizaAction = runtime.actions.find((action) => action.name === 'BCA_WALLET_GOAT_STATUS');
  assert(elizaAction);
  const elizaResult = await elizaAction.handler(runtime, {} as never, undefined, { parameters: {} });
  assert.equal(elizaResult.success, true);
  console.log(json({ scope: 'eliza', plugin: plugin.name, actions: runtime.actions.length }));

  await optional('trading_hummingbot_version');
  await optional('trading_hummingbot_status');

  console.log(json({ scope: 'done', tools: tools.length, anvil: anvil.rpc }));
} finally {
  for (const key of Object.keys(process.env)) if (key.startsWith('BCA_')) delete process.env[key];
  Object.assign(process.env, envBefore);
  for (const child of owned.reverse()) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
      console.log(json({ cleanup: 'stopped', pid: child.pid }));
    }
  }
}
