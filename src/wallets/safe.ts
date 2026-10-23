import { z } from 'zod';
import { defineTool } from '../types.js';
import { addressSchema, submitSchema, uint256Schema } from '../providers/common.js';
import type { WalletConfig } from './config.js';

interface SafeTransactionLike {
  data: {
    nonce: number;
    to: string;
    value: string | number;
    data: string;
    operation: number;
    safeTxGas: string | number;
    baseGas: string | number;
    gasPrice: string | number;
    gasToken: string;
    refundReceiver: string;
  };
  signatures: Map<string, { data: string }>;
  getSignature(signer: string): { data: string } | undefined;
}

interface SafeInstance {
  getAddress(): Promise<string>;
  getChainId(): Promise<bigint>;
  isSafeDeployed(): Promise<boolean>;
  getOwners(): Promise<string[]>;
  createTransaction(input: { transactions: Array<{ to: string; value: string; data: string }> }): Promise<SafeTransactionLike>;
  signTransaction(transaction: SafeTransactionLike): Promise<SafeTransactionLike>;
  getTransactionHash(transaction: SafeTransactionLike): Promise<string>;
}

interface SafeConstructor {
  init(config: unknown): Promise<SafeInstance>;
}

interface SafeApiKitInstance {
  getServiceInfo(): Promise<unknown>;
  getSafeInfo(safeAddress: string): Promise<unknown>;
}

interface SafeApiKitConstructor {
  new (config: { chainId: bigint; apiKey?: string; txServiceUrl?: string }): SafeApiKitInstance;
}

async function protocolKitSdk(): Promise<SafeConstructor> {
  const module = await import('@safe-global/protocol-kit');
  return module.default as unknown as SafeConstructor;
}

async function apiKitSdk(): Promise<SafeApiKitConstructor> {
  const module = await import('@safe-global/api-kit');
  return module.default as unknown as SafeApiKitConstructor;
}

function protocolRpc(config: WalletConfig): string {
  const rpc = config.safeRpcUrl ?? config.base.rpcUrl;
  if (!rpc) throw new Error('Safe Protocol Kit 需要 BCA_SAFE_RPC_URL 或 BCA_RPC_URL');
  return rpc;
}

function safeChainId(config: WalletConfig): bigint {
  const chainId = config.safeChainId ?? config.base.chainId;
  if (!chainId) throw new Error('Safe 需要 BCA_SAFE_CHAIN_ID 或 BCA_CHAIN_ID');
  return chainId;
}

async function apiKit(config: WalletConfig): Promise<SafeApiKitInstance> {
  if (!config.safeApiKey && !config.safeTxServiceUrl) {
    throw new Error('Safe Transaction Service 需要 BCA_SAFE_API_KEY 或 BCA_SAFE_TX_SERVICE_URL');
  }
  const Constructor = await apiKitSdk();
  return new Constructor({
    chainId: safeChainId(config),
    apiKey: config.safeApiKey,
    txServiceUrl: config.safeTxServiceUrl,
  });
}

