import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, uint256Schema } from './common.js';
import { requestJson } from './http.js';

const inputSchema = z.strictObject({
  chainId: uint256Schema.refine((value) => value !== '0', 'chainId 必须大于零').describe('目标 EVM 链 ID，例如 Ethereum 为 1、Base 为 8453'),
  address: addressSchema.transform((value) => value.toLowerCase()).describe('单个 ERC20 合约地址'),
});
const envelopeSchema = z.looseObject({ code: z.number().int(), message: z.string().optional(), result: z.unknown().optional() });
const resultsSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

export interface GoPlusTokenSecurityResult {
  provider: 'goplus';
  access: 'public';
  chainId: string;
  address: string;
  source: string;
  queriedAt: string;
  response: Record<string, unknown> & {
    code: 1;
    message?: string;
    result: Record<string, Record<string, unknown>>;
  };
}

export function goplusTools(config: Config) {
  return [defineTool('goplus_token_security', '通过 GoPlus 公开 API 查询单个 EVM 代币的安全风险；无需账户，保留原始风险字段。', inputSchema, true,
    async ({ chainId, address }): Promise<GoPlusTokenSecurityResult> => {
      const url = new URL(`https://api.gopluslabs.io/api/v1/token_security/${chainId}`);
      url.searchParams.set('contract_addresses', address);
      const response = envelopeSchema.parse(await requestJson(config, url.href, { headers: { Accept: 'application/json' } }));
      if (response.code !== 1) throw new Error(`GoPlus 请求失败（code=${response.code}）：${response.message ?? '上游未返回错误说明'}`);
      const result = resultsSchema.parse(response.result);
      if (Object.keys(result).length === 0) throw new Error(`GoPlus 未返回链 ${chainId} 地址 ${address} 的代币风险数据`);
      const matched = Object.entries(result).find(([key]) => key.toLowerCase() === address);
      if (!matched || Object.keys(matched[1]).length === 0) throw new Error(`GoPlus 响应缺少请求地址 ${address} 的代币风险数据`);
      // 保留未知风险字段以及空值，避免将上游缺项解释为没有风险。
      return { provider: 'goplus', access: 'public', chainId, address, source: url.href, queriedAt: new Date().toISOString(), response: { ...response, code: 1, result } };
    })];
}
