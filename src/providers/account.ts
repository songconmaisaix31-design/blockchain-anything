import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { uidSchema } from './common.js';
import { requestJson } from './http.js';

const rpcEnvelope = z.looseObject({
  result: z.unknown().optional(),
  error: z.looseObject({ code: z.number(), message: z.string(), data: z.unknown().optional() }).optional(),
});

function requireBundler(config: Config): string {
  if (!config.bundlerUrl) {
    throw new Error('需要 BCA_BUNDLER_URL（ERC-4337 bundler 的 JSON-RPC 地址，通常自带项目密钥）；未配置时本工具不可用');
  }
  return config.bundlerUrl;
}

async function bundlerCall(config: Config, url: string, method: string, params: unknown[]): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const response = rpcEnvelope.parse(
    await requestJson(config, url, { method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' }, body }),
  );
  if (response.error) {
    // bundler 的错误文案有时带 URL，仅保留 code 与 message。
    throw new Error(`bundler 返回错误（${response.error.code}）：${response.error.message}`);
  }
  return response.result ?? null;
}

export function accountTools(config: Config) {
  return [
    defineTool(
      'aa_entrypoints',
      '查询配置的 ERC-4337 bundler 支持的 EntryPoint 版本列表。只读，需要 BCA_BUNDLER_URL。',
      z.strictObject({}),
      true,
      async () => {
        const url = requireBundler(config);
        const entryPoints = await bundlerCall(config, url, 'eth_supportedEntryPoints', []);
        if (!Array.isArray(entryPoints)) throw new Error('bundler 未返回 EntryPoint 列表');
        return {
          provider: 'erc4337',
          access: 'api-key',
          entryPoints,
          count: entryPoints.length,
          note: 'EntryPoint 是账户抽象的交易入口合约；版本不同，UserOperation 结构也不同。',
        };
      },
    ),
    defineTool(
      'aa_userop_receipt',
      '按 userOpHash 查询 ERC-4337 UserOperation 的执行回执。尚未打包时返回 found=false，不推断成功。只读，需要 BCA_BUNDLER_URL。',
      z.strictObject({
        userOpHash: uidSchema.describe('UserOperation 哈希（bytes32），不是链上交易哈希'),
      }),
      true,
      async ({ userOpHash }) => {
        const url = requireBundler(config);
        const receipt = await bundlerCall(config, url, 'eth_getUserOperationReceipt', [userOpHash]);
        if (!receipt || typeof receipt !== 'object') {
          return {
            provider: 'erc4337',
            access: 'api-key',
            userOpHash,
            found: false,
            note: 'bundler 尚未返回回执，可能还未打包或已被丢弃；本工具不推断结果。',
          };
        }
        const data = receipt as Record<string, unknown>;
        const txReceipt = (data.receipt ?? {}) as Record<string, unknown>;
        return {
          provider: 'erc4337',
          access: 'api-key',
          userOpHash,
          found: true,
          success: data.success ?? null,
          sender: data.sender ?? null,
          nonce: data.nonce ?? null,
          paymaster: data.paymaster ?? null,
          actualGasCost: data.actualGasCost ?? null,
          actualGasUsed: data.actualGasUsed ?? null,
          transactionHash: txReceipt.transactionHash ?? null,
          blockNumber: txReceipt.blockNumber ?? null,
          gasUsed: txReceipt.gasUsed ?? null,
          logs: Array.isArray(txReceipt.logs) ? txReceipt.logs.length : null,
        };
      },
    ),
  ];
}
