import { getAddress, Wallet } from 'ethers';

export interface Config {
  issues?: Partial<Record<'evm' | 'signer' | 'eas' | 'ipfs' | 'explorer' | 'bundler' | 'simulator', string[]>>;
  rpcUrl?: string;
  chainId?: bigint;
  easAddress?: string;
  registryAddress?: string;
  privateKey?: string;
  allowWrites: boolean;
  workingRoot: string;
  ipfsUrl?: string;
  etherscanApiKey?: string;
  bundlerUrl?: string;
  tenderly?: { account: string; project: string; accessKey: string };
  maxFileBytes: number;
  maxReadBytes: number;
  timeoutMs: number;
}

function endpoint(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} 必须为 HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} 必须为 HTTP(S) URL`);
  return value;
}

function address(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  try { return getAddress(value); } catch { throw new Error(`${name} 必须为 EVM 地址`); }
}

function positiveInteger(value: string | undefined, name: string, defaultValue: number): number {
  if (!value) return defaultValue;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} 必须为正的安全整数`);
  }
  return Number(value);
}

export function readConfig(): Config {
  const env = process.env;
  if (env.BCA_ALLOW_WRITES && !['true', 'false'].includes(env.BCA_ALLOW_WRITES)) {
    throw new Error('BCA_ALLOW_WRITES 必须为 true 或 false');
  }
  const issues: NonNullable<Config['issues']> = {};
  function vendor<T>(group: keyof typeof issues, check: () => T): T | undefined {
    try { return check(); } catch (error) {
      (issues[group] ??= []).push(error instanceof Error ? error.message : '供应商配置无效');
      return undefined;
    }
  }
  const chainId = vendor('evm', () => {
    if (!env.BCA_CHAIN_ID) return undefined;
    if (!/^[1-9][0-9]*$/.test(env.BCA_CHAIN_ID)) throw new Error('BCA_CHAIN_ID 必须为十进制正整数');
    return BigInt(env.BCA_CHAIN_ID);
  });
  vendor('signer', () => {
    if (env.BCA_PRIVATE_KEY) {
      try { new Wallet(env.BCA_PRIVATE_KEY); } catch { throw new Error('BCA_PRIVATE_KEY 无效'); }
    }
  });
  return {
    issues,
    rpcUrl: vendor('evm', () => endpoint(env.BCA_RPC_URL, 'BCA_RPC_URL')),
    chainId,
    easAddress: vendor('eas', () => address(env.BCA_EAS_ADDRESS, 'BCA_EAS_ADDRESS')),
    registryAddress: vendor('eas', () => address(env.BCA_SCHEMA_REGISTRY_ADDRESS, 'BCA_SCHEMA_REGISTRY_ADDRESS')),
    privateKey: env.BCA_PRIVATE_KEY || undefined,
    allowWrites: env.BCA_ALLOW_WRITES === 'true',
    workingRoot: env.BCA_WORKING_ROOT || process.cwd(),
    ipfsUrl: vendor('ipfs', () => endpoint(env.BCA_IPFS_URL, 'BCA_IPFS_URL')),
    etherscanApiKey: env.BCA_ETHERSCAN_API_KEY || undefined,
    bundlerUrl: vendor('bundler', () => endpoint(env.BCA_BUNDLER_URL, 'BCA_BUNDLER_URL')),
    // Tenderly 需要三个变量同时存在，缺一个就报配置错误，避免只配一半时静默失败。
    tenderly: vendor('simulator', () => {
      const account = env.BCA_TENDERLY_ACCOUNT;
      const project = env.BCA_TENDERLY_PROJECT;
      const accessKey = env.BCA_TENDERLY_ACCESS_KEY;
      if (!account && !project && !accessKey) return undefined;
      if (!account || !project || !accessKey) {
        throw new Error('Tenderly 需要同时设置 BCA_TENDERLY_ACCOUNT、BCA_TENDERLY_PROJECT、BCA_TENDERLY_ACCESS_KEY');
      }
      return { account, project, accessKey };
    }),
    maxFileBytes: positiveInteger(env.BCA_MAX_FILE_BYTES, 'BCA_MAX_FILE_BYTES', 16 * 1024 * 1024),
    maxReadBytes: positiveInteger(env.BCA_MAX_READ_BYTES, 'BCA_MAX_READ_BYTES', 1024 * 1024),
    timeoutMs: positiveInteger(env.BCA_TIMEOUT_MS, 'BCA_TIMEOUT_MS', 30_000),
  };
}

export function requireWrites(config: Config, signer = true): void {
  if (signer) assertConfiguration(config, 'signer');
  if (!config.allowWrites) throw new Error('写入未开启：需要 BCA_ALLOW_WRITES=true');
  if (signer && !config.privateKey) throw new Error('签署需要 BCA_PRIVATE_KEY（仅限本地开发）');
}

export function assertConfiguration(config: Config, group: keyof NonNullable<Config['issues']>): void {
  const issues = config.issues?.[group];
  if (issues?.length) throw new Error(`配置错误 (${group})：${issues.join('；')}`);
}

export function configurationStatus(config: Config) {
  const evm = Boolean(config.rpcUrl && config.chainId);
  const eas = evm && Boolean(config.easAddress && config.registryAddress);
  return {
    configurationErrors: config.issues ?? {},
    evm: { configured: evm, rpcConfigured: Boolean(config.rpcUrl), expectedChainId: config.chainId?.toString() ?? null },
    eas: { configured: eas, address: config.easAddress ?? null, schemaRegistry: config.registryAddress ?? null },
    signer: { configured: Boolean(config.privateKey), mode: config.privateKey ? 'local-development-environment' : null },
    writes: { enabled: config.allowWrites, easAvailable: eas && config.allowWrites && Boolean(config.privateKey), ipfsAvailable: Boolean(config.ipfsUrl) && config.allowWrites },
    content: { configured: true, workingRoot: config.workingRoot, maxFileBytes: config.maxFileBytes },
    ipfs: { configured: Boolean(config.ipfsUrl), maxReadBytes: config.maxReadBytes },
    connectionVerified: false,
    verification: '状态仅表示配置；evm_chain、eas_status、ipfs_status 执行实际连接检查',
  };
}
