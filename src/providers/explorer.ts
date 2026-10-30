import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uint256Schema } from './common.js';
import { requestJson } from './http.js';

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';

const envelopeSchema = z.looseObject({
  status: z.string(),
  message: z.string(),
  result: z.unknown(),
});

function requireKey(config: Config): string {
  if (!config.etherscanApiKey) {
    throw new Error('需要 BCA_ETHERSCAN_API_KEY（Etherscan v2 免费额度即可）；未配置时本工具不可用');
  }
  return config.etherscanApiKey;
}

// 上游把错误写在 message 里，且可能包含请求 URL（含 apikey），这里统一降级为可读文案。
function describeFailure(message: string, result: unknown): string {
  const text = typeof result === 'string' ? result : '';
  if (/not verified/i.test(text)) return '该合约源码未在 Etherscan 验证，没有可用的 ABI';
  if (/Invalid API Key/i.test(message) || /Invalid API Key/i.test(text)) return 'BCA_ETHERSCAN_API_KEY 无效或已过期';
  if (/rate limit/i.test(message) || /rate limit/i.test(text)) return 'Etherscan 触发限流，请稍后重试';
  return text || message || 'Etherscan 未返回可用结果';
}

// 结果里可能混入带 apikey 的 URL，序列化前统一清洗。
function scrub(value: unknown, key: string): unknown {
  if (typeof value === 'string') return value.split(key).join('***');
  if (Array.isArray(value)) return value.map((item) => scrub(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, key)]));
  }
  return value;
}

export function explorerTools(config: Config) {
  return [
    defineTool(
      'explorer_abi',
      '从 Etherscan v2 读取已验证合约的 ABI 与合约名，供 Agent 构造调用。只读，需要 BCA_ETHERSCAN_API_KEY。',
      z.strictObject({
        address: addressSchema.describe('已验证源码的合约地址'),
        chainId: uint256Schema.default('1').describe('EVM 链 ID，默认 1（Ethereum 主网）；Etherscan v2 用同一把 key 覆盖多链'),
      }),
      true,
      async ({ address, chainId }) => {
        const apiKey = requireKey(config);
        if (chainId === '0') throw new Error('chainId 必须大于零');
        const url = new URL(ETHERSCAN_V2);
        url.searchParams.set('chainid', chainId);
        url.searchParams.set('module', 'contract');
        url.searchParams.set('action', 'getabi');
        url.searchParams.set('address', address);
        url.searchParams.set('apikey', apiKey);

        const raw = envelopeSchema.parse(await requestJson(config, url.href, { headers: { Accept: 'application/json' } }));
        if (raw.status !== '1') throw new Error(describeFailure(raw.message, raw.result));

        let abi: unknown;
        try {
          abi = typeof raw.result === 'string' ? JSON.parse(raw.result) : raw.result;
        } catch {
          throw new Error('Etherscan 返回的 ABI 不是合法 JSON');
        }
        if (!Array.isArray(abi) || abi.length === 0) throw new Error('Etherscan 返回了空 ABI');

        const functions = abi
          .filter((item): item is { type: string; name: string; stateMutability?: string; inputs?: unknown[]; outputs?: unknown[] } =>
            Boolean(item) && typeof item === 'object' && (item as { type?: string }).type === 'function')
          .map((item) => ({
            name: item.name,
            stateMutability: item.stateMutability ?? null,
            inputs: Array.isArray(item.inputs) ? item.inputs.length : 0,
            outputs: Array.isArray(item.outputs) ? item.outputs.length : 0,
          }));

        return {
          provider: 'etherscan',
          access: 'api-key',
          chainId,
          address,
          abiEntries: abi.length,
          functionCount: functions.length,
          functions: functions.slice(0, 80),
          abi: scrub(abi, apiKey),
          note: 'ABI 只说明如何调用，不代表合约安全或已审计。',
        };
      },
    ),
  ];
}
