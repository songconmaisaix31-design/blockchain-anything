import { z } from 'zod';
import { defineTool } from '../types.js';
import type { WalletConfig } from './config.js';
import { requestJson } from './http.js';

interface MeshAgent {
  metadata?: { name?: string; description?: string; tags?: string[]; credits?: Record<string, number> };
  tools?: Array<{ function?: { name?: string; description?: string } }>;
}

export function meshTools(config: WalletConfig) {
  return [
    defineTool(
      'wallet_mesh_catalog',
      '读取 Heurist Mesh 官方 metadata.json，返回 agent、工具和价格目录；不执行付费请求。',
      z.strictObject({}),
      true,
      async () => {
        const catalog = await requestJson<{ last_updated?: string; commit_sha?: string; agents?: Record<string, MeshAgent> }>(
          `${config.heuristMetadataUrl}/metadata.json`,
          { method: 'GET' },
          config,
          'Heurist Mesh metadata',
        );
        const agents = Object.entries(catalog.agents ?? {}).map(([id, agent]) => ({
          id,
          name: agent.metadata?.name ?? id,
          tags: agent.metadata?.tags ?? [],
          credits: agent.metadata?.credits ?? {},
          tools: (agent.tools ?? []).map((tool) => tool.function?.name ?? ''),
        }));
        return { lastUpdated: catalog.last_updated ?? null, commit: catalog.commit_sha ?? null, count: agents.length, agents };
      },
    ),
    defineTool(
      'wallet_mesh_schema',
      '读取 Heurist Mesh 官方 mesh_schema，确认 agent 工具的参数和价格；不执行请求。',
      z.strictObject({ agentIds: z.array(z.string().min(1)).min(1).max(20) }),
      true,
      async ({ agentIds }) => {
        const query = new URLSearchParams();
        for (const agentId of agentIds) query.append('agent_id', agentId);
        return requestJson<Record<string, unknown>>(
          `${config.heuristApiUrl}/mesh_schema?${query.toString()}`,
          { method: 'GET' },
          config,
          'Heurist Mesh schema',
        );
      },
    ),
    defineTool(
      'wallet_mesh_request',
      '调用 Heurist Mesh 真实付费 API；需要 HEURIST_API_KEY 或 BCA_HEURIST_API_KEY，未配置时明确失败。',
      z.strictObject({
        agentId: z.string().min(1),
        tool: z.string().min(1),
        toolArguments: z.record(z.string(), z.unknown()).default({}),
      }),
      false,
      async ({ agentId, tool, toolArguments }) => {
        if (!config.heuristApiKey) throw new Error('Heurist Mesh 需要 HEURIST_API_KEY 或 BCA_HEURIST_API_KEY');
        return {
          agentId,
          tool,
          result: await requestJson<Record<string, unknown>>(
            `${config.heuristApiUrl}/mesh_request`,
            {
              method: 'POST',
              headers: { authorization: `Bearer ${config.heuristApiKey}`, 'content-type': 'application/json' },
              body: JSON.stringify({ agent_id: agentId, input: { tool, tool_arguments: toolArguments } }),
            },
            config,
            'Heurist Mesh request',
          ),
        };
      },
    ),
  ];
}
