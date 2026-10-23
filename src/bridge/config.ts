import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export type McpAuth = 'none' | 'oauth' | 'api-key' | 'account' | 'local';

export interface McpPreset {
  id: string;
  label: string;
  transport: 'http' | 'stdio';
  url: string | null;
  auth: McpAuth;
  docs: string;
  note?: string;
  command?: string;
  args?: string[];
}

/**
 * 只登记已核实或明确标注“待按官方文档配置”的入口。
 * 没有可核实公开端点的服务保留 url=null，不伪造地址。
 */
export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'coingecko',
    label: 'CoinGecko',
    transport: 'http',
    url: 'https://mcp.api.coingecko.com/mcp',
    auth: 'none',
    docs: 'https://docs.coingecko.com/ai-integration/mcp-server',
    note: '公开 keyless 端点；部分工具可能要求 API key。',
  },
  {
    id: 'alchemy',
    label: 'Alchemy',
    transport: 'http',
    url: 'https://mcp.alchemy.com/mcp',
    auth: 'oauth',
    docs: 'https://www.alchemy.com/docs/build-with-ai',
    note: '需要官方 OAuth 授权；账户还要求手机验证。',
  },
  {
    id: 'allium',
    label: 'Allium',
    transport: 'http',
    url: 'https://mcp.allium.so',
    auth: 'oauth',
    docs: 'https://docs.allium.so/ai/mcp/overview',
    note: '旧 mcp-oauth.allium.so 将停用，使用当前地址。',
  },
  {
    id: 'tenderly',
    label: 'Tenderly',
    transport: 'http',
    url: 'https://mcp.tenderly.co/mcp',
    auth: 'account',
    docs: 'https://tenderly.co/blog/validating-agentic-workflows-with-tenderly-mcp-server/',
    note: '官方托管 MCP，使用 OAuth 或操作者提供的授权头。',
  },
  {
    id: 'chainstack',
    label: 'Chainstack',
    transport: 'http',
    url: 'https://mcp.chainstack.com/mcp',
    auth: 'account',
    docs: 'https://github.com/chainstacklabs/mcp-server',
    note: '旧 rpc-nodes-mcp 已废弃；按统一 Chainstack MCP 文档配置。',
  },
  {
    id: 'thirdweb',
    label: 'thirdweb AI',
    transport: 'http',
    url: 'https://api.thirdweb.com/mcp',
    auth: 'account',
    docs: 'https://portal.thirdweb.com/changelog/nebula-is-now-thirdweb-ai',
    note: '原 Nebula；需要带 secretKey 查询参数的完整 URL，参见官方文档。',
  },
  {
    id: 'nansen',
    label: 'Nansen',
    transport: 'http',
    url: 'https://mcp.nansen.ai/ra/mcp',
    auth: 'api-key',
    docs: 'https://academy.nansen.ai/articles/2711728-get-started-with-nansen-mcp',
    note: '需要 Nansen 账户/API 权限。',
  },
  {
    id: 'dune',
    label: 'Dune',
    transport: 'http',
    url: 'https://api.dune.com/mcp/v1',
    auth: 'api-key',
    docs: 'https://dune.com/blog/dune-mcp',
    note: '需要 Dune 账户/API 权限。',
  },
  {
    id: 'tokenterminal',
    label: 'Token Terminal',
    transport: 'http',
    url: 'https://mcp.tokenterminal.com/mcp',
    auth: 'oauth',
    docs: 'https://tokenterminal.com/docs/mcp/introduction',
    note: '官方 OAuth 2.1；免费层提供有限 research 调用，订阅影响额度。',
  },
  {
    id: 'messari',
    label: 'Messari',
    transport: 'http',
    url: 'https://mcp.messari.io/mcp',
    auth: 'oauth',
    docs: 'https://docs.messari.io/mcp-server/hosted',
    note: '官方 OAuth 流程使用 Messari API key；数据权限取决于账户。',
  },
  {
    id: 'goplus',
    label: 'GoPlus',
    transport: 'stdio',
    url: null,
    auth: 'api-key',
    docs: 'https://github.com/GoPlusSecurity/goplus-mcp',
    note: '开源 MCP；连接 GoPlus 服务，按官方 README 配置。',
  },
  {
    id: 'openzeppelin',
    label: 'OpenZeppelin',
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
    url: 'https://wallet-mcp.coinbase.com', auth: 'oauth',
    docs: 'https://docs.cdp.coinbase.com/ai-agents/coinbase-for-agents/wallet-mcp',
    note: '替代旧 Base MCP；由官方钱包授权流程连接。',
  },
  {
    id: 'slither',
    label: 'Slither MCP',
    transport: 'stdio',
    url: null,
    auth: 'local',
    docs: 'https://blog.trailofbits.com/2025/11/15/level-up-your-solidity-llm-tooling-with-slither-mcp/',
    note: '本地启动，依赖 Slither 安装。',
  },
  {
    id: 'kaito',
    label: 'Kaito Pro',
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
  const urlValue = explicitUrl ?? (commandValue ? undefined : preset?.url ?? undefined);

  if (urlValue && commandValue) throw new Error(`MCP 服务 ${name} 不能同时配置 url 和 command`);
  if (urlValue) {
    const url = expand(urlValue, `${name}.url`);
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`MCP 服务 ${name}.url 必须为有效 URL`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`MCP 服务 ${name}.url 必须为 HTTP(S)`);
    if (parsed.username || parsed.password) throw new Error(`MCP 服务 ${name}.url 不能包含凭据`);
    const headers = stringRecord(server.headers, `${name}.headers`, HEADER_NAME);
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

function parseDocument(text: string, source: string): { servers: Record<string, ResolvedServer>; errors: Record<string, string> } {
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
  for (const [name, value] of entries) {
    try { servers[name] = parseServer(name, value); }
    catch (error) { errors[name] = error instanceof Error ? error.message : '配置无效'; }
  }
  return { servers, errors };
}

export function configSource(): { inline: boolean; file: string | null } {
  const inline = Boolean(process.env.BCA_MCP_SERVERS);
  return { inline, file: process.env.BCA_MCP_CONFIG ?? null };
}

export async function loadMcpConfiguration(): Promise<{ servers: Record<string, ResolvedServer>; errors: Record<string, string> }> {
  const inline = process.env.BCA_MCP_SERVERS;
  const file = process.env.BCA_MCP_CONFIG;
  if (inline && file) throw new Error('BCA_MCP_SERVERS 与 BCA_MCP_CONFIG 只能设置一个');
  if (!inline && !file) return { servers: {}, errors: {} };
  if (inline) {
    return parseDocument(inline, 'BCA_MCP_SERVERS');
  }
  const path = isAbsolute(file!) ? file! : resolve(process.cwd(), file!);
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('BCA_MCP_CONFIG 文件超过 1MB');
  return parseDocument(text, 'BCA_MCP_CONFIG');
}

export async function loadMcpServers(): Promise<Record<string, ResolvedServer>> {
  return (await loadMcpConfiguration()).servers;
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
