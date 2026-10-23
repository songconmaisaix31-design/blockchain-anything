import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/**
 * Standard `mcpServers` JSON is the operator-facing configuration format.
 * Only the fields below are accepted; tool callers never supply URLs,
 * commands, headers or tokens.
 */
export interface McpServerEntry {
  type?: 'stdio' | 'http' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  /** Per-provider request/connect timeout. */
  timeoutMs?: number;
  /** Explicitly permit upstream tools without a read-only annotation. */
  allowWriteTools?: boolean;
}

export type AuthKind = 'none' | 'oauth' | 'api-key' | 'key-secret' | 'project-secret' | 'local';

export interface BridgeConfig {
  source: 'BCA_MCP_SERVERS' | 'default';
  path: string;
  found: boolean;
  servers: Record<string, McpServerEntry>;
  error: string | null;
}

export interface ResolvedServer {
  id: string;
  transport: 'stdio' | 'http';
  command?: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  url?: string;
  headers: Record<string, string>;
  timeoutMs: number;
  allowWriteTools: boolean;
  auth: AuthKind;
  authHint: string;
  docs?: string;
  secrets: string[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function workingRoot(): string {
  return process.env.BCA_WORKING_ROOT || process.cwd();
}

export function configPath(): string {
  const configured = process.env.BCA_MCP_SERVERS;
  if (configured) return isAbsolute(configured) ? configured : resolve(workingRoot(), configured);
  return resolve(workingRoot(), '.bca/mcp-servers.json');
}

export async function loadBridgeConfig(): Promise<BridgeConfig> {
  const path = configPath();
  const source = process.env.BCA_MCP_SERVERS ? 'BCA_MCP_SERVERS' : 'default';
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        source,
        path,
        found: false,
        servers: {},
        error: `未找到 MCP 配置文件 ${path}。设置 BCA_MCP_SERVERS，或在默认路径创建标准 mcpServers JSON。`,
      };
    }
    return {
      source,
      path,
      found: false,
      servers: {},
      error: `读取 MCP 配置失败：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      source,
      path,
      found: true,
      servers: {},
      error: `MCP 配置不是有效 JSON：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { source, path, found: true, servers: {}, error: 'MCP 配置根必须是 JSON 对象' };
  }
  const root = parsed as Record<string, unknown>;
  if (!root.mcpServers && root.servers) {
    return {
      source,
      path,
      found: true,
      servers: {},
      error: 'MCP 配置必须使用标准 mcpServers 根字段；不接受其他客户端的 servers/httpUrl/serverUrl 形式',
    };
  }
  const servers = root.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return { source, path, found: true, servers: {}, error: 'MCP 配置缺少对象类型的 mcpServers 字段' };
  }

  const result: Record<string, McpServerEntry> = {};
  for (const [id, value] of Object.entries(servers as Record<string, unknown>)) {
    if (!ID_PATTERN.test(id)) {
      return {
        source,
        path,
        found: true,
        servers: {},
        error: `MCP 服务名 ${JSON.stringify(id)} 不合法；只允许字母、数字、点、下划线和连字符，最长 64 字符`,
      };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      result[id] = value as McpServerEntry;
      continue;
    }
    result[id] = value as McpServerEntry;
  }

  return { source, path, found: true, servers: result, error: null };
}

function expand(value: string, id: string, secrets: Set<string>): string {
  return value.replace(ENV_REFERENCE, (_match, name: string) => {
    const replacement = process.env[name];
    if (replacement === undefined) {
      throw new Error(`服务 ${id} 的配置引用环境变量 ${name}，但该变量未设置`);
    }
    if (replacement.length >= 4) secrets.add(replacement);
    return replacement;
  });
}

function stringValue(value: unknown, field: string, id: string): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw new Error(`服务 ${id} 的 ${field} 必须为非空字符串`);
  }
  return value;
}

function stringRecord(value: unknown, field: string, id: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`服务 ${id} 的 ${field} 必须为对象`);
  }
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== 'string') throw new Error(`服务 ${id} 的 ${field}.${key} 必须为字符串`);
    if (item.includes('\0')) throw new Error(`服务 ${id} 的 ${field}.${key} 包含空字节`);
    out[key] = item;
  }
  return out;
}

function httpUrl(value: string, id: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`服务 ${id} 的 url 必须为有效 URL`);
  }
  if (url.username || url.password) {
    throw new Error(`服务 ${id} 的 url 不能包含用户名或密码；认证请使用 headers 或 mcp-remote`);
  }
  if (url.protocol !== 'https:') {
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    if (!(url.protocol === 'http:' && local)) {
      throw new Error(`服务 ${id} 的 url 必须为 HTTPS；仅本机回环地址允许 HTTP`);
    }
  }
  url.hash = '';
  return url.toString();
}

function positiveLimit(value: unknown, field: string, id: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1000 || (value as number) > 600_000) {
    throw new Error(`服务 ${id} 的 ${field} 必须为 1000 到 600000 之间的整数`);
  }
  return value as number;
}

function inferType(entry: McpServerEntry, id: string): 'stdio' | 'http' {
  const declared = entry.type as string | undefined;
  if (declared === 'stdio') return 'stdio';
  if (declared === 'http' || declared === 'streamable-http') return 'http';
  if (declared === 'sse') {
    throw new Error(`服务 ${id} 使用不受支持的 SSE 传输；请使用 MCP Streamable HTTP（url）`);
  }
  if (declared !== undefined) throw new Error(`服务 ${id} 的 type 必须为 stdio、http 或 streamable-http`);
  if (entry.command && !entry.url) return 'stdio';
  if (entry.url && !entry.command) return 'http';
  throw new Error(`服务 ${id} 必须且只能配置 command（stdio）或 url（Streamable HTTP）之一`);
}

