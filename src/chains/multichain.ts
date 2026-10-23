import { createRequire } from 'node:module';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireWrites } from '../config.js';
import { defineTool } from '../types.js';
import { submitSchema } from '../providers/common.js';
import { endpointEnv } from '../providers/http.js';

const id = z.string().min(1).max(256);
const jsonObject = z.record(z.string(), z.json());

export async function suiClient(config: Config) {
  const { SuiGrpcClient } = await import('@mysten/sui/grpc');
  const network = z.enum(['mainnet', 'testnet', 'devnet', 'localnet']).parse(process.env.BCA_SUI_NETWORK || 'testnet');
  return new SuiGrpcClient({ network, baseUrl: endpointEnv('BCA_SUI_RPC_URL'),
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs) }),
  });
}

async function aptosClient(config: Config) {
  const { Aptos, AptosConfig, Network } = await import('@aptos-labs/ts-sdk');
  return new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: endpointEnv('BCA_APTOS_RPC_URL'),
    clientConfig: { http2: false } }));
}

async function signClient(config: Config, write = false) {
  const { SignProtocolClient, SpMode, EvmChains } = createRequire(import.meta.url)('@ethsign/sp-sdk') as typeof import('@ethsign/sp-sdk');
  const chain = process.env.BCA_SIGN_CHAIN;
  if (!chain || !Object.values(EvmChains).includes(chain as typeof EvmChains[keyof typeof EvmChains])) throw new Error('BCA_SIGN_CHAIN 必须为官方 EvmChains 的值，例如 baseSepolia');
  // Ensure this provider cannot accidentally sign on a different configured chain.
  const { createPublicClient, http } = await import('viem');
  const rpcUrl = endpointEnv('BCA_RPC_URL');
  const actual = await createPublicClient({ transport: http(rpcUrl, { timeout: config.timeoutMs, retryCount: 0 }) }).getChainId();
  if (!config.chainId || BigInt(actual) !== config.chainId) throw new Error('Sign Protocol RPC 与 BCA_CHAIN_ID 不匹配');
  const chains = await import('viem/chains');
  const expected = (chains as Record<string, { id?: number }>)[chain]?.id;
  if (expected === undefined || expected !== actual) throw new Error('BCA_SIGN_CHAIN 与 RPC 网络不匹配或当前 viem 不支持该名称');
  if (write) requireWrites(config);
  const account = write ? (await import('viem/accounts')).privateKeyToAccount(config.privateKey as `0x${string}`) : undefined;
  return new SignProtocolClient(SpMode.OnChain, { chain: chain as typeof EvmChains[keyof typeof EvmChains], rpcUrl, account });
}

