import { EncryptedObject, SealClient } from '@mysten/seal';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { z } from 'zod';
import { defineTool } from '../types.js';
import { httpUrl, jsonArray, oneOf, optionalEnv, positiveInteger, timeoutMs } from '../chains/env.js';

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
const networks = ['mainnet', 'testnet', 'devnet', 'localnet'] as const;

interface ServerConfig {
  objectId: string;
  weight: number;
  aggregatorUrl?: string;
}

let cached: { key: string; client: SealClient } | undefined;

function serverConfigs(): ServerConfig[] {
  const entries = jsonArray('BCA_SEAL_SERVERS');
  if (entries.length === 0) throw new Error('BCA_SEAL_SERVERS 不能为空');
  return entries.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`BCA_SEAL_SERVERS[${index}] 必须为对象`);
    }
    const record = entry as Record<string, unknown>;
    const objectId = record.objectId;
    if (typeof objectId !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(objectId)) {
      throw new Error(`BCA_SEAL_SERVERS[${index}].objectId 必须为 Sui 对象 ID`);
    }
    const weight = record.weight ?? 1;
    if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1) {
      throw new Error(`BCA_SEAL_SERVERS[${index}].weight 必须为正整数`);
    }
    const aggregatorUrl = record.aggregatorUrl;
    if (aggregatorUrl !== undefined) {
      if (typeof aggregatorUrl !== 'string') throw new Error(`BCA_SEAL_SERVERS[${index}].aggregatorUrl 必须为 URL`);
      try {
        const url = new URL(aggregatorUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
      } catch {
        throw new Error(`BCA_SEAL_SERVERS[${index}].aggregatorUrl 必须为 HTTP(S) URL`);
      }
    }
    return { objectId, weight, ...(typeof aggregatorUrl === 'string' ? { aggregatorUrl } : {}) };
  });
}

function sealClient(): SealClient {
  const network = oneOf<SuiNetwork>('BCA_SUI_NETWORK', networks);
  const baseUrl = httpUrl('BCA_SUI_RPC_URL', true);
  const servers = serverConfigs();
  const verify = optionalEnv('BCA_SEAL_VERIFY_KEY_SERVERS');
  if (verify !== undefined && !['true', 'false'].includes(verify)) {
    throw new Error('BCA_SEAL_VERIFY_KEY_SERVERS 必须为 true 或 false');
  }
  const key = JSON.stringify({ network, baseUrl, servers, verify });
  if (cached?.key === key) return cached.client;
  const client = new SealClient({
    suiClient: new SuiGrpcClient({ network, baseUrl }),
    serverConfigs: servers,
    verifyKeyServers: verify === 'true',
    timeout: timeoutMs(),
  });
  cached = { key, client };
  return client;
}

function encryptedMetadata(bytes: Uint8Array) {
  const parsed = EncryptedObject.parse(bytes);
  return {
    packageId: parsed.packageId,
    id: parsed.id,
    threshold: parsed.threshold,
    services: parsed.services,
    bytes: bytes.byteLength,
    encoding: 'base64',
    data: Buffer.from(bytes).toString('base64'),
  };
}

/** Seal 官方 TypeScript SDK 工具。只实现密钥服务器查询、加密和密文解析；解密需要应用自己的 Move 策略包与钱包签名会话。 */
export function sealTools() {
  return [
    defineTool('seal_status', '读取配置的 Seal 密钥服务器链上对象（官方 SDK 查询），不请求解密密钥。', z.strictObject({}), true,
      async () => {
        const client = sealClient();
        const servers = await client.getKeyServers();
        return {
          network: process.env.BCA_SUI_NETWORK,
          connectionVerified: true,
          verifyKeyServers: process.env.BCA_SEAL_VERIFY_KEY_SERVERS === 'true',
          servers: Array.from(servers.values()).map((server) => ({
            objectId: server.objectId,
            name: server.name,
            url: server.url,
            serverType: server.serverType,
            publicKeyBytes: server.pk.byteLength,
          })),
        };
      }),

    defineTool('seal_encrypt', '使用官方 Seal SDK 和配置的链上密钥服务器加密数据；返回密文，不返回对称密钥。',
      z.strictObject({
        packageId: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, '必须为 Sui 包 ID').optional(),
        id: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/, '必须为十六进制身份').describe('策略命名空间内的身份（hex）'),
        threshold: z.number().int().positive().optional(),
        data: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, '必须为 base64').describe('待加密数据'),
      }), false,
      async ({ packageId, id, threshold, data }) => {
        const namespace = packageId ?? optionalEnv('BCA_SEAL_PACKAGE_ID');
        if (!namespace) throw new Error('需要 packageId 或 BCA_SEAL_PACKAGE_ID');
        const value = threshold ?? positiveInteger('BCA_SEAL_THRESHOLD', 1);
        const plaintext = Buffer.from(data, 'base64');
        if (plaintext.byteLength === 0) throw new Error('data 不能为空');
        const encrypted = await sealClient().encrypt({
          threshold: value,
          packageId: namespace,
          id,
          data: new Uint8Array(plaintext),
        });
        return { ...encryptedMetadata(encrypted.encryptedObject), keyReturned: false };
      }),

    defineTool('seal_parse', '使用官方 Seal SDK 解析密文元数据；不访问网络，不执行解密。',
      z.strictObject({ data: z.string().min(1).describe('base64 密文') }), true,
      async ({ data }) => encryptedMetadata(new Uint8Array(Buffer.from(data, 'base64')))),
  ];
}
