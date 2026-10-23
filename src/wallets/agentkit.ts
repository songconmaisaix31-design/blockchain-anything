import { z } from 'zod';
import { defineTool } from '../types.js';
import { addressSchema, submitSchema, uint256Schema } from '../providers/common.js';
import type { WalletConfig } from './config.js';

// AgentKit sends a non-awaited analytics beacon from its wallet-provider constructor and
// action decorator. A failed beacon becomes an unhandled rejection, so local use suppresses
// only that telemetry endpoint for the duration of each SDK call.
let agentKitQueue: Promise<unknown> = Promise.resolve();

function withAgentKit<T>(operation: () => Promise<T>): Promise<T> {
  const run = agentKitQueue.then(async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://cca-lite.coinbase.com/')) return new Response(null, { status: 204 });
      return original(input, init);
    };
    try {
      const result = await operation();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return result;
    } finally {
      globalThis.fetch = original;
    }
  });
  agentKitQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function providerFor(config: WalletConfig) {
  const { base } = config;
  if (!base.rpcUrl || !base.chainId || !base.privateKey) {
    throw new Error('AgentKit 需要 BCA_RPC_URL、BCA_CHAIN_ID 和 BCA_PRIVATE_KEY');
  }
  const chainId = Number(base.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('BCA_CHAIN_ID 超出 EVM chain ID 范围');
  const { ViemWalletProvider } = await import('@coinbase/agentkit');
  const { createWalletClient, defineChain, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const chain = defineChain({
    id: chainId,
    name: `bca-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [base.rpcUrl] } },
  });
  const account = privateKeyToAccount(base.privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(base.rpcUrl, { timeout: base.timeoutMs }),
  });
  // AgentKit carries its own viem version; the runtime object is compatible, the
  // cast only bridges the duplicated viem type identities.
  const compatibleClient = walletClient as unknown as ConstructorParameters<typeof ViemWalletProvider>[0];
  return new ViemWalletProvider(compatibleClient, { rpcUrl: base.rpcUrl, gasLimitMultiplier: 1.2 });
}

export function agentkitTools(config: WalletConfig) {
  return [
    defineTool(
      'wallet_agentkit_wallet',
      '通过 Coinbase AgentKit 的 ViemWalletProvider 读取配置账户地址、网络和原生币余额；连接实际 RPC 并核对 chain ID。',
      z.strictObject({}),
      true,
      async () => withAgentKit(async () => {
        const provider = await providerFor(config);
        const chainId = BigInt(await provider.getPublicClient().getChainId());
        if (config.base.chainId !== undefined && chainId !== config.base.chainId) {
          throw new Error(`chain ID 不匹配：预期 ${config.base.chainId}，实际 ${chainId}`);
        }
        return {
          sdk: '@coinbase/agentkit',
          provider: provider.getName(),
          address: provider.getAddress(),
          network: provider.getNetwork(),
          chainId,
          balanceWei: await provider.getBalance(),
          connectionVerified: true,
        };
      }),
    ),
    defineTool(
      'wallet_agentkit_actions',
      '列出当前 AgentKit 钱包网络可用的官方 action 名称和说明；不执行 action。',
      z.strictObject({}),
      true,
      async () => withAgentKit(async () => {
        const provider = await providerFor(config);
        const { AgentKit, walletActionProvider } = await import('@coinbase/agentkit');
        const kit = await AgentKit.from({ walletProvider: provider, actionProviders: [walletActionProvider()] });
        const actions = kit.getActions();
        return {
          network: provider.getNetwork(),
          actions: actions.map((action) => ({ name: action.name, description: action.description })),
        };
      }),
    ),
    defineTool(
      'wallet_agentkit_transfer_local',
      '仅在本地区块链（chain ID 1337 或 31337）通过 AgentKit 转账原生币并等待回执；禁止用于公共网络。',
      z.strictObject({
        to: addressSchema,
        valueWei: uint256Schema,
        submit: submitSchema,
      }),
      false,
      async ({ to, valueWei }) => {
        const { base } = config;
        if (!base.allowWrites) throw new Error('写入未开启：需要 BCA_ALLOW_WRITES=true');
        if (base.chainId !== 1337n && base.chainId !== 31337n) {
          throw new Error('wallet_agentkit_transfer_local 仅允许 chain ID 1337 或 31337 的本地链');
        }
        if (BigInt(valueWei) === 0n) throw new Error('valueWei 必须大于 0');
        return withAgentKit(async () => {
          const provider = await providerFor(config);
          const hash = await provider.nativeTransfer(to as `0x${string}`, valueWei);
          const receipt = await provider.waitForTransactionReceipt(hash);
          return {
            sdk: '@coinbase/agentkit',
            chainId: base.chainId,
            transactionHash: hash,
            from: provider.getAddress(),
            to,
            valueWei,
            receipt: {
              status: receipt.status,
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed,
            },
            localOnly: true,
          };
        });
      },
    ),
  ];
}
