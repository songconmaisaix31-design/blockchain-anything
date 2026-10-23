import { createPublicClient, http, type Abi, type Address, type Hash, type PublicClient } from 'viem';
import { z } from 'zod';
import { readConfig } from '../config.js';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uidSchema } from '../providers/common.js';
import { rpcFetchForEnvironment } from './http.js';

function blockTag(value: string | undefined): bigint | 'latest' | 'earliest' | 'pending' | 'safe' | 'finalized' | undefined {
  if (value === undefined) return undefined;
  if (/^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  if (['latest', 'earliest', 'pending', 'safe', 'finalized'].includes(value)) return value as 'latest';
  throw new Error('block 必须为十进制区块号或 latest/earliest/pending/safe/finalized');
}

async function withClient<T>(operation: (client: PublicClient, config: Config) => Promise<T>): Promise<T> {
  const config = readConfig();
  if (!config.rpcUrl || !config.chainId) throw new Error('需要 BCA_RPC_URL 和 BCA_CHAIN_ID');
  const fetchFn = rpcFetchForEnvironment();
  const client = createPublicClient({
    transport: http(config.rpcUrl, { timeout: config.timeoutMs, retryCount: 0, ...(fetchFn ? { fetchFn } : {}) }),
  });
  const actual = await client.getChainId();
  if (BigInt(actual) !== config.chainId) throw new Error(`chain ID 不匹配：预期 ${config.chainId}，实际 ${actual}`);
  return operation(client, config);
}

/**
 * viem 公开只读工具。工厂不接受配置参数：每次调用重新读取进程环境，
 * 因此未配置或配置变化会立即反映到该次调用，而不是静默沿用旧网络。
 */
export function viemTools() {
  return [
    defineTool('viem_chain', '使用 viem 连接配置的 RPC，核对 chain ID 并读取最新区块号。', z.strictObject({}), true,
      async () => withClient(async (client, config) => ({
        chainId: config.chainId,
        connectionVerified: true,
        blockNumber: (await client.getBlockNumber()).toString(),
      }))),

    defineTool('viem_block', '使用 viem 读取真实区块；不返回完整交易明细。',
      z.strictObject({ block: z.string().optional().describe('十进制区块号或 latest') }), true,
      async ({ block }) => withClient(async (client, config) => {
        const tag = blockTag(block);
        const result = await client.getBlock(typeof tag === 'string'
          ? { blockTag: tag, includeTransactions: false }
          : { blockNumber: tag, includeTransactions: false });
        return {
          chainId: config.chainId,
          block: {
            number: result.number?.toString() ?? null,
            hash: result.hash,
            parentHash: result.parentHash,
            timestamp: result.timestamp?.toString() ?? null,
            gasUsed: result.gasUsed.toString(),
            gasLimit: result.gasLimit.toString(),
            baseFeePerGas: result.baseFeePerGas?.toString() ?? null,
            transactionCount: result.transactions.length,
          },
        };
      })),

    defineTool('viem_balance', '使用 viem 查询真实地址的原生币余额，返回 wei 十进制字符串。',
      z.strictObject({ address: addressSchema }), true,
      async ({ address }) => withClient(async (client, config) => ({
        chainId: config.chainId,
        address,
        balanceWei: (await client.getBalance({ address: address as Address })).toString(),
      }))),

    defineTool('viem_read', '使用 viem 调用真实只读合约方法；ABI 由调用者提供，结果按 viem 类型序列化。',
      z.strictObject({
        address: addressSchema,
        abi: z.array(z.unknown()).min(1).describe('合约 ABI JSON 数组'),
        functionName: z.string().min(1),
        args: z.array(z.unknown()).default([]),
        block: z.string().optional(),
      }), true,
      async ({ address, abi, functionName, args, block }) => withClient(async (client, config) => {
        const tag = blockTag(block);
        const result = await client.readContract({
          address: address as Address,
          abi: abi as Abi,
          functionName,
          args,
          ...(typeof tag === 'string' ? { blockTag: tag } : { blockNumber: tag }),
        } as never);
        return { chainId: config.chainId, address, functionName, result };
      })),

    defineTool('viem_transaction', '使用 viem 读取真实交易与回执；未找到时 found=false，不推断成功。',
      z.strictObject({ hash: uidSchema }), true,
      async ({ hash }) => withClient(async (client, config) => {
        const transaction = await client.getTransaction({ hash: hash as Hash }).catch(() => null);
        const receipt = await client.getTransactionReceipt({ hash: hash as Hash }).catch(() => null);
        return {
          chainId: config.chainId,
          hash,
          found: transaction !== null,
          transaction,
          receiptFound: receipt !== null,
          receipt,
        };
      })),

    defineTool('viem_logs', '使用 viem 读取真实事件日志；范围必须由调用者明确给出。',
      z.strictObject({
        address: addressSchema.optional(),
        fromBlock: z.string().default('latest'),
        toBlock: z.string().default('latest'),
        topics: z.array(z.union([z.string(), z.array(z.string())])).optional(),
      }), true,
      async ({ address, fromBlock, toBlock, topics }) => withClient(async (client, config) => {
        const logs = await client.getLogs({
          address: address as Address | undefined,
          fromBlock: blockTag(fromBlock),
          toBlock: blockTag(toBlock),
          topics: topics as never,
        } as never);
        return {
          chainId: config.chainId,
          count: logs.length,
          logs: logs.map((log) => ({
            address: log.address,
            blockNumber: log.blockNumber?.toString() ?? null,
            transactionHash: log.transactionHash,
            logIndex: log.logIndex?.toString() ?? null,
            topics: log.topics,
            data: log.data,
            removed: log.removed,
          })),
        };
      })),
  ];
}