export function resolveServer(
  id: string,
  entry: McpServerEntry,
  metadata: { auth: AuthKind; authHint: string; docs?: string } = {
    auth: 'api-key',
    authHint: '认证由操作者配置；工具调用不接受 Token',
  },
): ResolvedServer {
  if (!ID_PATTERN.test(id)) throw new Error(`MCP 服务名 ${JSON.stringify(id)} 不合法`);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`服务 ${id} 的配置必须为对象`);
  }
  const transport = inferType(entry, id);
  const secrets = new Set<string>();
  const headers = stringRecord(entry.headers, 'headers', id);
  const env = stringRecord(entry.env, 'env', id);
  const expandedHeaders: Record<string, string> = {};
  const expandedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (!HEADER_NAME.test(key)) throw new Error(`服务 ${id} 的 header 名 ${JSON.stringify(key)} 不合法`);
    if (/[\r\n]/.test(value)) throw new Error(`服务 ${id} 的 header ${key} 不能包含换行`);
    const secret = expand(value, id, secrets);
    if (/[\r\n]/.test(secret)) throw new Error(`服务 ${id} 的 header ${key} 展开后不能包含换行`);
    if (secret.length >= 4) secrets.add(secret);
    expandedHeaders[key] = secret;
  }
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`服务 ${id} 的环境变量名 ${key} 不合法`);
    const expanded = expand(value, id, secrets);
    if (expanded.length >= 4) secrets.add(expanded);
    expandedEnv[key] = expanded;
  }

  const args = entry.args === undefined ? [] : entry.args;
  if (!Array.isArray(args) || args.length > 128) throw new Error(`服务 ${id} 的 args 必须为字符串数组且不超过 128 项`);
  const expandedArgs: string[] = [];
  for (const [index, item] of args.entries()) {
    if (typeof item !== 'string' || item.includes('\0')) throw new Error(`服务 ${id} 的 args[${index}] 必须为字符串`);
    if (item.length > 8192) throw new Error(`服务 ${id} 的 args[${index}] 过长`);
    const expanded = expand(item, id, secrets);
    if (expanded.length > 8192) throw new Error(`服务 ${id} 的 args[${index}] 展开后过长`);
    const previous = index > 0 ? expandedArgs[index - 1] ?? '' : '';
    if (/^--?(?:key|secret|token|api-?key|password|auth)$/i.test(previous) && expanded.length >= 4) secrets.add(expanded);
    expandedArgs.push(expanded);
  }

  const timeoutMs = positiveLimit(entry.timeoutMs, 'timeoutMs', id, Number(process.env.BCA_MCP_TIMEOUT_MS ?? 60_000));
  if (entry.allowWriteTools !== undefined && typeof entry.allowWriteTools !== 'boolean') {
    throw new Error(`服务 ${id} 的 allowWriteTools 必须为布尔值`);
  }

  if (transport === 'stdio') {
    if (entry.command === undefined) throw new Error(`服务 ${id} 配置为 stdio 时必须提供 command`);
    const command = stringValue(expand(entry.command, id, secrets), 'command', id);
    if (entry.url) throw new Error(`服务 ${id} 配置为 stdio 时不能同时提供 url`);
    const cwd = entry.cwd === undefined ? undefined : stringValue(expand(entry.cwd, id, secrets), 'cwd', id);
    return {
      id,
      transport,
      command,
      args: expandedArgs,
      env: expandedEnv,
      ...(cwd ? { cwd } : {}),
      headers: {},
      timeoutMs,
      allowWriteTools: entry.allowWriteTools === true,
      auth: metadata.auth,
      authHint: metadata.authHint,
      ...(metadata.docs ? { docs: metadata.docs } : {}),
      secrets: [...secrets],
    };
  }

  const url = httpUrl(expand(stringValue(entry.url, 'url', id), id, secrets), id);
  const parsed = new URL(url);
  if (parsed.username) secrets.add(parsed.username);
  if (parsed.password) secrets.add(parsed.password);
  parsed.searchParams.forEach((value) => {
    if (value.length >= 4) secrets.add(value);
  });
  if (entry.command) throw new Error(`服务 ${id} 配置为 HTTP 时不能同时提供 command`);

  return {
    id,
    transport,
    url,
    args: [],
    env: {},
    headers: expandedHeaders,
    timeoutMs,
    allowWriteTools: entry.allowWriteTools === true,
    auth: metadata.auth,
    authHint: metadata.authHint,
    ...(metadata.docs ? { docs: metadata.docs } : {}),
    secrets: [...secrets],
  };
}

export function publicEndpoint(server: Pick<ResolvedServer, 'transport' | 'url' | 'command'>): string {
  if (server.transport === 'stdio') return server.command ?? 'stdio';
  if (!server.url) return 'http';
  const url = new URL(server.url);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function redact(message: string, secrets: string[] = []): string {
  let result = message;
  for (const secret of [...secrets].filter((item) => item.length >= 4).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTED]');
  }
  result = result.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
  result = result.replace(/((?:x-|nansen-)?api-key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  result = result.replace(/https?:\/\/[^\s"'<>]+/g, '[ENDPOINT]');
  return result;
}

/** Keep errors actionable while never echoing operator secrets or full endpoints. */
export function bridgeError(error: unknown, server?: Pick<ResolvedServer, 'id' | 'secrets'>): Error {
  const original = error instanceof Error ? error.message : '操作失败';
  const message = redact(original, server?.secrets ?? []);
  const clean = new Error(server ? `服务 ${server.id}：${message}` : message);
  clean.name = error instanceof Error ? error.name : 'BridgeError';
  return clean;
}
