import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool, type ToolDefinition } from '../types.js';
import type { BridgeSessions } from '../bridge/session.js';
import { isReadOnlyUpstream } from '../bridge/index.js';
import { identifyChains, includesAlias, inspectProviders, loadMcpConfiguration, type ProviderMatch } from '../bridge/config.js';
import { capabilityStatus } from './catalog.js';

// 词汇只用于匹配实际目录，复杂任务由宿主补全。
const vocabulary = [
  ['balance', '余额', 'lamports'], ['transaction', '交易', 'tx', '回执'], ['revert', '失败', '回滚', 'diagnose'],
  ['compile', '编译', 'build'], ['test', '测试'], ['deploy', '部署'], ['contract', '合约', 'solidity'],
  ['erc20', '代币', 'token'], ['erc721', 'erc1155', 'nft'], ['attestation', '声明', 'attest', '存证'], ['schema', '模式', '字段'],
  ['sign', '签名', 'signature'], ['verify', '验证', '校验'], ['revoke', '撤销'], ['cid', '内容标识'],
  ['ipfs', '去中心化存储'], ['file', '文件'], ['ticker', '行情', '价格'], ['exchange', '交易所', 'ccxt'],
  ['orderbook', '订单簿', '深度'], ['identity', '身份', 'did'], ['encrypt', '加密', 'seal'],
  ['source', '源码'], ['trace', '调用轨迹'], ['proxy', '代理'], ['event', '事件', 'logs', '日志'],
  ['scan', '扫描', '漏洞', 'security', '安全', 'risk', '风险', 'slither', 'audit', '审计'], ['volume', '交易量'],
  ['simulation', 'simulate', '模拟'], ['analytics', '分析', 'sql', 'table', '数据表'],
];
const stop = new Set(['a', 'an', 'the', 'my', 'me', 'to', 'for', 'of', 'in', 'on', 'use', 'using', 'with',
  'query', 'read', 'data', 'get', 'find', 'create', 'generate', 'please', 'help', 'list',
  '请帮', '帮我', '一下', '一个', '如何', '怎么', '查询', '数据', '读取', '生成', '创建', '列出', '用', '在', '的', '请', '我', '帮',
  'evm', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'solana', 'sui', 'aptos', 'bitcoin', 'near', 'ton', 'tron', '链上', '以太', '太坊']);
const specificConcepts = new Set(['balance', 'erc721', 'cid', 'ticker', 'orderbook', 'volume', 'simulation', 'scan']);

function words(text: string) {
  const cleaned = text.toLowerCase().replace(/请帮|帮我|一下|一个|如何|怎么|查询|数据(?!表)|读取|生成|创建|列出/g, ' ');
  const parts = cleaned.match(/[a-z0-9_]+|[\u3400-\u9fff]+/g) ?? [];
  return [...new Set(parts.flatMap((part) => /^[\u3400-\u9fff]+$/.test(part) && part.length > 2
    ? Array.from({ length: part.length - 1 }, (_, i) => part.slice(i, i + 2)) : [part]).filter((part) => !stop.has(part)))];
}

function rank(query: string, name: string, description: string, requireObject = false) {
  const input = query.toLowerCase(); const text = `${name} ${description}`.toLowerCase();
  const requested = vocabulary.filter((group) => group.some((word) => includesAlias(input, word)));
  const concepts = requested.filter((group) => group.some((word) => includesAlias(text, word)));
  const specific = requested.filter((group) => specificConcepts.has(group[0]!));
  if (requireObject && requested.some((group) => group[0] === 'scan') && !concepts.some((group) => group[0] === 'scan')) return { score: 0, reasons: [] as string[] };
  if (requireObject && specific.length && !specific.some((group) => concepts.includes(group))) return { score: 0, reasons: [] as string[] };
  const actions = requested.filter((group) => ['compile', 'test', 'deploy'].includes(group[0]!));
  if (requireObject && actions.length && !actions.some((group) => concepts.includes(group))) return { score: 0, reasons: [] as string[] };
  const matches = words(input).filter((word) => includesAlias(text, word));
  return { score: (input === name.toLowerCase() ? 100 : 0) + matches.length * 2 + concepts.length * 3,
    reasons: [...new Set([...matches, ...concepts.map((group) => group[0]!)])] };
}

function supportsChains(targets: string[], chains: string[]) {
  return !chains.length || targets.includes('any') || chains.every((chain) => targets.includes(chain));
}

function providerResult(match: ProviderMatch, chains: string[]) {
  const supported = !chains.length || supportsChains(match.preset.chains, chains);
  return { id: match.preset.id, label: match.preset.label, workstations: match.preset.workstations,
    supportedChains: match.preset.chains, chainSupport: supported ? 'listed' : match.preset.chains.length ? 'not_listed' : 'requires_discovery',
    status: match.status, servers: match.servers, missingEnvironment: match.missingEnvironment,
    errors: match.errors, requirements: match.requirements, docs: match.preset.docs, note: match.preset.note,
    connectCall: match.servers.length ? null : match.nextCall, nextCall: match.nextCall };
}

export const capabilitySearchSchema = z.strictObject({
  query: z.string().min(1), dir: z.string().default('.'), chainFamily: z.string().optional(), provider: z.string().optional(),
  server: z.string().optional().describe('显式连接一个已配置 MCP 并搜索其最新工具'),
  limit: z.number().int().min(1).max(100).default(8), offset: z.number().int().min(0).default(0),
  readOnly: z.boolean().optional(), details: z.boolean().default(false),
});

