import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export type McpAuth = 'none' | 'oauth' | 'api-key' | 'account' | 'local';

export interface McpPreset {
  id: string;
  label: string;
  aliases: string[];
  tasks: string[];
  chains: string[];
  workstations: string[];
  transport: 'http' | 'stdio';
  url: string | null;
  auth: McpAuth;
  docs: string;
  note?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  connectionUrl?: string;
  oauth?: boolean;
  requirements?: string[];
}

/**
 * 只登记已核实或明确标注“待按官方文档配置”的入口。
 * 没有可核实公开端点的服务保留 url=null，不伪造地址。
 */
export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'coingecko',
    label: 'CoinGecko',
    aliases: ['coin gecko'], tasks: ['price', '价格', '行情', 'market', '市值', '交易量', 'volume'], chains: ['evm', 'solana'], workstations: ['onchain-data'],
    transport: 'http',
    url: 'https://mcp.api.coingecko.com/mcp',
    auth: 'none',
    docs: 'https://docs.coingecko.com/ai-integration/mcp-server',
    note: '公开 keyless 端点；部分工具可能要求 API key。',
  },
  {
    id: 'alchemy',
    label: 'Alchemy',
    aliases: [], tasks: ['balance', '余额', 'nft', 'rpc', 'token', '代币'], chains: ['evm', 'solana'], workstations: ['onchain-data'], oauth: true,
    transport: 'http',
    url: 'https://mcp.alchemy.com/mcp',
    auth: 'oauth',
    docs: 'https://www.alchemy.com/docs/build-with-ai',
    note: '需要官方 OAuth 授权；账户还要求手机验证。',
  },
  {
    id: 'allium',
    label: 'Allium',
    aliases: [], tasks: ['analytics', '分析', 'sql', '交易量', 'volume', '余额', 'balance'], chains: ['evm', 'solana'], workstations: ['onchain-data'], oauth: true,
    transport: 'http',
    url: 'https://mcp.allium.so',
    auth: 'oauth',
    docs: 'https://docs.allium.so/ai/mcp/overview',
    note: '旧 mcp-oauth.allium.so 将停用，使用当前地址。',
  },
  {
    id: 'tenderly',
    label: 'Tenderly',
    aliases: [], tasks: ['simulate', 'simulation', '模拟', 'debug', '诊断', 'revert', '交易失败'], chains: ['evm'], workstations: ['security-check', 'evm-diagnose'], oauth: true,
    transport: 'http',
    url: 'https://mcp.tenderly.co/mcp',
    auth: 'account',
    docs: 'https://tenderly.co/blog/validating-agentic-workflows-with-tenderly-mcp-server/',
    note: '官方托管 MCP，使用 OAuth 或操作者提供的授权头。',
  },
  {
    id: 'chainstack',
    label: 'Chainstack',
    aliases: ['chain stack'], tasks: ['rpc', 'node', '节点', 'balance', '余额'], chains: ['evm', 'solana'], workstations: ['onchain-data'],
    headers: { Authorization: 'Bearer ${BCA_CHAINSTACK_API_KEY}' },
    transport: 'http',
    url: 'https://mcp.chainstack.com/mcp',
    auth: 'account',
    docs: 'https://github.com/chainstacklabs/mcp-server',
    note: '旧 rpc-nodes-mcp 已废弃；按统一 Chainstack MCP 文档配置。',
  },
  {
    id: 'thirdweb',
    label: 'thirdweb AI',
    aliases: ['thirdweb', 'nebula'], tasks: ['wallet', '钱包', 'nft', 'contract', '合约'], chains: ['evm'], workstations: ['nft-create', 'onchain-data'],
    connectionUrl: 'https://api.thirdweb.com/mcp?secretKey=${BCA_THIRDWEB_SECRET_KEY}',
    transport: 'http',
    url: 'https://api.thirdweb.com/mcp',
    auth: 'account',
    docs: 'https://portal.thirdweb.com/changelog/nebula-is-now-thirdweb-ai',
    note: '原 Nebula；需要带 secretKey 查询参数的完整 URL，参见官方文档。',
  },
  {
    id: 'nansen',
    label: 'Nansen',
    aliases: [], tasks: ['analytics', '分析', 'wallet', '钱包', '资金流', '交易量', 'volume'], chains: ['evm', 'solana'], workstations: ['onchain-data'],
    headers: { 'NANSEN-API-KEY': '${BCA_NANSEN_API_KEY}' },
    transport: 'http',
    url: 'https://mcp.nansen.ai/ra/mcp',
    auth: 'api-key',
    docs: 'https://academy.nansen.ai/articles/2711728-get-started-with-nansen-mcp',
    note: '需要 Nansen 账户/API 权限。',
  },
  {
    id: 'dune',
    label: 'Dune',
    aliases: ['dune analytics'], tasks: ['analytics', '分析', 'sql', 'table', '数据表', '交易量', 'volume', 'protocol', '协议', '链上数据'],
    chains: ['evm', 'solana', 'sui', 'aptos', 'bitcoin', 'near', 'ton', 'tron'], workstations: ['onchain-data'],
    headers: { 'x-dune-api-key': '${BCA_DUNE_API_KEY}' },
    transport: 'http',
    url: 'https://api.dune.com/mcp/v1',
    auth: 'api-key',
    docs: 'https://docs.dune.com/docs/agents/mcp',
    note: '需要 Dune 账户/API 权限。',
  },
  {
    id: 'tokenterminal',
    label: 'Token Terminal',
    aliases: ['token-terminal', 'token terminal'], tasks: ['analytics', '分析', 'revenue', '收入', 'protocol', '协议', 'fees', '费用'], chains: [], workstations: ['onchain-data'], oauth: true,
    transport: 'http',
    url: 'https://mcp.tokenterminal.com/mcp',
    auth: 'oauth',
    docs: 'https://tokenterminal.com/docs/mcp/introduction',
    note: '官方 OAuth 2.1；免费层提供有限 research 调用，订阅影响额度。',
  },
  {
    id: 'messari',
    label: 'Messari',
    aliases: [], tasks: ['research', '研究', 'market', '行情', 'protocol', '协议'], chains: [], workstations: ['onchain-data'], oauth: true,
    transport: 'http',
    url: 'https://mcp.messari.io/mcp',
    auth: 'oauth',
    docs: 'https://docs.messari.io/mcp-server/hosted',
    note: '官方 OAuth 流程使用 Messari API key；数据权限取决于账户。',
  },
  {
    id: 'goplus',
    label: 'GoPlus',
    aliases: ['goplus security', 'go plus'], tasks: ['security', '安全', 'risk', '风险', 'approval', '授权', '恶意地址', 'honeypot', '貔貅'],
    chains: ['evm', 'solana', 'sui'], workstations: ['security-check'],
    transport: 'stdio',
    url: null,
    auth: 'api-key',
    command: 'npx', args: ['-y', 'goplus-mcp@1.0.1', '--key', '${BCA_GOPLUS_API_KEY}', '--secret', '${BCA_GOPLUS_API_SECRET}'],
    docs: 'https://github.com/GoPlusSecurity/goplus-mcp',
    note: '开源 MCP；连接 GoPlus 服务，按官方 README 配置。',
  },
  {
    id: 'openzeppelin',
    label: 'OpenZeppelin',
    aliases: ['open zeppelin', 'oz'], tasks: ['erc20', 'erc721', 'erc1155', 'nft', '生成合约', 'generate contract'], chains: ['evm'], workstations: ['nft-create', 'evm-develop'],
    transport: 'stdio',
    url: null,
    auth: 'local',
    command: 'npx',
    args: ['-y', '@openzeppelin/contracts-mcp@0.8.0'],
    docs: 'https://github.com/OpenZeppelin/openzeppelin-mcp',
    note: '官方 Contracts MCP 固定版本，通过独立进程复用；上游许可 AGPL-3.0-only。',
  },
  {
    id: 'coinbase-wallet', label: 'Coinbase Wallet MCP', transport: 'http',
    aliases: ['coinbase wallet', 'base mcp'], tasks: ['wallet', '钱包', 'balance', '余额', 'transfer', '转账'], chains: ['evm'], workstations: ['onchain-data'], oauth: true,
    url: 'https://wallet-mcp.coinbase.com', auth: 'oauth',
    docs: 'https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp',
    note: '替代旧 Base MCP；由官方钱包授权流程连接。',
  },
  {
    id: 'slither',
    label: 'Slither MCP',
    aliases: ['slither'], tasks: ['security', '安全', 'static analysis', '静态分析', '源码分析', '漏洞', '扫描'], chains: ['evm'], workstations: ['security-check'],
    transport: 'stdio',
    url: null,
    auth: 'local',
    command: 'uvx', args: ['--from', 'git+https://github.com/trailofbits/slither-mcp@17755731bf7aba6e5ed4d72e116d9d394430b1e2', '--with', 'fastmcp==2.14.3', '--with', 'mcp==1.25.0', '--with', 'pydantic==2.12.5', 'slither-mcp'],
    requirements: ['uvx', 'Python >=3.11', '项目所需 Solidity 编译器'],
    docs: 'https://blog.trailofbits.com/2025/11/15/level-up-your-solidity-llm-tooling-with-slither-mcp/',
    note: '本地启动，依赖 Slither 安装。',
  },
  {
    id: 'kaito',
    label: 'Kaito Pro',
    aliases: ['kaito'], tasks: ['research', '研究', '舆情', 'sentiment'], chains: [], workstations: ['onchain-data'],
    transport: 'http',
    url: null,
    auth: 'account',
    docs: 'https://www.pro.kaito.ai/portal',
    note: '本次未核实可供 BCA 直接使用的官方通用 MCP/API。',
  },
];

