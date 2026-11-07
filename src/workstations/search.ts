import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool, type ToolDefinition } from '../types.js';
import type { BridgeSessions } from '../bridge/session.js';
import { isReadOnlyUpstream } from '../bridge/index.js';
import { identifyChains, includesAlias, inspectProviders, loadMcpConfiguration, type ProviderMatch } from '../bridge/config.js';
import { capabilityStatus, goplusPublicProvider, isTokenSecurityQuery, usesPublicGoPlus } from './catalog.js';

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
  ['backtest', '回测', 'walkforward'], ['ohlcv', 'candle', '历史行情', 'k线', '历史k线'],
  ['funding', '资金费率', 'fundingrate'], ['pnl', '盈亏', '收益归因', 'attribution'],
  ['sharpe', '夏普', 'drawdown', '回撤'], ['slippage', '滑点', 'spread'],
  ['mev', '三明治', 'sandwich'], ['arbitrage', '套利'],
  ['trades', '逐笔成交', '成交记录', '成交明细'], ['fees', '费率表', '手续费', 'taker', 'maker'],
];
// BCA-P1: 已落地的量化输入能力。capabilityGap 必须如实反映「有什么」与「还缺什么」，不能继续宣称全缺。
const QUANT_INPUT_TOOLS = new Set(['ccxt_ticker', 'ccxt_orderbook', 'ccxt_ohlcv', 'ccxt_funding_rate', 'ccxt_trades', 'ccxt_fees']);
// BCA-P0-1: 中文整词词典。避免「交易手续费」被 2-gram 切成「交易」而误召回全部 transaction 工具。
const CHINESE_LEXICON = [
  '交易手续费', '收益归因', '已实现盈亏', '夏普比率', '最大回撤', '量化交易', '三明治攻击', '策略收益率',
  '历史行情', '成交回报', '资金费率', '交易成本', '资金流向', '订单簿', '交易量', '手续费', '收益率',
  '归因', '盈亏', '回撤', '夏普', '滑点', '套利', '回测', '费率', '成本', '持仓', '净收益', '余额',
];
const LEXICON_SET = new Set(CHINESE_LEXICON);
const LEXICON_SORTED = [...CHINESE_LEXICON].sort((a, b) => b.length - a.length);
const WEAK_TOKENS = new Set(['线', '计算', '策略', '数据', '查询', '交易', '费用', '手续', '续费', '历史', '结果', '信息', '一个', '一下', '如何', '怎么']);
function markLexicon(text: string) {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = LEXICON_SORTED.find((word) => text.startsWith(word, i));
    if (hit) { out.push(' ', hit, ' '); i += hit.length; }
    else { out.push(text.charAt(i)); i += 1; }
  }
  return out.join('');
}
const QUANT_INTENTS = [
  { id: 'backtest', aliases: ['回测', 'backtest', 'walk.forward'], tokens: ['backtest', 'walkforward'], missing: ['回测引擎与成交模拟', '样本外 / walk-forward 检验', '策略净值序列与绩效指标'], providers: ['coingecko', 'dune'] },
  { id: 'ohlcv', aliases: ['ohlcv', 'k线', 'candle', '历史行情', '历史k线'], tokens: ['ohlcv', 'candle', 'kline', 'ccxt_ohlcv'], missing: ['多交易所历史对齐', '长区间历史数据'], providers: ['coingecko', 'dune'] },
  { id: 'funding', aliases: ['资金费率', 'funding'], tokens: ['funding', 'fundingrate', 'ccxt_funding_rate'], missing: ['资金费率历史序列', '持仓成本序列'], providers: ['dune'] },
  { id: 'pnl', aliases: ['pnl', '盈亏', '收益归因', 'attribution', '已实现盈亏', '净收益'], tokens: ['pnl', 'cost_basis', 'costbasis'], missing: ['cost basis', 'realized / unrealized PnL', '可对账恒等式'], providers: ['nansen', 'dune'] },
  { id: 'risk-metrics', aliases: ['夏普', 'sharpe', '回撤', 'drawdown'], tokens: ['sharpe', 'drawdown'], missing: ['绩效指标计算', '回测净值序列'], providers: ['dune'] },
  { id: 'slippage', aliases: ['滑点', 'slippage', '价差', 'spread'], tokens: ['slippage', 'spread', 'impact'], missing: ['订单簿深度快照历史', '冲击模型', '成交回报归因'], providers: ['coingecko'] },
  { id: 'mev', aliases: ['mev', '三明治', 'sandwich', '抢跑'], tokens: ['mev', 'sandwich'], missing: ['mempool / bundle 数据', 'MEV 归因'], providers: ['dune'] },
  { id: 'arbitrage', aliases: ['套利', 'arbitrage'], tokens: ['arbitrage'], missing: ['跨所价差', '实时深度对齐'], providers: ['coingecko'] },
  { id: 'trades', aliases: ['逐笔成交', '成交记录', '成交明细', 'trades'], tokens: ['trades', 'ccxt_trades'], missing: ['全市场逐笔历史', '成交方向标注'], providers: ['coingecko'] },
  { id: 'trading-cost', aliases: ['交易手续费', '交易成本', '手续费', '费率', '费率表', 'gas 费用', 'gas费', 'gas cost'], tokens: ['fee_rate', 'trading_fee', 'gas_cost', 'ccxt_fees', 'fees'], missing: ['gas 成本', '账户实际成交费率', '成本归因入账'], providers: ['coingecko'] },
  { id: 'yield', aliases: ['收益率', '成交回报'], tokens: ['roi', 'net_pnl'], missing: ['净收益口径', '成本扣除'], providers: ['nansen', 'dune'] },
];
type QuantIntent = (typeof QUANT_INTENTS)[number];
function detectQuantIntent(query: string): QuantIntent | null {
  const q = query.toLowerCase();
  return QUANT_INTENTS.find((item) => item.aliases.some((alias) => q.includes(alias))) ?? null;
}
type GapProvider = { id: string; status?: string | null; connectCall?: unknown; nextCall?: unknown };
function buildCapabilityGap(query: string, intent: QuantIntent | null, providers: GapProvider[], availableCapabilities: string[] = []) {
  const recommended = providers.map((p) => ({ id: p.id, status: p.status ?? null,
    connectCall: p.connectCall ?? p.nextCall ?? null }));
  const fallback = intent ? intent.providers.map((id) => ({ id, status: 'not_configured',
    connectCall: { tool: 'bridge_configure', input: { preset: id, submit: true } } })) : [];
  const list: GapProvider[] = recommended.length ? recommended : fallback;
  const base = { code: 'NO_LOCAL_CAPABILITY', query, intent: null as string | null,
    message: '本工具箱当前没有可直接调用的本地能力；请勿用名称相近的工具替代。',
    missingCapabilities: [] as string[], availableCapabilities,
    recommendedProviders: list,
    connectCall: list.find((p) => p.connectCall)?.connectCall ?? null,
    note: '能力边界是显式声明，不是调用失败。availableCapabilities 是本工具箱已可提供的数据输入，可直接调用。' };
  if (!intent) return base;
  return { ...base, code: 'QUANT_CAPABILITY_GAP', intent: intent.id,
    message: `本工具箱没有「${intent.id}」能力：不要把 forge test、EAS 声明等名称相近的工具当作替代。${availableCapabilities.length ? ` 已可用的支撑输入：${availableCapabilities.join('、')}。` : ''}`,
    missingCapabilities: intent.missing };
}
const stop = new Set(['a', 'an', 'the', 'my', 'me', 'to', 'for', 'of', 'in', 'on', 'use', 'using', 'with',
  'query', 'read', 'data', 'get', 'find', 'create', 'generate', 'please', 'help', 'list',
  '请帮', '帮我', '一下', '一个', '如何', '怎么', '查询', '数据', '读取', '生成', '创建', '列出', '用', '在', '的', '请', '我', '帮',
  'evm', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'solana', 'sui', 'aptos', 'bitcoin', 'near', 'ton', 'tron', '链上', '以太', '太坊']);
