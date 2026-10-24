import { z } from 'zod';
import type { Config } from '../config.js';
import { requireWrites } from '../config.js';
import { defineTool } from '../types.js';
import { submitSchema } from '../providers/common.js';
import { readWorkingFile } from '../providers/files.js';
import { endpointEnv, requestBytes, requestJson } from '../providers/http.js';
import { suiClient } from '../chains/multichain.js';

const nativeId = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

async function sealClient(config: Config) {
  const { SealClient } = await import('@mysten/seal');
  const raw = process.env.BCA_SEAL_SERVERS;
  if (!raw) throw new Error('需要 BCA_SEAL_SERVERS：官方 key server 配置 JSON 数组');
  const serverConfigs = z.array(z.strictObject({ objectId: z.string().regex(/^0x[0-9a-fA-F]{64}$/), weight: z.number().int().min(1).max(255), aggregatorUrl: z.url().optional() })).min(1).max(32).parse(JSON.parse(raw));
  return new SealClient({ suiClient: await suiClient(config), serverConfigs, verifyKeyServers: true, timeout: config.timeoutMs });
}

async function arweaveClient(config: Config) {
  const { default: Arweave } = await import('arweave');
  const url = new URL(endpointEnv('BCA_ARWEAVE_URL', 'https://arweave.net'));
  if (url.pathname !== '/' || url.search) throw new Error('BCA_ARWEAVE_URL 必须为网关根地址');
  return Arweave.init({ host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), protocol: url.protocol.slice(0, -1), timeout: config.timeoutMs, logging: false });
}

export function storageTools(config: Config) {
  return [
    defineTool('walrus_read', '通过官方 Walrus aggregator HTTP API 读取 blob；返回 base64。', z.strictObject({ blobId: nativeId }), true,
      async ({ blobId }) => {
        const { bytes } = await requestBytes(config, `${endpointEnv('BCA_WALRUS_AGGREGATOR')}/v1/blobs/${blobId}`);
        return { blobId, bytes: bytes.length, dataBase64: bytes.toString('base64') };
      }),
    defineTool('walrus_store', '通过官方 publisher HTTP API 上传文件，保留原生 blobId/objectId；可能消耗配置服务的存储额度。', z.strictObject({ path: z.string().min(1), epochs: z.number().int().min(1).max(53), submit: submitSchema }), false,
      async ({ path, epochs }) => {
        requireWrites(config, false);
        const bytes = await readWorkingFile(config, path);
        return requestJson(config, `${endpointEnv('BCA_WALRUS_PUBLISHER')}/v1/blobs?epochs=${epochs}`, { method: 'PUT', body: new Uint8Array(bytes), headers: { 'Content-Type': 'application/octet-stream' } });
      }),
    defineTool('seal_encrypt', '官方 Seal SDK 加密工作区文件；仅返回密文，不返回对称密钥。', z.strictObject({ path: z.string().min(1), packageId: z.string().regex(/^0x[0-9a-fA-F]{64}$/), id: z.string().regex(/^(?:0x)?(?:[0-9a-fA-F]{2})+$/), threshold: z.number().int().min(1).max(255) }), true,
      async ({ path, ...input }) => {
        const data = await readWorkingFile(config, path);
        const { encryptedObject } = await (await sealClient(config)).encrypt({ ...input, data });
        return { encryptedObjectBase64: Buffer.from(encryptedObject).toString('base64'), bytes: encryptedObject.length, packageId: input.packageId, id: input.id };
      }),
    defineTool('arweave_info', '官方 arweave-js 查询网关网络信息。', z.strictObject({}), true,
      async () => (await arweaveClient(config)).network.getInfo()),
    defineTool('arweave_transaction', '官方 arweave-js 查询交易状态与元数据，不下载大文件。', z.strictObject({ id: nativeId }), true,
      async ({ id }) => {
        const client = await arweaveClient(config);
        const status = await client.transactions.getStatus(id);
        // The metadata endpoint does not force downloading transaction data.
        const metadata = await requestJson(config, `${endpointEnv('BCA_ARWEAVE_URL', 'https://arweave.net')}/tx/${id}`);
        return { id, status, metadata };
      }),
    defineTool('arweave_read', '读取 Arweave 网关数据，严格执行响应大小上限。', z.strictObject({ id: nativeId }), true,
      async ({ id }) => {
        const { bytes } = await requestBytes(config, `${endpointEnv('BCA_ARWEAVE_URL', 'https://arweave.net')}/${id}`);
        return { id, bytes: bytes.length, dataBase64: bytes.toString('base64') };
      }),
    defineTool('arweave_verify', '用官方 arweave-js 校验完整原生交易 JSON 的签名；无需钱包。', z.strictObject({ path: z.string().min(1) }), true,
      async ({ path }) => {
        const { default: Arweave } = await import('arweave');
        const client = Arweave.init({});
        const tx = client.transactions.fromRaw(JSON.parse((await readWorkingFile(config, path)).toString('utf8')));
        const valid = await client.transactions.verify(tx);
        if (!valid) throw new Error('Arweave 交易签名验证失败');
        return { valid, id: tx.id, networkConfirmed: false };
      }),
  ];
}