const PRESET_BY_ID = new Map(MCP_PRESETS.map((preset) => [preset.id, preset]));

type RawServer = {
  readOnlyTools?: unknown;
  preset?: unknown;
  transport?: unknown;
  url?: unknown;
  headers?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  cwd?: unknown;
  description?: unknown;
};

export interface ResolvedStdioServer {
  readOnlyTools: string[];
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  description?: string;
  preset?: string;
}

export interface ResolvedHttpServer {
  readOnlyTools: string[];
  name: string;
  transport: 'http';
  url: string;
  headers: Record<string, string>;
  description?: string;
  preset?: string;
}

export type ResolvedServer = ResolvedStdioServer | ResolvedHttpServer;

export interface ConfiguredMcpService {
  name: string;
  preset: string | null;
  missingEnvironment: string[];
  error: string | null;
  oauth: boolean;
}

interface McpConfiguration {
  servers: Record<string, ResolvedServer>;
  errors: Record<string, string>;
  configured: ConfiguredMcpService[];
}

export interface ProviderMatch {
  preset: McpPreset;
  servers: ConfiguredMcpService[];
  missingEnvironment: string[];
  errors: string[];
  status: 'not_configured' | 'configuration_error' | 'configured' | 'unavailable';
  nextCall: { tool: string; input: Record<string, unknown> } | null;
  requirements: string[];
  matchedAliases: string[];
}

