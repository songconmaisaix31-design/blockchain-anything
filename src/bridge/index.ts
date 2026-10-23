import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { configSource, describeServers, loadMcpServers, presetList, type ResolvedServer } from './config.js';

type AnyClient = Client;

function transportFor(server: ResolvedServer) {
  if (server.transport === 'http') {
    return new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },
    });
  }
  return new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: { ...server.env },
    cwd: server.cwd,
    stderr: 'pipe',
  });
}

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (item && typeof item === 'object' && 'type' in item && (item as { type?: unknown }).type === 'text' && 'text' in item) {
        return String((item as { text: unknown }).text);
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

async function withClient<T>(config: Config, serverName: string, operation: (client: AnyClient, server: ResolvedServer) => Promise<T>): Promise<T> {
  const servers = await loadMcpServers();
  const server = servers[serverName];
  if (!server) throw new Error(`未知 MCP 服务：${serverName}；使用 bridge_servers 查看已配置服务`);
  const transport = transportFor(server);
  const stderr = transport instanceof StdioClientTransport ? transport.stderr : null;
  const stderrChunks: Buffer[] = [];
  const onStderr = (chunk: Buffer) => {
    stderrChunks.push(chunk);
    if (stderrChunks.length > 8) stderrChunks.shift();
  };
  stderr?.on('data', onStderr);
  const client = new Client({ name: 'bca', version: '0.1.0' });
  try {
    await client.connect(transport, { timeout: config.timeoutMs });
    return await operation(client, server);
  } catch (error) {
    if (error instanceof Error && stderrChunks.length > 0) {
      const detail = Buffer.concat(stderrChunks).toString('utf8').trim().slice(0, 2000);
      if (detail) error.message = `${error.message}；上游 stderr：${detail}`;
    }
    throw error;
  } finally {
    stderr?.off('data', onStderr);
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

const serverNameSchema = z.string().min(1).describe('BCA_MCP_SERVERS / BCA_MCP_CONFIG 中的服务名');

export function bridgeTools(config: Config) {
  return [
    defineTool('bridge_servers', '列出操作者配置的 MCP 服务（不返回值、Token 或命令行参数）及已核实的官方预设。', z.strictObject({}), true,
      async () => {
        const servers = await loadMcpServers();
        const source = configSource();
        return {
          configured: Object.keys(servers).length,
          source: { inline: source.inline, file: source.file },
          servers: describeServers(servers),
          presets: presetList(),
          note: '服务地址、命令、请求头均由操作者通过 BCA_MCP_SERVERS 或 BCA_MCP_CONFIG 配置；调用者只能选择服务名和上游工具名。',
        };
      }),

    defineTool('bridge_discover', '连接配置的 MCP 服务，执行真实初始化并读取 tools/list；保留上游完整 inputSchema、outputSchema、annotations 与分页游标。',
      z.strictObject({
        server: serverNameSchema,
        cursor: z.string().optional(),
        maxPages: z.number().int().min(1).max(20).default(1).describe('最多翻页数；首页传 1'),
      }), true,
      async ({ server: serverName, cursor, maxPages }) => withClient(config, serverName, async (client, server) => {
        const tools: unknown[] = [];
        let nextCursor = cursor;
        let pages = 0;
        do {
          const result = await client.listTools(nextCursor ? { cursor: nextCursor } : undefined, { timeout: config.timeoutMs });
          tools.push(...result.tools);
          nextCursor = result.nextCursor;
          pages += 1;
        } while (nextCursor && pages < maxPages);
        return {
          server: server.name,
          transport: server.transport,
          serverInfo: client.getServerVersion() ?? null,
          protocolVersion: client.getNegotiatedProtocolVersion() ?? null,
          capabilities: client.getServerCapabilities() ?? null,
          instructions: client.getInstructions() ?? null,
          tools,
          nextCursor: nextCursor ?? null,
          pages,
          connectionVerified: true,
        };
      })),

    defineTool('bridge_call', '调用配置的 MCP 服务上的真实工具；上游 isError 时本次调用明确失败，并保留上游错误文本。',
      z.strictObject({
        server: serverNameSchema,
        tool: z.string().min(1).describe('上游 tools/list 中的工具名'),
        arguments: z.record(z.string(), z.json()).default({}),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
      }), false,
      async ({ server: serverName, tool, arguments: args, timeoutMs }) => withClient(config, serverName, async (client, server) => {
        const result = await client.callTool({ name: tool, arguments: args as Record<string, unknown> }, { timeout: timeoutMs ?? config.timeoutMs });
        if (result.isError) {
          const text = textOfContent(result.content) || '上游未返回错误文本';
          throw new Error(`上游 MCP 工具 ${tool} 返回错误：${text}`);
        }
        return { server: server.name, tool, result, connectionVerified: true };
      })),

    defineTool('bridge_resources', '读取配置的 MCP 服务的资源与资源模板列表；不支持资源时原样返回上游能力/空结果。',
      z.strictObject({ server: serverNameSchema, maxPages: z.number().int().min(1).max(20).default(1) }), true,
      async ({ server: serverName, maxPages }) => withClient(config, serverName, async (client, server) => {
        const resources: unknown[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const result = await client.listResources(cursor ? { cursor } : undefined, { timeout: config.timeoutMs });
          resources.push(...result.resources);
          cursor = result.nextCursor;
          pages += 1;
        } while (cursor && pages < maxPages);
        const templates = await client.listResourceTemplates(undefined, { timeout: config.timeoutMs });
        return { server: server.name, resources, resourceTemplates: templates.resourceTemplates, nextCursor: cursor ?? null, pages };
      })),

    defineTool('bridge_read_resource', '按 URI 读取配置的 MCP 服务的真实资源内容。',
      z.strictObject({ server: serverNameSchema, uri: z.string().min(1) }), true,
      async ({ server: serverName, uri }) => withClient(config, serverName, async (client, server) => ({
        server: server.name,
        result: await client.readResource({ uri }, { timeout: config.timeoutMs }),
      }))),

    defineTool('bridge_prompts', '读取配置的 MCP 服务暴露的提示模板列表。',
      z.strictObject({ server: serverNameSchema, maxPages: z.number().int().min(1).max(20).default(1) }), true,
      async ({ server: serverName, maxPages }) => withClient(config, serverName, async (client, server) => {
        const prompts: unknown[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const result = await client.listPrompts(cursor ? { cursor } : undefined, { timeout: config.timeoutMs });
          prompts.push(...result.prompts);
          cursor = result.nextCursor;
          pages += 1;
        } while (cursor && pages < maxPages);
        return { server: server.name, prompts, nextCursor: cursor ?? null, pages };
      })),
  ];
}
