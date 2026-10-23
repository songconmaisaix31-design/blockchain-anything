import { z } from 'zod';
import { defineTool } from '../types.js';
import { addressSchema } from '../providers/common.js';
import type { WalletConfig } from './config.js';

function sdk(config: WalletConfig) {
  if (!config.brianApiKey) throw new Error('Brian 需要 BRIAN_API_KEY 或 BCA_BRIAN_API_KEY');
  return import('@brian-ai/sdk').then(({ BrianSDK }) => new BrianSDK({
    apiKey: config.brianApiKey as string,
    apiUrl: config.brianApiUrl,
    apiVersion: 'v0',
  }));
}

export function brianTools(config: WalletConfig) {
  return [
    defineTool(
      'wallet_brian_status',
      '读取 Brian SDK 的进程配置状态；不连接 API，不返回 key。',
      z.strictObject({}),
      true,
      async () => ({
        sdk: '@brian-ai/sdk',
        configured: Boolean(config.brianApiKey),
        apiUrl: config.brianApiUrl,
        apiVersion: 'v0',
      }),
    ),
    defineTool(
      'wallet_brian_ask',
      '通过 Brian 官方 SDK 调用 /agent/knowledge 生成答案；需要 Brian API key。',
      z.strictObject({
        prompt: z.string().min(1),
        knowledgeBase: z.string().min(1).default('default'),
      }),
      true,
      async ({ prompt, knowledgeBase }) => {
        const brian = await sdk(config);
        return { sdk: '@brian-ai/sdk', result: await brian.ask({ prompt, kb: knowledgeBase }) };
      },
    ),
    defineTool(
      'wallet_brian_transact',
      '通过 Brian 官方 SDK 解析自然语言并返回交易 calldata；不广播、不签名、不转移资产。',
      z.strictObject({
        prompt: z.string().min(1),
        address: addressSchema.optional(),
        chainId: z.string().regex(/^[1-9][0-9]*$/).optional(),
      }),
      true,
      async ({ prompt, address, chainId }) => {
        let from = address;
        if (!from) {
          if (!config.base.privateKey) throw new Error('未提供 address 时需要 BCA_PRIVATE_KEY 提供默认地址');
          const { Wallet } = await import('ethers');
          from = new Wallet(config.base.privateKey).address;
        }
        const brian = await sdk(config);
        return {
          sdk: '@brian-ai/sdk',
          from,
          result: await brian.transact({ prompt, address: from, chainId: chainId as `${number}` | undefined }),
          executed: false,
        };
      },
    ),
  ];
}
