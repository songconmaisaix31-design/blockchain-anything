import { z } from 'zod';
import { defineTool } from '../types.js';
import type { WalletConfig } from './config.js';

interface SolanaTokenMethods {
  get_balance(agent: unknown): Promise<number>;
  getTPS(agent: unknown): Promise<number>;
  getTokenAddressFromTicker(ticker: string): Promise<string | null>;
  getTokenDataByAddress(mint: unknown): Promise<Record<string, unknown>>;
}

async function agentFor(config: WalletConfig) {
  if (!config.solanaRpcUrl) throw new Error('需要 BCA_SOLANA_RPC_URL');
  const { Keypair } = await import('@solana/web3.js');
  const bs58 = (await import('bs58')).default;
  const { SolanaAgentKit, KeypairWallet } = await import('solana-agent-kit');
  const TokenPlugin = (await import('@solana-agent-kit/plugin-token')).default;
  let keypair;
  let signerMode: 'configured' | 'ephemeral';
  if (config.solanaPrivateKey) {
    let secret: Uint8Array;
    if (config.solanaPrivateKey.trim().startsWith('[')) {
      const values = JSON.parse(config.solanaPrivateKey) as unknown;
      if (!Array.isArray(values) || !values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        throw new Error('BCA_SOLANA_PRIVATE_KEY 的 JSON 数组格式无效');
      }
      secret = Uint8Array.from(values as number[]);
    } else {
      secret = bs58.decode(config.solanaPrivateKey);
    }
    keypair = Keypair.fromSecretKey(secret);
    signerMode = 'configured';
  } else {
    keypair = Keypair.generate();
    signerMode = 'ephemeral';
  }
  const wallet = new KeypairWallet(keypair, config.solanaRpcUrl);
  const agent = new SolanaAgentKit(wallet, config.solanaRpcUrl, {}).use(TokenPlugin);
  return { agent, signerMode, address: keypair.publicKey.toBase58(), methods: agent.methods as unknown as SolanaTokenMethods };
}

export function solanaAgentKitTools(config: WalletConfig) {
  return [
    defineTool(
      'wallet_solana_status',
      '读取 Solana Agent Kit 的进程配置状态；不连接网络，不返回私钥或 RPC URL。',
      z.strictObject({}),
      true,
      async () => ({
        sdk: 'solana-agent-kit',
        configured: Boolean(config.solanaRpcUrl),
        rpcConfigured: Boolean(config.solanaRpcUrl),
        signerConfigured: Boolean(config.solanaPrivateKey),
        signerFallback: config.solanaPrivateKey ? null : 'ephemeral-process-keypair',
        loadedPlugin: '@solana-agent-kit/plugin-token',
      }),
    ),
    defineTool(
      'wallet_solana_balance',
      '通过 Solana Agent Kit 的 TokenPlugin 和真实 RPC 读取配置账户的 SOL 余额；未配置私钥时使用进程内临时只读账户。',
      z.strictObject({}),
      true,
      async () => {
        const { agent, methods, signerMode, address } = await agentFor(config);
        const uiAmount = await methods.get_balance(agent);
        const lamports = await agent.connection.getBalance(agent.wallet.publicKey);
        return {
          sdk: 'solana-agent-kit',
          plugin: '@solana-agent-kit/plugin-token',
          rpc: 'configured',
          address,
          signerMode,
          lamports,
          sol: uiAmount,
          connectionVerified: true,
        };
      },
    ),
    defineTool(
      'wallet_solana_tps',
      '通过 Solana Agent Kit TokenPlugin 和真实 RPC 读取最近性能样本计算的网络 TPS。',
      z.strictObject({}),
      true,
      async () => {
        const { agent, methods, signerMode } = await agentFor(config);
        const tps = await methods.getTPS(agent);
        return { sdk: 'solana-agent-kit', plugin: '@solana-agent-kit/plugin-token', signerMode, tps, connectionVerified: true };
      },
    ),
    defineTool(
      'wallet_solana_token_address',
      '通过 Solana Agent Kit TokenPlugin 的 Dexscreener 搜索按 ticker 查找 Solana 代币 mint 地址。',
      z.strictObject({ ticker: z.string().min(1).max(32) }),
      true,
      async ({ ticker }) => {
        const { methods } = await agentFor(config);
        const address = await methods.getTokenAddressFromTicker(ticker);
        if (!address) throw new Error(`Dexscreener 未找到 Solana ticker：${ticker}`);
        return { sdk: 'solana-agent-kit', plugin: '@solana-agent-kit/plugin-token', ticker, address };
      },
    ),
    defineTool(
      'wallet_solana_token_data',
      '通过 Solana Agent Kit 的 TokenPlugin 查询真实 Solana 代币的 Jupiter token 数据；上游 tokens.jup.ag 不可达时如实失败。',
      z.strictObject({ mint: z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, '必须为 base58 Solana 地址') }),
      true,
      async ({ mint }) => {
        const { agent, methods, signerMode } = await agentFor(config);
        const { PublicKey } = await import('@solana/web3.js');
        const data = await methods.getTokenDataByAddress(new PublicKey(mint));
        return { sdk: 'solana-agent-kit', plugin: '@solana-agent-kit/plugin-token', signerMode, mint, data };
      },
    ),
    defineTool(
      'wallet_solana_actions',
      '列出 Solana Agent Kit TokenPlugin 注册的真实 action 和 method 名称。',
      z.strictObject({}),
      true,
      async () => {
        const { agent } = await agentFor(config);
        return {
          sdk: 'solana-agent-kit',
          plugin: '@solana-agent-kit/plugin-token',
          actions: agent.actions.map((action) => ({ name: action.name, description: action.description, similes: action.similes })),
          methods: Object.keys(agent.methods as Record<string, unknown>).sort(),
        };
      },
    ),
  ];
}