const specificConcepts = new Set(['balance', 'erc721', 'cid', 'ticker', 'orderbook', 'volume', 'simulation', 'scan']);
function words(text: string) {
  let cleaned = text.toLowerCase().replace(/请帮|帮我|一下|一个|如何|怎么|查询|数据(?!表)|读取|生成|创建|列出/g, ' ');
  cleaned = cleaned.replace(/历史k线|k线|ohlcv/g, '历史行情');
  cleaned = markLexicon(cleaned);
  const parts = cleaned.match(/[a-z0-9_]+|[\u3400-\u9fff]+/g) ?? [];
  return [...new Set(parts.flatMap((part) => LEXICON_SET.has(part) ? [part]
    : /^[\u3400-\u9fff]+$/.test(part) && part.length > 2
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
  const matchScore = matches.reduce((sum, word) => sum + (WEAK_TOKENS.has(word) ? 0.5 : 2), 0);
  return { score: (input === name.toLowerCase() ? 100 : 0) + matchScore + concepts.length * 3,
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
      let inspected = await inspectProviders(query, config.workingRoot, localProvider ? undefined : provider);
      const publicProvider = provider?.toLowerCase() === goplusPublicProvider && !inspected.matches.length;
      if (publicProvider) inspected = await inspectProviders(query, config.workingRoot, 'goplus');
      const selected = inspected.explicit ? inspected.matches : [];
      const publicGoPlus = !server && (publicProvider || (selected.length === 1 && isTokenSecurityQuery(query) && usesPublicGoPlus(selected[0], provider, query)));
      const providerMatches = inspected.explicit ? selected : inspected.matches.filter((item) =>
        rank(query, item.preset.id, item.preset.tasks.join(' '), true).score > 0 && (!chains.families.length || !item.preset.chains.length || supportsChains(item.preset.chains, chains.families)));
      const providers = publicGoPlus ? [{ id: 'goplus', label: 'GoPlus Token Security API', access: 'public', status: 'available', supportedChains: ['evm'],
        docs: 'https://docs.gopluslabs.io/reference/tokensecurityusingget_1', requirements: [], nextCall: { tool: 'capability_list', input: { name: 'goplus_token_security' } } }]
        : providerMatches.map((match) => providerResult(match, chains.families));
      const contextChains = identifyChains('', chainFamily).families;
      const chainConflict = contextChains.length && identifyChains(query).families.some((chain) => !contextChains.includes(chain));
      const providerConflict = publicGoPlus ? !supportsChains(['evm'], chains.families) : selected.some((item) => item.preset.chains.length && !supportsChains(item.preset.chains, chains.families));
      if (chainConflict || providerConflict) return { source: inspected.explicit ? 'provider' : 'catalog', providers, chains, total: 0, matches: [], nextOffset: null,
        ambiguity: chainConflict ? '问题中的链与 chainFamily 不一致，请明确目标链' : '指定供应商的已登记链范围不包含请求链，请确认供应商支持情况' };
      let selectedServer = server;
      if (!server && !publicGoPlus && selected.length === 1 && !inspected.ambiguity && selected[0]!.status === 'configured') selectedServer = selected[0]!.servers[0]!.name;
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
              cost: null, trust: null, note: '上游真实目录，尚无本地成本与信任标注',
              requiredInputs: tool.inputSchema.required ?? [], ...(details ? { inputSchema: tool.inputSchema } : {}),
              schemaCall: { tool: 'capability_search', input: { server: selectedServer, query: tool.name, details: true, limit: 1 } },
              call: { tool: 'bridge_call', input: { server: selectedServer, tool: tool.name, arguments: {}, ...(!readOnly ? { submit: true } : {}) } },
              status: readOnly || config.allowWrites ? 'discovered' : 'missing_authorization',
            })), note: '真实上游目录已读取；宿主按 Schema 补全参数，查询执行可能消耗账户额度。' };
        });
      }
      if (inspected.explicit && !publicGoPlus) return { source: 'provider', providers, chains, total: 0, matches: [], nextOffset: null,
        ambiguity: inspected.ambiguity, reason: selected.length ? '先完成指定供应商的连接条件，再读取真实工具目录' : '未找到匹配供应商' };
      let matches = getTools().filter((tool) => {
        if (publicGoPlus && tool.name !== 'goplus_token_security') return false;
        if (tool.name === 'goplus_token_security' && !isTokenSecurityQuery(query)) return false;
        const source = (tool.metadata?.source as { name?: string } | undefined)?.name ?? '';
        if (localProvider === 'foundry' && source.includes('hardhat')) return false;
        if (localProvider === 'hardhat' && source.startsWith('@foundry-rs/')) return false;
        return supportsChains((tool.metadata?.targets as string[] | undefined) ?? [], chains.families)
          && (readOnly === undefined || tool.readOnly === readOnly);
      })
        .map((tool) => ({ tool, ...rank(query, tool.name, tool.description, true) }))
        .filter((item) => item.score >= 2).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
      // 量化意图下只认「名称或描述真的含该能力词」的工具：概念分不能把近似工具伪装成能力。
      const quantIntent = publicGoPlus ? null : detectQuantIntent(query);
      // 白名单只用无歧义的能力标识（中文子串会撞上「返「回测」试」这类词，不能用中文别名）。
      if (quantIntent)
        matches = matches.filter((item) => quantIntent.tokens.some((token) => includesAlias(`${item.tool.name} ${item.tool.description}`, token)));
      const quantInputs = getTools().filter((tool) => QUANT_INPUT_TOOLS.has(tool.name)).map((tool) => tool.name);
      const capabilityGap = matches.length || publicGoPlus ? null : buildCapabilityGap(query, quantIntent, providers as GapProvider[], quantInputs);
      return { source: publicGoPlus ? { provider: 'goplus', access: 'public' } : 'catalog', providers, chains, total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null,
        matches: await Promise.all(matches.slice(offset, offset + limit).map(async ({ tool, score, reasons }) => {
          const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' });
          return { name: tool.name, description: tool.description, readOnly: tool.readOnly, score, reasons,
            cost: tool.metadata?.cost ?? null, trust: tool.metadata?.trust ?? null,
            requiredInputs: schema.required ?? [], ...(details ? { inputSchema: schema } : {}),
            availability: await capabilityStatus(tool, config, dir),
            schemaCall: { tool: 'capability_list', input: { name: tool.name, dir } }, call: { tool: tool.name, input: {} } };
        })), ...(capabilityGap ? { capabilityGap } : {}),
        reason: publicGoPlus ? matches.length ? 'GoPlus 官方公开 EVM 代币风险查询' : '公开入口仅支持 ERC20 代币风险查询，请明确代币任务' : matches.length || providers.length ? '按任务匹配；选择供应商后读取真实目录' : '未找到匹配能力；capabilityGap 已显式说明边界',
        note: publicGoPlus ? '按 Schema 提供 chainId 和 ERC20 合约地址；保留原始风险字段与上游错误。' : '按原工具 Schema 补全参数后调用；find 不写入服务配置。' };
    })];
}
