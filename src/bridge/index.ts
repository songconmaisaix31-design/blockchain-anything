import { z } from 'zod';
import { defineTool, type ToolImplementation } from '../types.js';
import {
  bridgeError,
  loadBridgeConfig,
  publicEndpoint,
  resolveServer,
  type BridgeConfig,
  type McpServerEntry,
  type ResolvedServer,
} from './config.js';
import {
  callUpstreamTool,
  collectPages,
  findTool,
  listPromptsPage,
  listResourceTemplatesPage,
  listResourcesPage,
  listToolsPage,
  requireCapability,
  withSession,
} from './client.js';
import { findNonMcp, findPreset, NON_MCP_PROVIDERS, PRESETS, type Preset } from './presets.js';

const providerSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'provider 必须是配置中的服务名');
const cursorSchema = z.string().min(1).max(8192).optional();
const timeoutSchema = z.number().int().min(1000).max(600_000).optional();
const maxPagesSchema = z.number().int().min(1).max(100).optional();
const toolNameSchema = z.string().min(1).max(256);
const argumentsSchema = z.record(z.string(), z.unknown()).optional();
const promptArgumentsSchema = z.record(z.string(), z.string()).optional();

function presetMetadata(preset: Preset) {
  return { auth: preset.auth, authHint: preset.authHint, docs: preset.docs };
}

function resolveConfigured(id: string, entry: McpServerEntry): ResolvedServer {
  const preset = findPreset(id);
  return resolveServer(id, entry, preset ? presetMetadata(preset) : undefined);
}

async function configuredServer(id: string): Promise<{ config: BridgeConfig; server: ResolvedServer }> {
  const nonMcp = findNonMcp(id);
  if (nonMcp) {
    throw new Error(
      `服务 ${id} 没有可用的官方 MCP 接口（${nonMcp.status}）：${nonMcp.reason}` +
        (nonMcp.replacement ? ` 请使用 ${nonMcp.replacement}。` : ''),
    );
  }
  const config = await loadBridgeConfig();
  const entry = config.servers[id];
  if (!entry) {
    const preset = findPreset(id);
    if (preset) {
      throw new Error(
        `${config.error ?? `服务 ${id} 未配置`} 在 ${config.path} 的 mcpServers 中加入 ${id}；示例配置：${JSON.stringify({ [id]: preset.config })}`,
      );
    }
    const known = [...PRESETS.map((item) => item.id), ...NON_MCP_PROVIDERS.map((item) => item.id)];
    throw new Error(`未知服务 ${id}；已公布预设：${known.join(', ')}。只能调用操作者配置的服务名，不能传 URL 或命令。`);
  }
  if (config.error) throw new Error(config.error);
  try {
    return { config, server: resolveConfigured(id, entry) };
  } catch (error) {
    throw error instanceof Error ? error : new Error(`服务 ${id} 的配置无效`);
  }
}

function providerViews(config: BridgeConfig) {
  const known = new Set(PRESETS.map((preset) => preset.id));
  const providers: Array<Record<string, unknown>> = [];

  for (const preset of PRESETS) {
    const entry = config.servers[preset.id];
    let configError: string | null = null;
    let endpoint = preset.endpoint;
    let transport: string = preset.transport;
    if (entry) {
      try {
        const resolved = resolveConfigured(preset.id, entry);
        endpoint = publicEndpoint(resolved);
        transport = resolved.transport;
      } catch (error) {
        configError = bridgeError(error).message;
      }
    }
    providers.push({
      id: preset.id,
      name: preset.name,
      vendor: preset.vendor,
      kind: 'preset',
      configured: Boolean(entry),
      transport,
      endpoint,
      auth: preset.auth,
      authHint: preset.authHint,
      requires: preset.requires,
      docs: preset.docs,
      notes: preset.notes,
      ...(preset.variants ? { variants: preset.variants } : {}),
      ...(entry ? {} : { configExample: { [preset.id]: preset.config } }),
      ...(configError ? { configError } : {}),
    });
  }

  for (const [id, entry] of Object.entries(config.servers)) {
    if (known.has(id)) continue;
    try {
      const resolved = resolveConfigured(id, entry);
      providers.push({
        id,
        name: id,
        kind: 'custom',
        configured: true,
        transport: resolved.transport,
        endpoint: publicEndpoint(resolved),
        auth: 'operator-configured',
        authHint: '自定义配置；认证由操作者提供的 headers/env 决定。',
        requires: [],
        docs: null,
        notes: ['自定义 mcpServers 条目；不保证是官方服务。'],
      });
    } catch (error) {
      providers.push({
        id,
        name: id,
        kind: 'custom',
        configured: true,
        transport: entry && typeof entry === 'object' && entry.url ? 'streamable-http' : 'stdio',
        endpoint: null,
        auth: 'operator-configured',
        configError: bridgeError(error).message,
      });
    }
  }

  for (const provider of NON_MCP_PROVIDERS) {
    providers.push({
      id: provider.id,
      name: provider.name,
      vendor: provider.vendor,
      kind: 'not-mcp',
      configured: false,
      status: provider.status,
      reason: provider.reason,
      docs: provider.docs,
      ...(provider.replacement ? { replacement: provider.replacement } : {}),
    });
  }

  return providers;
}

