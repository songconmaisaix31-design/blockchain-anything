import Arweave from 'arweave';
import { z } from 'zod';
import { defineTool } from '../types.js';
import { httpUrl, maxReadBytes } from '../chains/env.js';

let cached: { key: string; client: Arweave } | undefined;

function gateway(): { client: Arweave; endpoint: string } {
  const endpoint = httpUrl('BCA_ARWEAVE_GATEWAY', true);
  const url = new URL(endpoint);
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BCA_ARWEAVE_GATEWAY 必须为网关根 URL');
  }
  if (cached && cached.key === endpoint) return { client: cached.client, endpoint };
  const client = Arweave.init({
    host: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    timeout: 30_000,
    logging: false,
  });
  cached = { key: endpoint, client };
  return { client, endpoint };
}

const transactionId = z.string().regex(/^[A-Za-z0-9_-]{43}$/, '必须为 Arweave 交易 ID');

/** Arweave 官方 arweave-js 只读工具。付费写入与广播不在本适配范围。 */
export function arweaveTools() {
  return [
    defineTool('arweave_status', '通过官方 arweave-js 读取配置网关的网络信息、当前区块与版本。', z.strictObject({}), true,
      async () => {
        const { client } = gateway();
        const info = await client.network.getInfo();
        return { gateway: process.env.BCA_ARWEAVE_GATEWAY, connectionVerified: true, network: info };
      }),

    defineTool('arweave_transaction', '通过官方 arweave-js 网关客户端读取交易元数据与确认状态；未找到时返回 found=false。',
      z.strictObject({ id: transactionId }), true,
      async ({ id }) => {
        const { client } = gateway();
        const status = await client.transactions.getStatus(id);
        if (status.status === 404) return { id, found: false, status };
        const response = await client.api.get(`tx/${id}`);
        if (response.status === 404) return { id, found: false, status };
        if (response.status !== 200) throw new Error(`Arweave 交易元数据请求失败（HTTP ${response.status}）`);
        const transaction = response.data as Record<string, unknown>;
        return {
          id,
          found: true,
          status,
          transaction: {
            id: transaction.id,
            last_tx: transaction.last_tx,
            owner: transaction.owner,
            target: transaction.target,
            quantity: transaction.quantity,
            data_size: transaction.data_size,
            reward: transaction.reward,
            signature: transaction.signature,
            tags: transaction.tags,
          },
        };
      }),

    defineTool('arweave_data', '通过官方 arweave-js 网关客户端读取交易数据，返回 base64；先按 data_size 检查上限，不返回截断内容。',
      z.strictObject({
        id: transactionId,
        maxBytes: z.number().int().positive().optional(),
      }), true,
      async ({ id, maxBytes }) => {
        const limit = Math.min(maxBytes ?? maxReadBytes(), maxReadBytes());
        const { client } = gateway();
        const status = await client.transactions.getStatus(id);
        if (status.status === 404) throw new Error('Arweave 交易不存在');
        const metadataResponse = await client.api.get(`tx/${id}`);
        if (metadataResponse.status !== 200) throw new Error(`Arweave 交易元数据请求失败（HTTP ${metadataResponse.status}）`);
        const declared = Number((metadataResponse.data as { data_size?: string }).data_size);
        if (!Number.isSafeInteger(declared) || declared < 0) throw new Error('Arweave data_size 无效');
        if (declared > limit) throw new Error('Arweave 数据超过读取字节上限');
        const response = await client.api.get(id, { responseType: 'arraybuffer' });
        if (response.status !== 200) throw new Error(`Arweave 数据请求失败（HTTP ${response.status}）`);
        const bytes = Buffer.from(response.data as ArrayBuffer);
        if (bytes.byteLength !== declared) throw new Error('Arweave 返回数据长度与 data_size 不一致');
        return {
          id,
          dataSize: declared,
          bytes: bytes.byteLength,
          encoding: 'base64',
          data: bytes.toString('base64'),
        };
      }),
  ];
}
