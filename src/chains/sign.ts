import { createRequire } from 'node:module';
import { createPublicClient, http, parseAbi, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { readConfig, requireWrites } from '../config.js';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { submitSchema } from '../providers/common.js';
import { rpcFetchForEnvironment } from './http.js';

const sdk = createRequire(import.meta.url)('@ethsign/sp-sdk') as typeof import('@ethsign/sp-sdk');
const { SignProtocolClient, SpMode, chainInfo, delegateSignAttestation } = sdk;

const versionAbi = parseAbi(['function version() view returns (string)']);

function signContext(config: Config) {
  if (!config.rpcUrl || !config.chainId) throw new Error('需要 BCA_RPC_URL 和 BCA_CHAIN_ID');
  const entry = chainInfo.evm.find((item) => item.id === config.chainId!.toString());
  if (!entry) throw new Error(`Sign Protocol SDK 未提供 chain ID ${config.chainId} 的官方部署信息`);
  const fetchFn = rpcFetchForEnvironment();
  const publicClient = createPublicClient({
    transport: http(config.rpcUrl, { timeout: config.timeoutMs, retryCount: 0, ...(fetchFn ? { fetchFn } : {}) }),
  });
  return { entry, publicClient, fetchFn };
}

function onchainClient(config: Config, account?: ReturnType<typeof privateKeyToAccount>) {
  const { entry } = signContext(config);
  return new SignProtocolClient(SpMode.OnChain, {
    chain: entry.chain,
    rpcUrl: config.rpcUrl,
    ...(account ? { account } : {}),
  });
}

function contractAddress(config: Config): string {
  const inner = onchainClient(config).getClient() as unknown as { contractInfo?: { address?: string } };
  const address = inner.contractInfo?.address;
  if (!address) throw new Error('Sign Protocol SDK 未提供该网络的合约地址');
  return address;
}

const schemaId = z.string().min(1).describe('Sign Protocol Schema ID（十进制或 0x 十六进制）');

/** Sign Protocol 官方 SDK 适配：链上读取官方合约，链下委托签名使用 SDK 的合约哈希与账户签名。 */
export function signTools() {
  return [
    defineTool('sign_status', '核对配置网络的 chain ID、Sign Protocol 官方 SDK 部署地址、合约代码和版本。', z.strictObject({}), true,
      async () => {
        const config = readConfig();
        const { entry, publicClient } = signContext(config);
        const address = contractAddress(config);
        const code = await publicClient.getCode({ address: address as `0x${string}` });
        if (!code || code === '0x') throw new Error('Sign Protocol 合约地址没有代码');
        const version = await publicClient.readContract({
          address: address as `0x${string}`,
          abi: versionAbi,
          functionName: 'version',
        });
        return {
          chainId: config.chainId,
          chain: entry.chain,
          name: entry.name,
          address,
          version,
          contractCodeVerified: true,
          connectionVerified: true,
          deploymentSource: 'installed @ethsign/sp-sdk chainInfo',
        };
      }),

    defineTool('sign_schema_get', '通过 Sign Protocol 官方 SDK 从链上读取 Schema 并按官方数据模型解码。',
      z.strictObject({ schemaId }), true,
      async ({ schemaId: id }) => {
        const config = readConfig();
        const schema = await onchainClient(config).getSchema(id);
        return { chainId: config.chainId, schemaId: id, schema };
      }),

    defineTool('sign_attestation_get', '通过 Sign Protocol 官方 SDK 从链上读取声明及其 Schema 数据；不存在时 SDK 抛出明确错误。',
      z.strictObject({ attestationId: z.string().min(1).describe('Sign Protocol 声明 ID（十进制或 0x 十六进制）') }), true,
      async ({ attestationId }) => {
        const config = readConfig();
        const attestation = await onchainClient(config).getAttestation(attestationId);
        return { chainId: config.chainId, attestationId, attestation };
      }),

    defineTool('sign_delegated_sign_attestation', '使用官方 SDK 读取链上 getDelegatedAttestHash 并由本地开发账户签名；不广播交易。',
      z.strictObject({
        schemaId,
        data: z.record(z.string(), z.json()).describe('符合 Schema 字段的对象'),
        recipients: z.array(z.string()).optional(),
        validUntil: z.number().int().nonnegative().optional(),
        indexingValue: z.string().min(1),
        submit: submitSchema,
      }), false,
      async ({ schemaId: id, data, recipients, validUntil, indexingValue }) => {
        const config = readConfig();
        requireWrites(config);
        const account = privateKeyToAccount(config.privateKey as `0x${string}`);
        const { entry } = signContext(config);
        const result = await delegateSignAttestation({
          schemaId: id,
          data,
          indexingValue,
          ...(recipients ? { recipients } : {}),
          ...(validUntil !== undefined ? { validUntil } : {}),
        }, {
          chain: entry.chain,
          delegationAccount: account,
          rpcUrl: config.rpcUrl,
        });
        const inner = onchainClient(config, account).getClient() as unknown as {
          invokeContractRead(functionName: string, args?: unknown[]): Promise<string>;
        };
        const unsigned = { ...(result.attestation as Record<string, unknown>) };
        delete unsigned.indexingValue;
        const hash = await inner.invokeContractRead('getDelegatedAttestHash', [unsigned]);
        const signatureValid = await verifyMessage({
          address: account.address,
          message: { raw: hash as `0x${string}` },
          signature: result.delegationSignature,
        });
        return {
          chainId: config.chainId,
          attester: account.address,
          attestation: result.attestation,
          delegationSignature: result.delegationSignature,
          delegatedHash: hash,
          signatureValid,
          onchainSubmitted: false,
        };
      }),
  ];
}