export function bridgeTools(): ToolImplementation[] {
  return [
    defineTool(
      'services_providers',
      '列出已公布的官方 MCP 预设、操作者配置的服务及其配置状态；不连接网络，不返回 Token、header 值、args 或秘密。',
      z.strictObject({}),
      true,
      async () => {
        const config = await loadBridgeConfig();
        return {
          config: { source: config.source, path: config.path, found: config.found, error: config.error },
          providers: providerViews(config),
          notes: [
            '工具调用只接受 provider 名称；URL、命令、Token 由操作者在标准 mcpServers JSON 中配置。',
            'OAuth 预设通过官方 mcp-remote 客户端在浏览器完成授权；本工具不实现 OAuth。',
            '未配置或未授权的服务会明确失败，不会回退到 mock、缓存或假工具列表。',
          ],
        };
      },
    ),

    defineTool(
      'services_status',
      '连接配置的上游并执行真实 MCP initialize，返回服务器信息、协议版本和能力；初始化成功不代表业务工具调用成功。',
      z.strictObject({ provider: providerSchema, timeoutMs: timeoutSchema }),
      true,
      async ({ provider, timeoutMs }) => {
        const { server } = await configuredServer(provider);
        return withSession(server, timeoutMs, async ({ client }) => ({
          provider,
          connected: true,
          initialized: true,
          server: client.getServerVersion() ?? null,
          protocolVersion: client.getNegotiatedProtocolVersion() ?? null,
          capabilities: client.getServerCapabilities() ?? {},
          instructions: client.getInstructions() ?? null,
          verification: 'initialize 握手成功；业务能力需继续执行 tools/list 或 call_tool',
        }));
      },
    ),

    defineTool(
      'services_list_tools',
      '对配置的上游执行真实 tools/list，保留完整上游 inputSchema/outputSchema/annotations 与 nextCursor 分页；默认只取一页，allPages=true 时循环取完。',
      z.strictObject({
        provider: providerSchema,
        cursor: cursorSchema,
        allPages: z.boolean().optional(),
        maxPages: maxPagesSchema,
        timeoutMs: timeoutSchema,
      }),
      true,
      async ({ provider, cursor, allPages, maxPages, timeoutMs }) => {
        const { server } = await configuredServer(provider);
        return withSession(server, timeoutMs, async ({ client, timeoutMs: effective }) => {
          requireCapability(client, 'tools');
          const collected = await collectPages(
            (nextCursor) => listToolsPage(client, effective, nextCursor ?? cursor),
            allPages === true,
            maxPages ?? 64,
          );
          return {
            provider,
            tools: collected.items,
            count: collected.items.length,
            pages: collected.pages,
            nextCursor: collected.nextCursor,
            truncated: collected.truncated,
            complete: collected.nextCursor === null,
          };
        });
      },
    ),

    defineTool(
      'services_call_tool',
      '调用配置上游的真实 MCP 工具并保留原始 content/structuredContent；上游 isError=true 时外层明确失败。工具可能有真实副作用，默认只允许上游标注 readOnlyHint=true 的工具，其他工具需显式 confirmSideEffects=true 或 provider 配置 allowWriteTools=true。',
      z.strictObject({
        provider: providerSchema,
        tool: toolNameSchema,
        arguments: argumentsSchema,
        confirmSideEffects: z.literal(true).optional(),
        timeoutMs: timeoutSchema,
      }),
      false,
      async ({ provider, tool, arguments: args, confirmSideEffects, timeoutMs }) => {
        const { server } = await configuredServer(provider);
        return withSession(server, timeoutMs, async ({ client, timeoutMs: effective }) => {
          if (!server.allowWriteTools) {
            const definition = await findTool(client, effective, tool);
            const readOnly = definition?.annotations?.readOnlyHint === true;
            if (!readOnly && confirmSideEffects !== true) {
              throw new Error(
                `上游工具 ${tool} ${definition ? '未标注 readOnlyHint=true' : '不在当前 tools/list 中'}；` +
                  '如确认该调用没有资金划转、交易、签名或其他副作用，传 confirmSideEffects=true；' +
                  `或在服务 ${provider} 配置中设置 allowWriteTools=true。`,
              );
            }
          }
          const result = await callUpstreamTool(client, effective, tool, args ?? {});
          return { provider, tool, result };
        });
      },
    ),

    defineTool(
      'services_list_resources',
      '对配置的上游执行真实 resources/list，保留完整资源描述与 nextCursor 分页；上游未声明 resources 能力时明确失败。',
      z.strictObject({
        provider: providerSchema,
        cursor: cursorSchema,
        allPages: z.boolean().optional(),
        maxPages: maxPagesSchema,
        timeoutMs: timeoutSchema,
      }),
      true,
      async ({ provider, cursor, allPages, maxPages, timeoutMs }) => {
        const { server } = await configuredServer(provider);
        return withSession(server, timeoutMs, async ({ client, timeoutMs: effective }) => {
          requireCapability(client, 'resources');
          const collected = await collectPages(
            (nextCursor) => listResourcesPage(client, effective, nextCursor ?? cursor),
            allPages === true,
            maxPages ?? 64,
          );
          return {
            provider,
            resources: collected.items,
            count: collected.items.length,
            pages: collected.pages,
            nextCursor: collected.nextCursor,
            truncated: collected.truncated,
          };
        });
      },
    ),

    defineTool(
      'services_list_resource_templates',
      '对配置的上游执行真实 resources/templates/list，保留完整模板与 nextCursor 分页。',
      z.strictObject({
        provider: providerSchema,
        cursor: cursorSchema,
        allPages: z.boolean().optional(),
        maxPages: maxPagesSchema,
        timeoutMs: timeoutSchema,
      }),
      true,
      async ({ provider, cursor, allPages, maxPages, timeoutMs }) => {
        const { server } = await configuredServer(provider);
        return withSession(server, timeoutMs, async ({ client, timeoutMs: effective }) => {
          requireCapability(client, 'resources');
          const collected = await collectPages(
            (nextCursor) => listResourceTemplatesPage(client, effective, nextCursor ?? cursor),
            allPages === true,
            maxPages ?? 64,
          );
          return {
            provider,
            resourceTemplates: collected.items,
            count: collected.items.length,
            pages: collected.pages,
            nextCursor: collected.nextCursor,
            truncated: collected.truncated,
          };
        });
      },
    ),

    defineTool(
      'services_read_resource',
      '读取配置上游的真实 MCP 资源 URI，原样返回 text/blob 内容；不存在或未授权时明确失败。',
      z.strictObject({ provider: providerSchema, uri: z.string().min(1).max(8192), timeoutMs: timeoutSchema }),
      true,
      async ({ provider, uri, timeoutMs }) => {
        const { server } = await configuredServer(provider);
        return withSession(server, timeoutMs, async ({ client, timeoutMs: effective }) => {
          requireCapability(client, 'resources');
          const result = await client.readResource({ uri }, { timeout: effective });
          return { provider, uri, result };
        });
      },
    ),

    defineTool(
      'services_list_prompts',
      '对配置的上游执行真实 prompts/list，保留完整 prompt 参数与 nextCursor 分页。',
      z.strictObject({
        provider: providerSchema,
        cursor: cursorSchema,
        allPages: z.boolean().optional(),
        maxPages: maxPagesSchema,
        timeoutMs: timeoutSchema,
      }),
      true,
      async ({ provider, cursor, allPages, maxPages, timeoutMs }) => {
        const { server } = await configuredServer(provider);
        return withSession(server, timeoutMs, async ({ client, timeoutMs: effective }) => {
          requireCapability(client, 'prompts');
          const collected = await collectPages(
            (nextCursor) => listPromptsPage(client, effective, nextCursor ?? cursor),
            allPages === true,
            maxPages ?? 64,
          );
          return {
            provider,
            prompts: collected.items,
            count: collected.items.length,
            pages: collected.pages,
            nextCursor: collected.nextCursor,
            truncated: collected.truncated,
          };
        });
      },
    ),

    defineTool(
      'services_get_prompt',
      '获取配置上游的真实 prompt 内容；上游未声明 prompts 能力或 prompt 不存在时明确失败。',
      z.strictObject({
        provider: providerSchema,
        name: z.string().min(1).max(256),
        arguments: promptArgumentsSchema,
        timeoutMs: timeoutSchema,
      }),
      true,
      async ({ provider, name, arguments: args, timeoutMs }) => {
        const { server } = await configuredServer(provider);
        return withSession(server, timeoutMs, async ({ client, timeoutMs: effective }) => {
          requireCapability(client, 'prompts');
          const result = await client.getPrompt({ name, ...(args ? { arguments: args } : {}) }, { timeout: effective });
          return { provider, name, result };
        });
      },
    ),
  ];
}