export function presetConfiguration(preset: McpPreset, oauth = preset.oauth ?? false): Record<string, unknown> {
  if (oauth) {
    if (!preset.url) throw new Error(`${preset.label} 没有可使用 OAuth 的托管地址`);
    return { preset: preset.id, command: 'npx', args: ['-y', 'mcp-remote@0.15.2', preset.url] };
  }
  return { preset: preset.id,
    ...(preset.command ? { command: preset.command, args: preset.args ?? [] } : {}),
    ...(preset.connectionUrl ? { url: preset.connectionUrl } : {}),
    ...(preset.headers ? { headers: preset.headers } : {}) };
}

export function missingEnvironment(value: unknown): string[] {
  const variables = new Set<string>();
  function visit(item: unknown): void {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        if (!process.env[match[1]!]) variables.add(match[1]!);
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  }
  visit(value);
  return [...variables].sort();
}

export function includesAlias(query: string, alias: string): boolean {
  const escaped = alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${/^[a-z0-9]/i.test(alias) ? '(?<![a-z0-9])' : ''}${escaped}${/[a-z0-9]$/i.test(alias) ? '(?![a-z0-9])' : ''}`, 'i').test(query);
}

export function identifyChains(query: string, chainFamily?: string) {
  const names = ['evm', 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'solana', 'sui', 'aptos', 'bitcoin', 'near', 'ton', 'tron'];
  const aliases: Record<string, string> = { '以太坊': 'ethereum', '索拉纳': 'solana', '比特币': 'bitcoin' };
  const found = names.filter((name) => includesAlias(query, name));
  for (const [alias, name] of Object.entries(aliases)) if (query.includes(alias)) found.push(name);
  if (chainFamily) found.push(aliases[chainFamily] ?? chainFamily.toLowerCase());
  const evm = new Set(['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche']);
  return { chains: [...new Set(found)], families: [...new Set(found.map((name) => evm.has(name) ? 'evm' : name))] };
}

function presetForRaw(name: string, value: unknown): McpPreset | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as RawServer;
  if (typeof raw.preset === 'string') return PRESET_BY_ID.get(raw.preset);
  const urls = [raw.url, ...(Array.isArray(raw.args) ? raw.args : [])].filter((item): item is string => typeof item === 'string' && /^https?:\/\//.test(item));
  const known = MCP_PRESETS.find((preset) => preset.url && urls.some((value) => {
    const url = new URL(value); const official = new URL(preset.url!);
    return url.origin === official.origin && url.pathname.replace(/\/$/, '') === official.pathname.replace(/\/$/, '');
  }));
  if (known) return known;
  if (!raw.url && !raw.command) return PRESET_BY_ID.get(name);
  return undefined;
}

function connectionFields(server: RawServer, preset?: McpPreset) {
  const command = server.command ?? (server.url ? undefined : preset?.command);
  const url = server.url ?? (command ? undefined : preset?.connectionUrl ?? preset?.url ?? undefined);
  return { command, url,
    args: command ? server.args ?? (server.command ? undefined : preset?.args) : undefined,
    env: command ? server.env : undefined,
    headers: url ? server.headers ?? (server.url ? undefined : preset?.headers) : undefined };
}

const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function expand(value: string, where: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const resolved = process.env[name];
    if (!resolved) throw new Error(`MCP 配置 ${where} 引用了未设置的环境变量 ${name}`);
    if (/[\r\n\0]/.test(resolved)) throw new Error(`MCP 配置 ${where} 的环境变量 ${name} 包含非法字符`);
    return resolved;
  });
}

function stringRecord(value: unknown, where: string, namePattern: RegExp): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`MCP 配置 ${where} 必须为对象`);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!namePattern.test(key)) throw new Error(`MCP 配置 ${where} 包含非法名称 ${key}`);
    if (typeof item !== 'string') throw new Error(`MCP 配置 ${where}.${key} 必须为字符串`);
    result[key] = expand(item, `${where}.${key}`);
  }
  return result;
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) throw new Error(`MCP 配置 ${where} 必须为非空字符串`);
  return value;
}

function parseServer(name: string, raw: unknown): ResolvedServer {
  if (!SERVER_NAME.test(name)) throw new Error(`MCP 服务名 ${name} 非法`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`MCP 服务 ${name} 必须为对象`);
  const server = raw as RawServer;
  if (server.readOnlyTools !== undefined && (!Array.isArray(server.readOnlyTools) || !server.readOnlyTools.every((item) => typeof item === 'string' && item.length > 0))) throw new Error(`MCP 服务 ${name}.readOnlyTools 必须为工具名数组`);
  const readOnlyTools = (server.readOnlyTools ?? []) as string[];
  const presetId = optionalString(server.preset, `${name}.preset`);
  const preset = presetId ? PRESET_BY_ID.get(presetId) : undefined;
  if (presetId && !preset) throw new Error(`MCP 服务 ${name} 的 preset ${presetId} 未知`);
  const description = optionalString(server.description, `${name}.description`);
  const explicitUrl = optionalString(server.url, `${name}.url`);
  const explicitCommand = optionalString(server.command, `${name}.command`);
  const commandValue = explicitCommand ?? (explicitUrl ? undefined : preset?.command);
  const urlValue = explicitUrl ?? (commandValue ? undefined : preset?.connectionUrl ?? preset?.url ?? undefined);

  if (urlValue && commandValue) throw new Error(`MCP 服务 ${name} 不能同时配置 url 和 command`);
  if (urlValue) {
    const url = expand(urlValue, `${name}.url`);
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`MCP 服务 ${name}.url 必须为有效 URL`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`MCP 服务 ${name}.url 必须为 HTTP(S)`);
    if (parsed.username || parsed.password) throw new Error(`MCP 服务 ${name}.url 不能包含凭据`);
    const headers = stringRecord(server.headers ?? (explicitUrl ? undefined : preset?.headers), `${name}.headers`, HEADER_NAME);
    for (const [key, value] of Object.entries(headers)) {
      if (/[\r\n\0]/.test(value)) throw new Error(`MCP 服务 ${name}.headers.${key} 包含非法字符`);
    }
    return { name, transport: 'http', url, headers, description, preset: presetId, readOnlyTools };
  }

  if (!commandValue) throw new Error(`MCP 服务 ${name} 需要 url 或 command`);
  const command = expand(commandValue, `${name}.command`);
  if (/[\r\n\0]/.test(command)) throw new Error(`MCP 服务 ${name}.command 包含非法字符`);
  const rawArgs = server.args ?? (explicitCommand ? undefined : preset?.args);
  if (rawArgs !== undefined && !Array.isArray(rawArgs)) throw new Error(`MCP 服务 ${name}.args 必须为数组`);
  const args = (rawArgs ?? []).map((item, index) => {
    if (typeof item !== 'string') throw new Error(`MCP 服务 ${name}.args[${index}] 必须为字符串`);
    return expand(item, `${name}.args[${index}]`);
  });
  const env = stringRecord(server.env, `${name}.env`, ENV_NAME);
  const cwd = optionalString(server.cwd, `${name}.cwd`);
  return { name, transport: 'stdio', command, args, env, cwd, description, preset: presetId, readOnlyTools };
}

function parseDocument(text: string, source: string): McpConfiguration {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error(`${source} 不是有效 JSON`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${source} 必须为 JSON 对象`);
  const document = raw as Record<string, unknown>;
  const map = document.mcpServers ?? document;
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`${source}.mcpServers 必须为对象`);
  const entries = Object.entries(map as Record<string, unknown>);
  if (entries.length > 64) throw new Error('MCP 服务数量超过 64');
  const servers: Record<string, ResolvedServer> = {};
  const errors: Record<string, string> = {};
  const configured: ConfiguredMcpService[] = [];
  for (const [name, value] of entries) {
    let preset: McpPreset | undefined;
    let required: string[] = [];
    try {
      preset = presetForRaw(name, value);
      const raw = value as RawServer;
      if (value && typeof value === 'object' && !Array.isArray(value)) required = missingEnvironment(connectionFields(raw, preset));
      servers[name] = parseServer(name, preset ? { preset: preset.id, ...raw } : value);
    } catch (error) { errors[name] = error instanceof Error ? error.message : '配置无效'; }
    const args = value && typeof value === 'object' ? (value as RawServer).args : undefined;
    const oauth = Array.isArray(args) && args.some((arg) => typeof arg === 'string' && /^mcp-remote(?:@|$)/.test(arg));
    configured.push({ name, preset: preset?.id ?? null, missingEnvironment: required, error: errors[name] ?? null, oauth });
  }
  return { servers, errors, configured };
}

