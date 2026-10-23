import { z } from 'zod';
import { defineTool } from '../types.js';
import type { WalletConfig } from './config.js';
import { requestJson } from './http.js';

function requireKey(config: WalletConfig): string {
  if (!config.bankrApiKey) throw new Error('Bankr 需要 BANKR_API_KEY 或 BCA_BANKR_API_KEY；密钥在 https://bankr.bot/api-keys 创建');
  return config.bankrApiKey;
}

async function bankrGet(config: WalletConfig, path: string) {
  return requestJson<Record<string, unknown>>(
    `${config.bankrBaseUrl}${path}`,
    { method: 'GET', headers: { 'x-api-key': requireKey(config) } },
    config,
    `Bankr ${path}`,
  );
}

export function bankrTools(config: WalletConfig) {
  return [
    defineTool(
      'wallet_bankr_wallet',
      '读取 Bankr Agent API 的 /wallet/me：钱包地址、社交账号、Bankr Club 和封禁状态；需要 Agent API key。',
      z.strictObject({}),
      true,
      async () => bankrGet(config, '/wallet/me'),
    ),
    defineTool(
      'wallet_bankr_portfolio',
      '读取 Bankr Agent API 的 /wallet/portfolio 真实余额；金额保留 API 返回的十进制字符串。',
      z.strictObject({}),
      true,
      async () => bankrGet(config, '/wallet/portfolio'),
    ),
    defineTool(
      'wallet_bankr_prompt',
      '向 Bankr Agent API 提交自然语言任务并返回 jobId/threadId；异步执行，可能触发该 API key 允许的链上操作。',
      z.strictObject({
        prompt: z.string().min(1).max(10000),
        threadId: z.string().min(1).optional(),
        submit: z.literal(true).describe('明确同意提交该任务'),
      }),
      false,
      async ({ prompt, threadId }) => {
        requireKey(config);
        if (!config.base.allowWrites) throw new Error('Bankr prompt 未开启：需要 BCA_ALLOW_WRITES=true');
        return requestJson<Record<string, unknown>>(
          `${config.bankrBaseUrl}/agent/prompt`,
          {
            method: 'POST',
            headers: { 'x-api-key': requireKey(config), 'content-type': 'application/json' },
            body: JSON.stringify({ prompt, ...(threadId ? { threadId } : {}) }),
          },
          config,
          'Bankr /agent/prompt',
        );
      },
    ),
    defineTool(
      'wallet_bankr_job',
      '轮询 Bankr Agent API 的 /agent/job/{jobId}；只读取任务状态和结果，不取消、不重试。',
      z.strictObject({ jobId: z.string().min(1) }),
      true,
      async ({ jobId }) => bankrGet(config, `/agent/job/${encodeURIComponent(jobId)}`),
    ),
  ];
}
