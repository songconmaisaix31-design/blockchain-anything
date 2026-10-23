import { Wallet } from 'ethers';
import { readConfig, type Config } from '../config.js';

export interface WalletConfig {
  base: Config;
  solanaRpcUrl?: string;
  solanaPrivateKey?: string;
  bankrApiKey?: string;
  bankrBaseUrl: string;
  brianApiKey?: string;
  brianApiUrl: string;
  heuristApiKey?: string;
  heuristApiUrl: string;
  heuristMetadataUrl: string;
  safeApiKey?: string;
  safeTxServiceUrl?: string;
  safeChainId?: bigint;
  safeRpcUrl?: string;
  x402FacilitatorUrl: string;
  x402PrivateKey?: string;
  ccxtExchange: string;
  hbotBin: string;
}

function optionalHttpUrl(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} 必须为 HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} 必须为 HTTP(S) URL`);
  return value.replace(/\/+$/, '');
}

function httpUrl(value: string | undefined, name: string, fallback: string): string {
  return optionalHttpUrl(value, name) ?? fallback;
}

function optionalChainId(value: string | undefined, name: string): bigint | undefined {
  if (!value) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} 必须为十进制正整数`);
  return BigInt(value);
}

function firstDefined(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => Boolean(value));
}

export function readWalletConfig(): WalletConfig {
  const env = process.env;
  if (env.BCA_X402_PRIVATE_KEY) {
    try { new Wallet(env.BCA_X402_PRIVATE_KEY); } catch { throw new Error('BCA_X402_PRIVATE_KEY 无效'); }
  }
  return {
    base: readConfig(),
    solanaRpcUrl: optionalHttpUrl(env.BCA_SOLANA_RPC_URL, 'BCA_SOLANA_RPC_URL'),
    solanaPrivateKey: firstDefined(env.BCA_SOLANA_PRIVATE_KEY, env.SOLANA_PRIVATE_KEY),
    bankrApiKey: firstDefined(env.BCA_BANKR_API_KEY, env.BANKR_API_KEY),
    bankrBaseUrl: httpUrl(env.BCA_BANKR_BASE_URL, 'BCA_BANKR_BASE_URL', 'https://api.bankr.bot'),
    brianApiKey: firstDefined(env.BCA_BRIAN_API_KEY, env.BRIAN_API_KEY),
    brianApiUrl: httpUrl(env.BCA_BRIAN_API_URL, 'BCA_BRIAN_API_URL', 'https://api.brianknows.org'),
    heuristApiKey: firstDefined(env.BCA_HEURIST_API_KEY, env.HEURIST_API_KEY),
    heuristApiUrl: httpUrl(env.BCA_HEURIST_API_URL, 'BCA_HEURIST_API_URL', 'https://mesh.heurist.xyz'),
    heuristMetadataUrl: httpUrl(env.BCA_HEURIST_METADATA_URL, 'BCA_HEURIST_METADATA_URL', 'https://mesh.heurist.ai'),
    safeApiKey: firstDefined(env.BCA_SAFE_API_KEY, env.SAFE_API_KEY),
    safeTxServiceUrl: optionalHttpUrl(env.BCA_SAFE_TX_SERVICE_URL, 'BCA_SAFE_TX_SERVICE_URL'),
    safeChainId: optionalChainId(env.BCA_SAFE_CHAIN_ID, 'BCA_SAFE_CHAIN_ID'),
    safeRpcUrl: optionalHttpUrl(env.BCA_SAFE_RPC_URL, 'BCA_SAFE_RPC_URL'),
    x402FacilitatorUrl: httpUrl(env.BCA_X402_FACILITATOR_URL, 'BCA_X402_FACILITATOR_URL', 'https://x402.org/facilitator'),
    x402PrivateKey: firstDefined(env.BCA_X402_PRIVATE_KEY, env.BCA_PRIVATE_KEY),
    ccxtExchange: env.BCA_CCXT_EXCHANGE || 'coinbase',
    hbotBin: env.BCA_HBOT_BIN || 'hbot',
  };
}

export function walletConfigurationStatus(config: WalletConfig) {
  const local = config.safeChainId ?? config.base.chainId;
  return {
    agentkit: {
      configured: Boolean(config.base.rpcUrl && config.base.chainId && config.base.privateKey),
      rpcConfigured: Boolean(config.base.rpcUrl),
      chainId: config.base.chainId?.toString() ?? null,
      signerConfigured: Boolean(config.base.privateKey),
    },
    solanaAgentKit: {
      rpcConfigured: Boolean(config.solanaRpcUrl),
      signerConfigured: Boolean(config.solanaPrivateKey),
      signerFallback: '未配置 BCA_SOLANA_PRIVATE_KEY 时仅使用进程内临时密钥执行只读操作',
    },
    bankr: { configured: Boolean(config.bankrApiKey), baseUrl: config.bankrBaseUrl },
    brian: { configured: Boolean(config.brianApiKey), baseUrl: config.brianApiUrl },
    heurist: { configured: Boolean(config.heuristApiKey), baseUrl: config.heuristApiUrl },
    safe: {
      apiConfigured: Boolean(config.safeApiKey || config.safeTxServiceUrl),
      txServiceUrl: config.safeTxServiceUrl ?? null,
      chainId: local?.toString() ?? null,
      protocolRpcConfigured: Boolean(config.safeRpcUrl ?? config.base.rpcUrl),
    },
    x402: { facilitatorUrl: config.x402FacilitatorUrl, signerConfigured: Boolean(config.x402PrivateKey) },
    ccxt: { exchange: config.ccxtExchange, credentialsUsed: false },
    hummingbot: { binary: config.hbotBin },
    goat: { integrated: false, reason: 'upstream archived; no new dependency' },
  };
}

export function secretValues(config: WalletConfig): string[] {
  return [
    config.base.privateKey,
    config.solanaPrivateKey,
    config.bankrApiKey,
    config.brianApiKey,
    config.heuristApiKey,
    config.safeApiKey,
    config.x402PrivateKey,
  ].filter((value): value is string => Boolean(value));
}

export function redactSecrets(message: string, config: WalletConfig): string {
  let result = message;
  for (const secret of secretValues(config).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result.replace(/https?:\/\/[^\s"'<>]+/g, '[ENDPOINT]');
}