export function configSource(workingRoot = process.env.BCA_WORKING_ROOT || process.cwd()): { inline: boolean; file: string | null } {
  const inline = Boolean(process.env.BCA_MCP_SERVERS);
  const projectFile = resolve(workingRoot, '.bca/mcp.json');
  return { inline, file: process.env.BCA_MCP_CONFIG ?? (!inline && existsSync(projectFile) ? projectFile : null) };
}

export async function loadMcpConfiguration(workingRoot = process.env.BCA_WORKING_ROOT || process.cwd()): Promise<McpConfiguration> {
  const inline = process.env.BCA_MCP_SERVERS;
  const file = configSource(workingRoot).file;
  if (inline && file) throw new Error('BCA_MCP_SERVERS 与 BCA_MCP_CONFIG 只能设置一个');
  if (!inline && !file) return { servers: {}, errors: {}, configured: [] };
  if (inline) {
    return parseDocument(inline, 'BCA_MCP_SERVERS');
  }
  const path = isAbsolute(file!) ? file! : resolve(process.cwd(), file!);
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('BCA_MCP_CONFIG 文件超过 1MB');
  return parseDocument(text, 'BCA_MCP_CONFIG');
}

export async function loadMcpServers(workingRoot = process.env.BCA_WORKING_ROOT || process.cwd()): Promise<Record<string, ResolvedServer>> {
  return (await loadMcpConfiguration(workingRoot)).servers;
}

