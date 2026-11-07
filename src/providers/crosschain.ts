import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uint256Schema, uidSchema } from './common.js';
import { requestJson } from './http.js';

const acrossSchema = z.looseObject({
  estimatedFillTimeSec: z.number().optional(),
  isAmountTooLow: z.boolean().optional(),
  lpFeePct: z.string().optional(),
  totalRelayFee: z.looseObject({ pct: z.string().optional(), total: z.string().optional() }).optional(),
  spokePoolAddress: z.string().optional(),
  destinationSpokePoolAddress: z.string().optional(),
  limits: z.looseObject({ minDeposit: z.string().optional(), maxDeposit: z.string().optional(), maxDepositInstant: z.string().optional() }).optional(),
});

const wormholeSchema = z.looseObject({
  transactions: z.array(z.looseObject({
    id: z.string().optional(),
    txHash: z.string().optional(),
    emitterChain: z.number().optional(),
    timestamp: z.string().optional(),
    standardizedProperties: z.looseObject({ fromChain: z.number().optional(), toChain: z.number().optional(), status: z.string().optional() }).optional(),
    originChain: z.number().optional(),
    destinationChain: z.number().optional(),
  })).optional(),
});

// Across 的费率字段以 1e18 为分母的比例表示。
function pctOf(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Number((value / 1e16).toFixed(6));
}

export function crosschainTools(config: Config) {
  return [
    defineTool(
      'across_quote',
      '通过 Across 公开接口查询跨链转账的预估费用与到账时间（只读报价，不构造也不提交交易）。',
      z.strictObject({
        token: addressSchema.describe('源链上要跨的 ERC20 地址（原生币请用它对应的 wrapped 地址）'),
        originChainId: uint256Schema.describe('源链 ID，例如以太坊 1'),
        destinationChainId: uint256Schema.describe('目标链 ID，例如 Base 8453'),
        amount: uint256Schema.describe('转账数量，按代币最小单位计'),
      }),
      true,
      async ({ token, originChainId, destinationChainId, amount }) => {
        const url = new URL('https://across.to/api/suggested-fees');
        url.searchParams.set('token', token);
        url.searchParams.set('originChainId', originChainId);
        url.searchParams.set('destinationChainId', destinationChainId);
        url.searchParams.set('amount', amount);
        const body = acrossSchema.parse(await requestJson(config, url.href, { headers: { Accept: 'application/json' } }));
        if (body.isAmountTooLow) throw new Error('金额低于 Across 的最低跨链门槛，报价不可用');
        return {
          provider: 'across',
          access: 'public',
          token,
          originChainId,
          destinationChainId,
          amount,
          totalFeePct: pctOf(body.totalRelayFee?.pct),
          lpFeePct: pctOf(body.lpFeePct),
          estimatedFillTimeSec: body.estimatedFillTimeSec ?? null,
          limits: {
            minDeposit: body.limits?.minDeposit ?? null,
            maxDeposit: body.limits?.maxDeposit ?? null,
            maxDepositInstant: body.limits?.maxDepositInstant ?? null,
          },
          spokePool: body.spokePoolAddress ?? null,
          destinationSpokePool: body.destinationSpokePoolAddress ?? null,
          note: '只读报价；实际执行需要在源链调用 spoke pool，本工具不构造交易。',
          source: 'https://across.to/api/suggested-fees',
        };
      },
    ),
    defineTool(
      'wormhole_tx_status',
      '按源链交易哈希查询 Wormhole 跨链消息记录（只读，公开接口）。返回该交易对应的消息条目数量与基础字段。',
      z.strictObject({
        txHash: uidSchema.describe('源链上的交易哈希（bytes32）'),
      }),
      true,
      async ({ txHash }) => {
        const url = new URL('https://api.wormholescan.io/api/v1/transactions');
        url.searchParams.set('txHash', txHash);
        url.searchParams.set('pageSize', '10');
        const body = wormholeSchema.parse(await requestJson(config, url.href, { headers: { Accept: 'application/json' } }));
        const items = body.transactions ?? [];
        if (items.length === 0) {
          return {
            provider: 'wormholescan',
            access: 'public',
            txHash,
            found: false,
            note: '该交易没有对应的 Wormhole 消息记录；可能不走 Wormhole，或尚未被索引。',
          };
        }
        return {
          provider: 'wormholescan',
          access: 'public',
          txHash,
          found: true,
          count: items.length,
          messages: items.map((item) => ({
            id: item.id ?? null,
            timestamp: item.timestamp ?? null,
            emitterChain: item.emitterChain ?? null,
            fromChain: item.standardizedProperties?.fromChain ?? null,
            toChain: item.standardizedProperties?.toChain ?? null,
            status: item.standardizedProperties?.status ?? null,
          })),
          note: '只反映 Wormholescan 的索引结果；跨链是否真正完成，以目标链上的执行记录为准。',
          source: 'https://api.wormholescan.io/api/v1/transactions',
        };
      },
    ),
  ];
}
