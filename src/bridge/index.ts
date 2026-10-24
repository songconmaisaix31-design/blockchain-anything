import { z } from 'zod';
import { BridgeSessions } from './session.js';
import type { Config } from '../config.js';
import { requireWrites } from '../config.js';
import { defineTool } from '../types.js';
import { configSource, describeServers, loadMcpConfiguration, presetList } from './config.js';

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

const serverNameSchema = z.string().min(1).describe('BCA_MCP_SERVERS / BCA_MCP_CONFIG 中的服务名');

export function bridgeTools(config: Config, sessions: BridgeSessions) {
  return [
    defineTool('bridge_open', '显式打开工作流会话；空闲 5 分钟过期，SDK 调用结束应 close。', z.strictObject({ server: serverNameSchema }), true, async ({ server }) => sessions.open(server)),
    defineTool('bridge_close', '关闭本 toolkit 拥有的会话，不重放业务调用。', z.strictObject({ session: z.string() }), true, async ({ session }) => sessions.close(session)),
    defineTool('bridge_refresh', '刷新已配置官方 MCP 的完整 tools/list；记录 Schema/版本变化，新增工具保持未验证。', z.strictObject({ server: serverNameSchema, session: z.string().optional() }), true,
      async ({ server, session }) => sessions.use(server, session, async (_client, _server, entry) => sessions.list(entry, true))),
    defineTool('bridge_servers', '列出操作者配置的 MCP 服务（不返回值、Token 或命令行参数）及已核实的官方预设。', z.strictObject({}), true,
      async () => {
        const { servers, errors } = await loadMcpConfiguration();
        const source = configSource();
        return {
          configured: Object.keys(servers).length,
          configurationErrors: errors,
          source: { inline: source.inline, file: source.file },
          servers: describeServers(servers),
          presets: presetList(),
          note: '服务地址、命令、请求头均由操作者通过 BCA_MCP_SERVERS 或 BCA_MCP_CONFIG 配置；调用者只能选择服务名和上游工具名。',
        };
      }),

    defineTool('bridge_discover', '连接配置的 MCP 服务，执行真实初始化并读取 tools/list；保留上游完整 inputSchema、outputSchema、annotations 与分页游标。',
      z.strictObject({
        server: serverNameSchema, session: z.string().optional(),
        cursor: z.string().optional(),
        maxPages: z.number().int().min(1).max(20).default(1).describe('最多翻页数；首页传 1'),
      }), true,
      async ({ server: serverName, session, cursor, maxPages }) => sessions.use(serverName, session, async (client, server) => {
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
        server: serverNameSchema, session: z.string().optional(),
        tool: z.string().min(1).describe('上游 tools/list 中的工具名'),
        arguments: z.record(z.string(), z.json()).default({}),
        timeoutMs: z.number().int().positive().max(300_000).optional(),
        submit: z.literal(true).optional().describe('工具不在已核对映射或操作者只读许可中时必填'),
      }), false,
      async ({ server: serverName, session, tool, arguments: args, timeoutMs, submit }) => sessions.use(serverName, session, async (client, server, entry) => {
        const snapshot = await sessions.list(entry);
        const found = snapshot.tools.find((item) => item.name === tool);
        if (!found) throw new Error(`上游 MCP 未知工具：${tool}`);
        if (!(server.preset === 'openzeppelin' && /^solidity-(erc20|erc721|erc1155)$/.test(tool)) && !(server.preset === 'coingecko' && tool === 'search_docs') && !server.readOnlyTools.includes(tool)) {
          requireWrites(config, false);
          if (submit !== true) throw new Error('工具未列入操作者只读许可，需要 submit=true');
        }
        const result = await client.callTool({ name: tool, arguments: args as Record<string, unknown> }, { timeout: timeoutMs ?? config.timeoutMs });
        if (result.isError) {
          const text = textOfContent(result.content) || '上游未返回错误文本';
          throw new Error(`上游 MCP 工具 ${tool} 返回错误：${text}`);
        }
        return { server: server.name, tool, result, connectionVerified: true };
      })),

    defineTool('bridge_resources', '读取配置的 MCP 服务的资源与资源模板列表；不支持资源时原样返回上游能力/空结果。',
      z.strictObject({ server: serverNameSchema, session: z.string().optional(), maxPages: z.number().int().min(1).max(20).default(1) }), true,
      async ({ server: serverName, session, maxPages }) => sessions.use(serverName, session, async (client, server) => {
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
      z.strictObject({ server: serverNameSchema, session: z.string().optional(), uri: z.string().min(1) }), true,
      async ({ server: serverName, session, uri }) => sessions.use(serverName, session, async (client, server) => ({
        server: server.name,
        result: await client.readResource({ uri }, { timeout: config.timeoutMs }),
      }))),

    defineTool('bridge_prompts', '读取配置的 MCP 服务暴露的提示模板列表。',
      z.strictObject({ server: serverNameSchema, session: z.string().optional(), maxPages: z.number().int().min(1).max(20).default(1) }), true,
      async ({ server: serverName, session, maxPages }) => sessions.use(serverName, session, async (client, server) => {
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

    defineTool('bridge_get_prompt', '读取官方 MCP prompt 内容，保留上游 messages。',
      z.strictObject({ server: serverNameSchema, session: z.string().optional(), name: z.string().min(1), arguments: z.record(z.string(), z.string()).optional() }), true,
      async ({ server: name, session, ...input }) => sessions.use(name, session, async (client) => client.getPrompt(input, { timeout: config.timeoutMs }))),
  ];
}