export function searchTools(config: Config, getTools: () => ToolDefinition[], sessions: BridgeSessions) {
  return [defineTool('capability_search', '按任务查找内置工具与官方供应商；指定服务后发现真实目录，返回缺项、Schema 入口及实际调用入口。', capabilitySearchSchema, true,
    async ({ query, dir, chainFamily, provider, server, limit, offset, readOnly, details }) => {
      const chains = identifyChains(query, chainFamily);
      const localProvider = provider && ['foundry', 'hardhat', 'rpc', 'viem'].includes(provider.toLowerCase()) ? provider.toLowerCase() : undefined;
      const inspected = await inspectProviders(query, config.workingRoot, localProvider ? undefined : provider);
      const selected = inspected.explicit ? inspected.matches : [];
      const providerMatches = inspected.explicit ? selected : inspected.matches.filter((item) =>
        rank(query, item.preset.id, item.preset.tasks.join(' '), true).score > 0 && (!chains.families.length || !item.preset.chains.length || supportsChains(item.preset.chains, chains.families)));
      const providers = providerMatches.map((match) => providerResult(match, chains.families));
      let selectedServer = server;
      if (!server && selected.length === 1 && !inspected.ambiguity && selected[0]!.status === 'configured') selectedServer = selected[0]!.servers[0]!.name;
      if (server && selected.length) {
        if (!selected.some((item) => item.servers.some((entry) => entry.name === server))) throw new Error(`指定供应商与 MCP 配置 ${server} 不一致`);
      }
      if (selectedServer) {
        const configuration = await loadMcpConfiguration(config.workingRoot);
        const configured = configuration.configured.find((item) => item.name === selectedServer);
        const service = inspected.matches.find((item) => item.preset.id === configured?.preset);
        if (service && chains.families.length && service.preset.chains.length && !supportsChains(service.preset.chains, chains.families)) {
          return { source: 'provider', providers: [providerResult(service, chains.families)], chains, total: 0, matches: [], nextOffset: null,
            ambiguity: '指定供应商的已登记链范围不包含请求链，请确认供应商支持情况' };
        }
        return sessions.use(selectedServer, undefined, async (_client, resolved, entry) => {
          const snapshot = await sessions.list(entry, true);
          const aliases = service ? [service.preset.id, service.preset.label, ...service.preset.aliases, ...service.servers.map((item) => item.name)] : [selectedServer!];
          let taskQuery = query;
          for (const alias of aliases) {
            const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = `${/^[a-z0-9]/i.test(alias) ? '(?<![a-z0-9])' : ''}${escaped}${/[a-z0-9]$/i.test(alias) ? '(?![a-z0-9])' : ''}`;
            taskQuery = taskQuery.replace(new RegExp(pattern, 'ig'), ' ');
          }
          const specificTask = vocabulary.some((group) => group.some((word) => includesAlias(taskQuery, word)));
          const generic = !words(taskQuery).length && !specificTask;
          const matches = snapshot.tools.map((tool) => ({ tool, readOnly: isReadOnlyUpstream(resolved, tool.name), ...rank(taskQuery, tool.name, tool.description ?? '') }))
            .filter((item) => (generic || item.score > 0) && (readOnly === undefined || item.readOnly === readOnly))
            .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
          return { source: { server: selectedServer, schemaDigest: snapshot.schemaDigest }, providers: service ? [providerResult(service, chains.families)] : providers,
            chains, total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null,
            matches: matches.slice(offset, offset + limit).map(({ tool, readOnly, score, reasons }) => ({
              name: tool.name, description: tool.description, readOnly, score, reasons,
              requiredInputs: tool.inputSchema.required ?? [], ...(details ? { inputSchema: tool.inputSchema } : {}),
              schemaCall: { tool: 'capability_search', input: { server: selectedServer, query: tool.name, details: true, limit: 1 } },
              call: { tool: 'bridge_call', input: { server: selectedServer, tool: tool.name, arguments: {}, ...(!readOnly ? { submit: true } : {}) } },
              status: readOnly || config.allowWrites ? 'discovered' : 'missing_authorization',
            })), note: '真实上游目录已读取；宿主按 Schema 补全参数，查询执行可能消耗账户额度。' };
        });
      }
      if (inspected.explicit) return { source: 'provider', providers, chains, total: 0, matches: [], nextOffset: null,
        ambiguity: inspected.ambiguity, reason: selected.length ? '先完成指定供应商的连接条件，再读取真实工具目录' : '未找到匹配供应商' };
      const matches = getTools().filter((tool) => {
        const source = (tool.metadata?.source as { name?: string } | undefined)?.name ?? '';
        if (localProvider === 'foundry' && source.includes('hardhat')) return false;
        if (localProvider === 'hardhat' && source.startsWith('@foundry-rs/')) return false;
        return supportsChains((tool.metadata?.targets as string[] | undefined) ?? [], chains.families)
          && (readOnly === undefined || tool.readOnly === readOnly);
      })
        .map((tool) => ({ tool, ...rank(query, tool.name, tool.description, true) }))
        .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
      return { source: 'catalog', providers, chains, total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null,
        matches: await Promise.all(matches.slice(offset, offset + limit).map(async ({ tool, score, reasons }) => {
          const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' });
          return { name: tool.name, description: tool.description, readOnly: tool.readOnly, score, reasons,
            requiredInputs: schema.required ?? [], ...(details ? { inputSchema: schema } : {}),
            availability: await capabilityStatus(tool, config, dir),
            schemaCall: { tool: 'capability_list', input: { name: tool.name, dir } }, call: { tool: tool.name, input: {} } };
        })), reason: matches.length || providers.length ? '按任务匹配；选择供应商后读取真实目录' : '未找到匹配能力',
        note: '按原工具 Schema 补全参数后调用；find 不写入服务配置。' };
    })];
}
