import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { z } from 'zod';
import { defineTool } from '../types.js';
import { httpUrl, oneOf } from './env.js';

type AptosNetwork = 'mainnet' | 'testnet' | 'devnet' | 'local' | 'custom';

const networks = ['mainnet', 'testnet', 'devnet', 'local', 'custom'] as const;

let cached: { key: string; client: Aptos } | undefined;

function aptosClient(): Aptos {
  const network = oneOf<AptosNetwork>('BCA_APTOS_NETWORK', networks);
  const fullnode = httpUrl('BCA_APTOS_NODE_URL', true);
  const key = `${network}|${fullnode}`;
  if (cached?.key === key) return cached.client;
  const enumNetwork = Network[network.toUpperCase() as keyof typeof Network];
  if (!enumNetwork) throw new Error('BCA_APTOS_NETWORK 不受官方 SDK 支持');
  const client = new Aptos(new AptosConfig({ network: enumNetwork, fullnode }));
  cached = { key, client };
  return client;
}

const accountAddress = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, '必须为 Aptos 账户地址');

/** Aptos 官方 TypeScript SDK 只读工具。 */
export function aptosTools() {
  return [
    defineTool('aptos_status', '通过官方 Aptos SDK 读取账本信息；网络与 fullnode 端点由配置明确给出。', z.strictObject({}), true,
      async () => {
        const ledger = await aptosClient().getLedgerInfo();
        return {
          network: process.env.BCA_APTOS_NETWORK,
          connectionVerified: true,
          ledger,
        };
      }),

    defineTool('aptos_account', '读取 Aptos 账户的链上认证信息与 sequence number。',
      z.strictObject({ accountAddress }), true,
      async ({ accountAddress: address }) => ({
        network: process.env.BCA_APTOS_NETWORK,
        account: await aptosClient().getAccountInfo({ accountAddress: address }),
      })),

    defineTool('aptos_balance', '通过官方 Aptos SDK 读取原生 APT 余额（octas）；超过 JS 安全整数时明确失败，不静默损失精度。',
      z.strictObject({ accountAddress }), true,
      async ({ accountAddress: address }) => {
        const amount = await aptosClient().getAccountAPTAmount({ accountAddress: address });
        if (!Number.isSafeInteger(amount)) throw new Error('APT 余额超过官方 SDK 的安全整数范围，拒绝返回可能失真的值');
        return {
          network: process.env.BCA_APTOS_NETWORK,
          accountAddress: address,
          coinType: '0x1::aptos_coin::AptosCoin',
          balanceOctas: String(amount),
        };
      }),

    defineTool('aptos_resource', '读取 Aptos 账户资源；未指定类型时返回全部资源，指定时由 SDK 精确查询。',
      z.strictObject({ accountAddress, resourceType: z.string().min(1).optional() }), true,
      async ({ accountAddress: address, resourceType }) => {
        const client = aptosClient();
        if (resourceType) {
          return {
            network: process.env.BCA_APTOS_NETWORK,
            accountAddress: address,
            resourceType,
            data: await client.getAccountResource({
              accountAddress: address,
              resourceType: resourceType as `${string}::${string}::${string}`,
            }),
          };
        }
        return {
          network: process.env.BCA_APTOS_NETWORK,
          accountAddress: address,
          resources: await client.getAccountResources({ accountAddress: address }),
        };
      }),
  ];
}