export function safeTools(config: WalletConfig) {
  const chainId = config.safeChainId ?? config.base.chainId;
  return [
    defineTool(
      'wallet_safe_status',
      '读取 Safe Protocol Kit 与 Safe Transaction Service 的进程配置状态；不连接网络，不返回秘密。',
      z.strictObject({}),
      true,
      async () => ({
        sdk: '@safe-global/protocol-kit',
        apiKit: '@safe-global/api-kit',
        chainId: chainId?.toString() ?? null,
        protocolRpcConfigured: Boolean(config.safeRpcUrl ?? config.base.rpcUrl),
        transactionServiceConfigured: Boolean(config.safeApiKey || config.safeTxServiceUrl),
        signerConfigured: Boolean(config.base.privateKey),
      }),
    ),
    defineTool(
      'wallet_safe_service',
      '通过 SafeApiKit 读取配置的 Safe Transaction Service 信息，验证真实服务连接。',
      z.strictObject({}),
      true,
      async () => ({ chainId: safeChainId(config).toString(), service: await (await apiKit(config)).getServiceInfo() }),
    ),
    defineTool(
      'wallet_safe_info',
      '通过 SafeApiKit 读取真实 Safe 账户的 nonce、owner、threshold 和模块信息。',
      z.strictObject({ safeAddress: addressSchema }),
      true,
      async ({ safeAddress }) => ({ chainId: safeChainId(config).toString(), safeAddress, info: await (await apiKit(config)).getSafeInfo(safeAddress) }),
    ),
    defineTool(
      'wallet_safe_predict',
      '使用 Safe Protocol Kit 按官方确定性部署规则预测 Safe 地址，并读取该地址在 RPC 上的实际部署状态。',
      z.strictObject({
        owners: z.array(addressSchema).min(1),
        threshold: z.number().int().positive(),
        saltNonce: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
        safeVersion: z.enum(['1.3.0', '1.4.1']).optional(),
      }),
      true,
      async ({ owners, threshold, saltNonce, safeVersion }) => {
        if (threshold > owners.length) throw new Error('threshold 不能大于 owner 数量');
        const Safe = await protocolKitSdk();
        const protocolKit = await Safe.init({
          provider: protocolRpc(config),
          predictedSafe: {
            safeAccountConfig: { owners, threshold },
            safeDeploymentConfig: { saltNonce, safeVersion },
          },
        });
        const address = await protocolKit.getAddress();
        return {
          safeAddress: address,
          chainId: (await protocolKit.getChainId()).toString(),
          deployed: await protocolKit.isSafeDeployed(),
          owners,
          threshold,
          saltNonce: saltNonce ?? '0',
          safeVersion: safeVersion ?? 'default',
        };
      },
    ),
    defineTool(
      'wallet_safe_sign_transaction',
      '使用 Safe Protocol Kit 创建 Safe 交易并只用配置账户在本地签名；不广播、不执行，返回 safeTxHash 与签名。',
      z.strictObject({
        safeAddress: addressSchema.optional(),
        owners: z.array(addressSchema).min(1).optional(),
        threshold: z.number().int().positive().optional(),
        saltNonce: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
        to: addressSchema,
        valueWei: uint256Schema,
        data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).optional(),
        submit: submitSchema,
      }).refine((input) => Boolean(input.safeAddress) !== Boolean(input.owners), 'safeAddress 与 owners 必须且只能提供一个')
        .refine((input) => !input.owners || input.threshold !== undefined, '使用 owners 时必须提供 threshold'),
      false,
      async ({ safeAddress, owners, threshold, saltNonce, to, valueWei, data }) => {
        if (!config.base.allowWrites) throw new Error('签名未开启：需要 BCA_ALLOW_WRITES=true');
        if (!config.base.privateKey) throw new Error('Safe 签名需要 BCA_PRIVATE_KEY');
        const { Wallet } = await import('ethers');
        const signer = new Wallet(config.base.privateKey);
        const Safe = await protocolKitSdk();
        const base = { provider: protocolRpc(config), signer: config.base.privateKey };
        const protocolKit = safeAddress
          ? await Safe.init({ ...base, safeAddress })
          : await Safe.init({
              ...base,
              predictedSafe: {
                safeAccountConfig: { owners: owners as string[], threshold: threshold as number },
                safeDeploymentConfig: { saltNonce },
              },
            });
        const address = await protocolKit.getAddress();
        const deployed = await protocolKit.isSafeDeployed();
        const actualChainId = await protocolKit.getChainId();
        if (safeChainId(config) !== actualChainId) throw new Error(`chain ID 不匹配：预期 ${safeChainId(config)}，实际 ${actualChainId}`);
        if (deployed) {
          const safeOwners = await protocolKit.getOwners();
          if (!safeOwners.some((owner) => owner.toLowerCase() === signer.address.toLowerCase())) {
            throw new Error('配置账户不是该 Safe 的 owner，无法产生有效签名');
          }
        }
        const transaction = await protocolKit.createTransaction({
          transactions: [{ to, value: valueWei, data: data ?? '0x' }],
        });
        const signed = await protocolKit.signTransaction(transaction);
        const signature = signed.getSignature(signer.address)
          ?? [...signed.signatures.entries()].find(([owner]) => owner.toLowerCase() === signer.address.toLowerCase())?.[1];
        if (!signature) throw new Error('Safe SDK 未返回配置账户的签名');
        return {
          sdk: '@safe-global/protocol-kit',
          safeAddress: address,
          deployed,
          chainId: actualChainId.toString(),
          nonce: signed.data.nonce,
          safeTxHash: await protocolKit.getTransactionHash(signed),
          signature: signature.data,
          signer: signer.address,
          transaction: {
            to: signed.data.to,
            value: signed.data.value,
            data: signed.data.data,
            operation: signed.data.operation,
            safeTxGas: signed.data.safeTxGas,
            baseGas: signed.data.baseGas,
            gasPrice: signed.data.gasPrice,
            gasToken: signed.data.gasToken,
            refundReceiver: signed.data.refundReceiver,
          },
          executed: false,
        };
      },
    ),
  ];
}
