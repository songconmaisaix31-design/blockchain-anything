import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, bytesSchema, uint256Schema } from './common.js';
import { requestJson } from './http.js';

const simulationSchema = z.looseObject({
  simulation: z.looseObject({
    status: z.boolean().optional(),
    id: z.string().optional(),
    gas_used: z.number().optional(),
    error_message: z.string().nullable().optional(),
    error_reason: z.string().nullable().optional(),
    block_number: z.number().optional(),
  }),
  transaction: z.looseObject({
    hash: z.string().optional(),
    gas_used: z.number().optional(),
    status: z.boolean().optional(),
    error_message: z.string().nullable().optional(),
  }).optional(),
});

export function simulatorTools(config: Config) {
  return [
    defineTool(
      'tx_simulate',
      '在 Tenderly 上模拟一次即将发送的合约调用，返回是否回滚、gas 消耗与错误原因。只读模拟，不广播交易；需要 Tenderly 三件套环境变量。',
      z.strictObject({
        to: addressSchema.describe('被调用的合约或接收地址'),
        from: addressSchema.default('0x0000000000000000000000000000000000000000').describe('模拟的调用方地址；建议传真实发送地址，权限判断才准确'),
        input: bytesSchema.default('0x').describe('调用数据（0x 开头的十六进制），普通转账留空'),
        value: uint256Schema.default('0').describe('附带的原生币数量，按 wei 计'),
        networkId: uint256Schema.optional().describe('链 ID；缺省时使用 BCA_CHAIN_ID'),
        blockNumber: uint256Schema.optional().describe('在指定区块高度模拟；缺省为最新区块'),
      }),
      true,
      async ({ to, from, input, value, networkId, blockNumber }) => {
        if (!config.tenderly) {
          throw new Error('需要 BCA_TENDERLY_ACCOUNT、BCA_TENDERLY_PROJECT、BCA_TENDERLY_ACCESS_KEY 三个变量；未配置时本工具不可用');
        }
        const chain = networkId ?? (config.chainId ? config.chainId.toString() : undefined);
        if (!chain) throw new Error('缺少链 ID：请传 networkId，或设置 BCA_CHAIN_ID');
        const { account, project, accessKey } = config.tenderly;
        const url = `https://api.tenderly.co/api/v1/account/${encodeURIComponent(account)}/project/${encodeURIComponent(project)}/simulate`;
        const payload: Record<string, unknown> = {
          network_id: chain,
          from,
          to,
          input,
          value: value === '0' ? '0' : `0x${BigInt(value).toString(16)}`,
          save: false,
          simulation_type: 'full',
        };
        if (blockNumber) payload.block_number = blockNumber;

        const body = simulationSchema.parse(
          await requestJson(config, url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', Accept: 'application/json', 'X-Access-Key': accessKey },
            body: JSON.stringify(payload),
          }),
        );

        const sim = body.simulation;
        const succeeded = sim.status === true;
        const errorMessage = sim.error_message ?? body.transaction?.error_message ?? null;
        return {
          provider: 'tenderly',
          access: 'api-key',
          chainId: chain,
          simulationId: sim.id ?? null,
          blockNumber: sim.block_number ?? (blockNumber ? Number(blockNumber) : null),
          success: succeeded,
          gasUsed: sim.gas_used ?? body.transaction?.gas_used ?? null,
          errorMessage,
          errorReason: sim.error_reason ?? null,
          note: succeeded
            ? '模拟通过不等于上链成功：真实执行还取决于当时的区块状态与余额。'
            : '模拟回滚意味着按当前状态执行会失败，请先修正再提交。',
        };
      },
    ),
  ];
}
