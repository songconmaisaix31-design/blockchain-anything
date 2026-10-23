import { createPublicClient, http, formatLog, numberToHex, TransactionNotFoundError, TransactionReceiptNotFoundError, type Abi, type Address, type Hash, type PublicClient } from 'viem';
import { assertConfiguration } from '../config.js';
import { z } from 'zod';
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

export async function withClient<T>(config: Config, operation: (client: PublicClient) => Promise<T>): Promise<T> {
  assertConfiguration(config, 'evm');
  if (!config.rpcUrl || !config.chainId) throw new Error('需要 BCA_RPC_URL 和 BCA_CHAIN_ID');
  const fetchFn = rpcFetchForEnvironment();
  const client = createPublicClient({
    transport: http(config.rpcUrl, { timeout: config.timeoutMs, retryCount: 0, ...(fetchFn ? { fetchFn } : {}) }),
  });
  const actual = await client.getChainId();
  if (BigInt(actual) !== config.chainId) throw new Error(`chain ID 不匹配：预期 ${config.chainId}，实际 ${actual}`);
  return operation(client);
}

export function viemTools(config: Config) {
  return [
    defineTool('viem_chain', '使用 viem 连接配置的 RPC，核对 chain ID 并读取最新区块号。', z.strictObject({}), true,
      async () => withClient(config, async (client) => ({
        chainId: config.chainId,
        connectionVerified: true,
        blockNumber: (await client.getBlockNumber()).toString(),
      }))),

    defineTool('viem_block', '使用 viem 读取真实区块；不返回完整交易明细。',
      z.strictObject({ block: z.string().optional().describe('十进制区块号或 latest') }), true,
      async ({ block }) => withClient(config, async (client) => {
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
      async ({ address }) => withClient(config, async (client) => ({
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
      async ({ address, abi, functionName, args, block }) => withClient(config, async (client) => {
        const tag = blockTag(block);
        const result = await client.readContract({
          address: address as Address,
          abi: abi as Abi,
          functionName,
          args,
          ...(typeof tag === 'string' ? { blockTag: tag } : { blockNumber: tag }),
        } as any);
        return { chainId: config.chainId, address, functionName, result };
      })),

    defineTool('viem_transaction', '使用 viem 读取真实交易与回执；未找到时 found=false，不推断成功。',
      z.strictObject({ hash: uidSchema }), true,
      async ({ hash }) => withClient(config, async (client) => {
        const transaction = await client.getTransaction({ hash: hash as Hash }).catch((error: unknown) => {
          if (error instanceof TransactionNotFoundError) return null;
          throw new Error(`无法查询交易 (getTransaction)，状态未知：${error instanceof Error ? error.message : 'RPC 错误'}`);
        });
        const receipt = await client.getTransactionReceipt({ hash: hash as Hash }).catch((error: unknown) => {
          if (error instanceof TransactionReceiptNotFoundError) return null;
          throw new Error(`无法查询回执 (getTransactionReceipt)，状态未知：${error instanceof Error ? error.message : 'RPC 错误'}`);
        });
        return {
          status: receipt ? (receipt.status === 'reverted' ? 'failed' : 'confirmed') : transaction ? (transaction.blockNumber === null ? 'pending' : 'receipt_unavailable') : 'not_found',
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
        topics: z.array(z.union([uidSchema, z.array(uidSchema).min(1), z.null()])).max(4).optional(),
      }), true,
      async ({ address, fromBlock, toBlock, topics }) => withClient(config, async (client) => {
        const rpcBlock = (value: string) => {
          const tag = blockTag(value);
          return typeof tag === 'bigint' ? numberToHex(tag) : tag;
        };
        // getLogs accepts ABI events, not raw topics. Keep positional wildcards
        // and OR arrays intact through the official typed raw RPC interface.
        const rawLogs = await client.request({ method: 'eth_getLogs', params: [{
          address: address as Address | undefined,
          fromBlock: rpcBlock(fromBlock), toBlock: rpcBlock(toBlock),
          topics: topics as (Hash | Hash[] | null)[] | undefined,
        }] });
        const logs = rawLogs.map((log) => formatLog(log));
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
