import { SuiGrpcClient } from '@mysten/sui/grpc';
import { z } from 'zod';
import { defineTool } from '../types.js';
import { httpUrl, oneOf } from './env.js';

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

const networks = ['mainnet', 'testnet', 'devnet', 'localnet'] as const;

let cached: { key: string; client: SuiGrpcClient } | undefined;

function suiClient(): SuiGrpcClient {
  const network = oneOf<SuiNetwork>('BCA_SUI_NETWORK', networks);
  const baseUrl = httpUrl('BCA_SUI_RPC_URL', true);
  const key = `${network}|${baseUrl}`;
  if (cached?.key === key) return cached.client;
  const client = new SuiGrpcClient({ network, baseUrl });
  cached = { key, client };
  return client;
}

/** Sui gRPC 只读工具。网络与端点必须由操作者显式配置。 */
export function suiTools() {
  return [
    defineTool('sui_status', '通过官方 Sui gRPC 客户端读取链标识；网络和 fullnode 由配置明确给出。', z.strictObject({}), true,
      async () => {
        const client = suiClient();
        const identifier = await client.getChainIdentifier();
        return {
          network: process.env.BCA_SUI_NETWORK,
          connectionVerified: true,
          chainIdentifier: (identifier as { chainIdentifier?: string }).chainIdentifier ?? identifier,
        };
      }),

    defineTool('sui_object', '使用官方 Sui gRPC 客户端读取对象元数据与 JSON 内容；不执行交易。',
      z.strictObject({ objectId: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, '必须为 Sui 对象 ID') }), true,
      async ({ objectId }) => {
        const client = suiClient();
        const response = await client.getObject({ objectId, include: { json: true, previousTransaction: true } });
        const object = (response as unknown as { object?: Record<string, unknown> }).object;
        if (!object) throw new Error('Sui 对象不存在');
        return {
          network: process.env.BCA_SUI_NETWORK,
          object: {
            objectId: object.objectId ?? objectId,
            version: object.version ?? null,
            digest: object.digest ?? null,
            type: object.type ?? null,
            owner: object.owner ?? null,
            previousTransaction: object.previousTransaction ?? null,
            json: object.json ?? null,
          },
        };
      }),

    defineTool('sui_balance', '使用官方 Sui gRPC 客户端读取地址的币余额；默认币种为 SUI，金额为最小单位十进制字符串。',
      z.strictObject({
        owner: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, '必须为 Sui 地址'),
        coinType: z.string().min(1).optional().describe('默认 0x2::sui::SUI'),
      }), true,
      async ({ owner, coinType }) => {
        const client = suiClient();
        const response = await client.getBalance({ owner, ...(coinType ? { coinType } : {}) });
        return {
          network: process.env.BCA_SUI_NETWORK,
          owner,
          balance: response.balance,
        };
      }),

    defineTool('sui_transaction', '使用官方 Sui gRPC 客户端读取交易摘要、状态与 effects；未找到时立即失败。',
      z.strictObject({ digest: z.string().min(1) }), true,
      async ({ digest }) => {
        const client = suiClient();
        const transaction = await client.getTransaction({ digest, include: { effects: true } });
        return {
          network: process.env.BCA_SUI_NETWORK,
          transaction,
        };
      }),
  ];
}
