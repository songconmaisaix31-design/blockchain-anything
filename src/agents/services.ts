import { z } from 'zod';
import type { Config } from '../config.js';
import { requireWrites } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, submitSchema } from '../providers/common.js';
import { endpointEnv, envHeaders, requestJson } from '../providers/http.js';

export function agentServiceTools(config: Config) {
  return [
    defineTool('brian_prepare', '官方 Brian SDK 将自然语言转换为待执行交易；不签署、不提交。', z.strictObject({ prompt: z.string().min(1).max(10000), address: addressSchema, chainId: z.string().regex(/^[1-9][0-9]*$/).optional() }), true,
      async ({ chainId, ...input }) => {
        const apiKey = process.env.BCA_BRIAN_API_KEY;
        if (!apiKey) throw new Error('需要 BCA_BRIAN_API_KEY');
        const { BrianSDK } = await import('@brian-ai/sdk');
        return new BrianSDK({ apiKey, apiUrl: endpointEnv('BCA_BRIAN_URL', 'https://api.brianknows.org') }).transact({ ...input, chainId: chainId as `${number}` | undefined });
      }),
    defineTool('bankr_prompt', '调用官方 Bankr Agent API；自然语言可能触发钱包操作，需写入开关和显式提交。', z.strictObject({ prompt: z.string().min(1).max(10000), threadId: z.string().optional(), submit: submitSchema }), false,
      async ({ submit: _, ...input }) => {
        requireWrites(config, false);
        return requestJson(config, `${endpointEnv('BCA_BANKR_URL', 'https://api.bankr.bot')}/agent/prompt`, { method: 'POST', headers: { ...envHeaders('BCA_BANKR_API_KEY', 'X-API-Key', ''), 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      }),
    defineTool('bankr_job', '查询 Bankr 已提交任务的状态。', z.strictObject({ jobId: z.string().regex(/^[a-zA-Z0-9_-]+$/) }), true,
      async ({ jobId }) => requestJson(config, `${endpointEnv('BCA_BANKR_URL', 'https://api.bankr.bot')}/agent/job/${jobId}`, { headers: envHeaders('BCA_BANKR_API_KEY', 'X-API-Key', '') })),
    defineTool('mesh_schema', '查询 Heurist Mesh 官方原生工具 Schema 和价格。', z.strictObject({ agents: z.array(z.string().regex(/^[A-Za-z0-9_]+$/)).min(1).max(10) }), true,
      async ({ agents }) => {
        const query = new URLSearchParams();
        agents.forEach((agent) => query.append('agent_id', agent));
        return requestJson(config, `${endpointEnv('BCA_MESH_URL', 'https://mesh.heurist.xyz')}/mesh_schema?${query}`);
      }),
    defineTool('mesh_call', '调用 Heurist Mesh 原生工具，消耗已配置账户额度。', z.strictObject({ agent: z.string().regex(/^[A-Za-z0-9_]+$/), tool: z.string().min(1), arguments: z.record(z.string(), z.json()).default({}), submit: submitSchema }), false,
      async ({ agent, tool, arguments: args }) => {
        requireWrites(config, false);
        return requestJson(config, `${endpointEnv('BCA_MESH_URL', 'https://mesh.heurist.xyz')}/mesh_request`, { method: 'POST', headers: { ...envHeaders('BCA_HEURIST_API_KEY'), 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: agent, input: { tool, tool_arguments: args } }) });
      }),
  ];
}
