import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { requestJson } from './http.js';

const responseSchema = z.looseObject({
  data: z.unknown().optional(),
  errors: z.array(z.looseObject({ message: z.string() })).optional(),
});

// 只放行 query 文档，避免顺手把 mutation 发给子图（子图本身也只读，但话要说清楚）。
function assertQueryOnly(query: string): void {
  const stripped = query.replace(/#[^\n]*/g, '');
  if (!/\bquery\b|\{/.test(stripped)) throw new Error('query 必须是 GraphQL 查询文档');
  if (/\bmutation\b/.test(stripped)) throw new Error('子图只支持查询，不接受 mutation');
}

export function subgraphTools(config: Config) {
  return [
    defineTool(
      'subgraph_query',
      '向 The Graph 的去中心化网关执行一次只读 GraphQL 查询（按子图 ID）。需要 BCA_GRAPH_API_KEY。',
      z.strictObject({
        subgraphId: z.string().min(10).regex(/^[A-Za-z0-9]+$/, '子图 ID 只能包含字母与数字').describe('子图部署 ID，例如 Qm… 或 base58 字符串'),
        query: z.string().min(8).max(4000).describe('GraphQL 查询文档；只允许 query，不允许 mutation'),
      }),
      true,
      async ({ subgraphId, query }) => {
        if (!config.graphApiKey) {
          throw new Error('需要 BCA_GRAPH_API_KEY（The Graph Studio 免费额度即可）；未配置时本工具不可用');
        }
        assertQueryOnly(query);
        const url = `https://gateway.thegraph.com/api/${config.graphApiKey}/subgraphs/id/${subgraphId}`;
        let raw: unknown;
        try {
          raw = await requestJson(config, url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query }),
          });
        } catch (error) {
          // 上游错误可能带完整 URL（含 key），统一改写为不含凭据的文案。
          const message = error instanceof Error ? error.message : String(error);
          if (/401|403|unauthorized/i.test(message)) throw new Error('BCA_GRAPH_API_KEY 无效或没有该子图的访问权限');
          if (/\b429\b/.test(message)) throw new Error('The Graph 触发限流，请稍后重试');
          throw new Error(`The Graph 请求失败：${message.split(config.graphApiKey).join('***').slice(0, 300)}`);
        }

        const body = responseSchema.parse(raw);
        if (body.errors?.length) {
          throw new Error(`子图返回错误：${body.errors.map((item) => item.message).join('；').slice(0, 300)}`);
        }
        if (body.data === undefined) throw new Error('子图没有返回 data 字段');
        return {
          provider: 'thegraph',
          access: 'api-key',
          subgraphId,
          data: body.data,
          note: '子图数据由第三方索引器提供，可能滞后于链上最新状态。',
        };
      },
    ),
  ];
}