export async function inspectProviders(query: string, workingRoot?: string, provider?: string): Promise<{ explicit: boolean; matches: ProviderMatch[]; ambiguity: string | null }> {
  const configuration = await loadMcpConfiguration(workingRoot);
  const candidates = MCP_PRESETS.map((preset) => {
    const allServers = configuration.configured.filter((server) => server.preset === preset.id);
    const namedServers = allServers.filter((server) => provider ? server.name.toLowerCase() === provider.toLowerCase() : includesAlias(query, server.name));
    const servers = namedServers.length ? namedServers : allServers;
    const aliases = [...new Set([preset.id, preset.label, ...preset.aliases, ...allServers.map((server) => server.name)])];
    const matchedAliases = aliases.filter((alias) => provider ? alias.toLowerCase() === provider.toLowerCase() : includesAlias(query, alias));
    const missing = servers.length ? [...new Set(servers.flatMap((server) => server.missingEnvironment))] : missingEnvironment(presetConfiguration(preset));
    const errors = servers.flatMap((server) => server.error ? [server.error] : []);
    const connectable = !!(preset.url || preset.command);
    const status: ProviderMatch['status'] = servers.length ? errors.length ? 'configuration_error' : 'configured' : connectable ? 'not_configured' : 'unavailable';
    const nextCall = servers.length === 1 ? { tool: 'bridge_refresh', input: { server: servers[0]!.name } }
      : !servers.length && connectable ? { tool: 'bridge_configure', input: { preset: preset.id, submit: true } } : null;
    return { preset, servers, missingEnvironment: missing, errors, status, nextCall,
      requirements: [...(preset.requirements ?? []), ...((servers.length ? servers.some((server) => server.oauth) : preset.oauth) ? ['首次连接需要账户 OAuth 授权'] : [])], matchedAliases };
  });
  const explicit = !!provider || candidates.some((candidate) => candidate.matchedAliases.length);
  const matches = explicit ? candidates.filter((candidate) => candidate.matchedAliases.length) : candidates;
  const ambiguity = explicit && matches.length > 1 ? '指定了多个供应商，请选择需要连接的服务'
    : explicit && matches.some((candidate) => candidate.servers.length > 1) ? '供应商存在多个配置，请通过 server 选择配置名'
    : provider && !matches.length ? `未找到供应商或配置别名 ${provider}` : null;
  return { explicit, matches, ambiguity };
}

export function describeServers(servers: Record<string, ResolvedServer>) {
  return Object.values(servers).map((server) => server.transport === 'http'
    ? {
        name: server.name,
        transport: server.transport,
        endpoint: (() => { const url = new URL(server.url); return url.origin; })(),
        headerNames: Object.keys(server.headers).sort(),
        preset: server.preset ?? null,
        description: server.description ?? null,
        connectionVerified: false,
      }
    : {
        name: server.name,
        transport: server.transport,
        command: server.command.split(/[\\/]/).pop(),
        argsCount: server.args.length,
        envNames: Object.keys(server.env).sort(),
        cwd: server.cwd ?? null,
        preset: server.preset ?? null,
        description: server.description ?? null,
        connectionVerified: false,
      });
}

export function presetList() {
  return MCP_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    aliases: preset.aliases,
    tasks: preset.tasks,
    chains: preset.chains,
    workstations: preset.workstations,
    transport: preset.transport,
    url: preset.url,
    auth: preset.auth,
    docs: preset.docs,
    note: preset.note ?? null,
  }));
}

export function presetUrl(id: string): string | null {
  return PRESET_BY_ID.get(id)?.url ?? null;
}
