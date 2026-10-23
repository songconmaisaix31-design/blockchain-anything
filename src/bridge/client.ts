import { spawn } from 'node:child_process';
import {
  Client,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { ResolvedServer } from './config.js';
import { bridgeError } from './config.js';

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface CollectedPage<T> {
  items: T[];
  pages: number;
  nextCursor: string | null;
  truncated: boolean;
}

export interface Session {
  client: Client;
  timeoutMs: number;
}

const CLIENT_INFO = { name: 'blockchain-anything-bca-services', version: '0.1.0' };

async function runCleanup(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * `npx`/`uvx` are launcher shims: terminating only the launcher can leave the
 * actual server holding stdio pipes. Kill the whole tree on Windows, where
 * this project runs, and the process itself on POSIX.
 */
async function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await runCleanup('taskkill', ['/pid', String(pid), '/t', '/f']);
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

function effectiveTimeout(server: ResolvedServer, override?: number): number {
  const value = override ?? server.timeoutMs;
  if (!Number.isSafeInteger(value) || value < 1000 || value > 600_000) {
    throw new Error(`服务 ${server.id} 的超时必须为 1000 到 600000 之间的整数`);
  }
  return value;
}

function mapError(error: unknown, server: ResolvedServer, timeoutMs: number): Error {
  const hint = server.authHint.replace(/[。.]+$/, '');
  if (error instanceof SdkHttpError) {
    if (error.status === 401) {
      return bridgeError(
        new Error(`未授权（HTTP 401）。${hint}。不要在工具参数中传 Token；由操作者在配置或环境变量中提供。`),
        server,
      );
    }
    if (error.status === 403) {
      return bridgeError(
        new Error(`拒绝访问（HTTP 403）。${hint}。这可能是账号/计划权限不足，而不是配置格式问题。`),
        server,
      );
    }
    if (error.status === 404) {
      return bridgeError(new Error('端点返回 HTTP 404；请核对官方文档中的当前 URL。'), server);
    }
    if (error.status === 429) {
      return bridgeError(new Error('上游返回 HTTP 429，已触发速率限制；请稍后重试或使用更高配额。'), server);
    }
    return bridgeError(new Error(`上游返回 HTTP ${error.status}${error.statusText ? ` ${error.statusText}` : ''}。`), server);
  }
  if (error instanceof UnauthorizedError) {
    return bridgeError(
      new Error(`未授权。${hint}。不要在工具参数中传 Token；由操作者在配置或环境变量中提供。`),
      server,
    );
  }
  if (error instanceof TypeError && error.message === 'fetch failed') {
    const cause = error.cause;
    const code =
      cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
        ? `（${cause.code}）`
        : '';
    return bridgeError(new Error(`无法建立 HTTPS 连接${code}；检查本机网络、代理或防火墙，而不是重试授权。`), server);
  }
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
    return bridgeError(new Error(`在 ${timeoutMs}ms 内未收到上游响应；可按 provider 配置 timeoutMs 或稍后重试。`), server);
  }
  if (error instanceof SdkError && error.code === SdkErrorCode.ConnectionClosed) {
    return bridgeError(new Error('上游连接已关闭；OAuth 授权可能尚未完成，或本地 stdio 进程退出。'), server);
  }
  return bridgeError(error, server);
}

/**
 * Creates a real MCP session, performs the initialize handshake, runs one
 * operation, then always closes the transport (including stdio child
 * processes). A fresh session per call avoids leaking state or sockets.
 */
export async function withSession<T>(
  server: ResolvedServer,
  timeoutOverride: number | undefined,
  operation: (session: Session) => Promise<T>,
): Promise<T> {
  const timeoutMs = effectiveTimeout(server, timeoutOverride);
  const client = new Client(CLIENT_INFO);
  const transport =
    server.transport === 'stdio'
      ? new StdioClientTransport({
          command: server.command!,
          args: server.args,
          env: server.env,
          ...(server.cwd ? { cwd: server.cwd } : {}),
          stderr: 'inherit',
        })
      : new StreamableHTTPClientTransport(new URL(server.url!), {
          ...(Object.keys(server.headers).length > 0
            ? { requestInit: { headers: server.headers } }
            : {}),
        });

  try {
    await client.connect(transport, { timeout: timeoutMs });
    return await operation({ client, timeoutMs });
  } catch (error) {
    throw mapError(error, server, timeoutMs);
  } finally {
    if (transport instanceof StdioClientTransport && transport.pid) {
      await terminateProcessTree(transport.pid);
    }
    await Promise.race([
      client.close().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
}

export function requireCapability(client: Client, capability: 'tools' | 'resources' | 'prompts'): void {
  const capabilities = client.getServerCapabilities();
  if (!capabilities || !capabilities[capability]) {
    throw new Error(`上游未声明 ${capability} 能力；不能执行对应的 MCP 请求`);
  }
}

export async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  allPages: boolean,
  maxPages: number,
): Promise<CollectedPage<T>> {
  const items: T[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    pages += 1;
    cursor = page.nextCursor;
  } while (allPages && cursor && pages < maxPages);
  return { items, pages, nextCursor: cursor ?? null, truncated: Boolean(cursor) };
}

export async function listToolsPage(client: Client, timeout: number, cursor?: string): Promise<Page<Tool>> {
  const result = await client.request(
    { method: 'tools/list', params: cursor ? { cursor } : {} },
    { timeout },
  );
  return { items: result.tools, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
}

export async function listResourcesPage(client: Client, timeout: number, cursor?: string) {
  const result = await client.request(
    { method: 'resources/list', params: cursor ? { cursor } : {} },
    { timeout },
  );
  return { items: result.resources, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
}

export async function listResourceTemplatesPage(client: Client, timeout: number, cursor?: string) {
  const result = await client.request(
    { method: 'resources/templates/list', params: cursor ? { cursor } : {} },
    { timeout },
  );
  return { items: result.resourceTemplates, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
}

export async function listPromptsPage(client: Client, timeout: number, cursor?: string) {
  const result = await client.request(
    { method: 'prompts/list', params: cursor ? { cursor } : {} },
    { timeout },
  );
  return { items: result.prompts, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
}

export async function findTool(client: Client, timeout: number, name: string): Promise<Tool | undefined> {
  const collected = await collectPages((cursor) => listToolsPage(client, timeout, cursor), true, 64);
  return collected.items.find((tool) => tool.name === name);
}

export async function callUpstreamTool(
  client: Client,
  timeout: number,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const result = await client.callTool({ name, arguments: args }, { timeout });
  if (result.isError) {
    const text = result.content
      .filter((item): item is Extract<typeof item, { type: 'text' }> => item.type === 'text')
      .map((item) => item.text)
      .join('\n')
      .trim();
    const detail = text || JSON.stringify(result.structuredContent ?? result.content);
    throw new Error(`上游工具 ${name} 返回 isError：${detail || '上游未提供错误文本'}`);
  }
  return result;
}