export function multichainTools(config: Config) {
  return [
    defineTool('sui_balance', '官方 Sui gRPC SDK 查询余额。', z.strictObject({ owner: id, coinType: id.optional() }), true,
      async (input) => (await suiClient(config)).getBalance(input)),
    defineTool('sui_object', '官方 Sui SDK 读取对象和内容。', z.strictObject({ objectId: id }), true,
      async ({ objectId }) => (await suiClient(config)).getObject({ objectId, include: { content: true } })),
    defineTool('sui_transaction', '官方 Sui SDK 查询交易及 effects。', z.strictObject({ digest: id }), true,
      async ({ digest }) => (await suiClient(config)).getTransaction({ digest, include: { effects: true } })),
    defineTool('sui_transaction_inspect', '用官方 Transaction 解析已序列化交易；离线、不签名。', z.strictObject({ serialized: z.string().min(1).max(1_000_000) }), true,
      async ({ serialized }) => (await import('@mysten/sui/transactions')).Transaction.from(serialized).getData()),
    defineTool('aptos_ledger', '官方 Aptos SDK 查询账本信息。', z.strictObject({}), true,
      async () => (await aptosClient(config)).getLedgerInfo()),
    defineTool('aptos_account', '官方 Aptos SDK 查询账户与资源，最多 100 条。', z.strictObject({ address: id, resources: z.boolean().default(false) }), true,
      async ({ address, resources }) => {
        const client = await aptosClient(config);
        return resources ? client.getAccountResources({ accountAddress: address, options: { limit: 100 } }) : client.getAccountInfo({ accountAddress: address });
      }),
    defineTool('aptos_view', '官方 Aptos SDK 调用只读 Move view，支持标量参数。', z.strictObject({ function: z.string().regex(/^0x[0-9a-fA-F]+::\w+::\w+$/), typeArguments: z.array(z.string()).default([]), arguments: z.array(z.union([z.string(), z.number().int().safe(), z.boolean()])).default([]) }), true,
      async (input) => (await aptosClient(config)).view({ payload: { function: input.function as `${string}::${string}::${string}`, typeArguments: input.typeArguments, functionArguments: input.arguments } })),
    defineTool('solana_balance', '官方 Solana Kit 查询 lamports。', z.strictObject({ address: id }), true,
      async ({ address: value }) => {
        const { createSolanaRpc, address } = await import('@solana/kit');
        return createSolanaRpc(endpointEnv('BCA_SOLANA_RPC_URL')).getBalance(address(value)).send({ abortSignal: AbortSignal.timeout(config.timeoutMs) });
      }),
    defineTool('sas_attestation', '官方 sas-lib 读取原生声明并检查程序所有者；不将存在性等同于可信。', z.strictObject({ address: id }), true,
      async ({ address: value }) => {
        const { createSolanaRpc, address } = await import('@solana/kit');
        const sas = await import('sas-lib');
        const account = await sas.fetchAttestation(createSolanaRpc(endpointEnv('BCA_SOLANA_RPC_URL')), address(value), { abortSignal: AbortSignal.timeout(config.timeoutMs) });
        if (account.programAddress !== sas.SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS) throw new Error('SAS 账户所有者不匹配');
        return { ...account, data: { ...account.data, data: Buffer.from(account.data.data).toString('base64') }, verification: '仅解码及程序所有者检查；调用方须核对 credential、schema、signer 和链上 expiry' };
      }),
    defineTool('sas_schema', '官方 sas-lib 读取 Schema。', z.strictObject({ address: id }), true,
      async ({ address: value }) => {
        const { createSolanaRpc, address } = await import('@solana/kit');
        const sas = await import('sas-lib');
        const account = await sas.fetchSchema(createSolanaRpc(endpointEnv('BCA_SOLANA_RPC_URL')), address(value), { abortSignal: AbortSignal.timeout(config.timeoutMs) });
        if (account.programAddress !== sas.SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS) throw new Error('SAS 账户所有者不匹配');
        return account;
      }),
    defineTool('sign_schema', '官方 Sign Protocol SDK 查询 EVM Schema。', z.strictObject({ schemaId: id }), true,
      async ({ schemaId }) => (await signClient(config)).getSchema(schemaId)),
    defineTool('sign_attestation', '官方 Sign Protocol SDK 查询原生声明。', z.strictObject({ attestationId: id }), true,
      async ({ attestationId }) => (await signClient(config)).getAttestation(attestationId)),
    defineTool('sign_attest', '官方 Sign Protocol SDK 创建链上声明；需配置开发签署账户。', z.strictObject({ schemaId: id, data: jsonObject, indexingValue: z.string(), recipients: z.array(z.string()).optional(), submit: submitSchema }), false,
      async ({ submit: _, ...input }) => (await signClient(config, true)).createAttestation(input)),
    defineTool('sign_revoke', '官方 Sign Protocol SDK 撤销声明。', z.strictObject({ attestationId: id, reason: z.string().optional(), submit: submitSchema }), false,
      async ({ attestationId, reason }) => (await signClient(config, true)).revokeAttestation(attestationId, { reason })),
  ];
}
