import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireWrites } from '../config.js';
import { defineTool, type Toolkit } from '../types.js';
import { resolveWorkingPath } from '../development/exec.js';
import { agentServiceTools } from './services.js';

type JsonSchema = Record<string, unknown>;
export interface NativeAgentAction {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  invoke(input: Record<string, unknown>): Promise<unknown>;
}

/** Pass the real AgentKit instance and its schema converter from the host app. */
export function fromAgentKit(
  kit: { getActions(): Array<{ name: string; description: string; schema: unknown; invoke(input: Record<string, unknown>): Promise<unknown> }> },
  schemaToJson: (schema: unknown) => JsonSchema,
): NativeAgentAction[] {
  return kit.getActions().map((action) => ({ name: action.name, description: action.description,
    inputSchema: schemaToJson(action.schema), invoke: (input) => action.invoke(input) }));
}

interface SolanaNativeTool {
  id?: string;
  name?: string;
  description?: string;
  parameters?: unknown;
  inputSchema?: unknown;
  execute?: (input: Record<string, unknown>) => Promise<unknown>;
}

/** Accept the actual result of Solana Agent Kit's createVercelAITools(agent, actions). */
export function fromSolanaAgentKit(
  nativeTools: Record<string, SolanaNativeTool> | SolanaNativeTool[],
  schemaToJson: (schema: unknown) => JsonSchema,
): NativeAgentAction[] {
  const entries: Array<[string | undefined, SolanaNativeTool]> = Array.isArray(nativeTools)
    ? nativeTools.map((tool) => [tool.id ?? tool.name, tool])
    : Object.entries(nativeTools).map(([key, tool]) => [tool.id ?? tool.name ?? key, tool]);
  return entries.map(([name, tool]) => {
    if (!name) throw new Error('Solana Agent Kit 工具缺少原生 id/name');
    if (!tool.execute) throw new Error(`Solana Agent Kit 工具 ${name} 缺少 execute`);
    return { name, description: tool.description ?? name,
      inputSchema: schemaToJson(tool.inputSchema ?? tool.parameters), invoke: (input) => tool.execute!(input) };
  });
}

/** OpenAI-compatible function declarations. Execution always uses BCA's schemas. */
export function asFunctionTools(toolkit: Toolkit) {
  return toolkit.tools.map((tool) => ({ type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.inputSchema, { io: 'input' }) } }));
}

/** Uses the official GAME function class; the host owns its Agent and Worker. */
export async function asGameFunctions(toolkit: Toolkit) {
  const { GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus } = await import('@virtuals-protocol/game');
  return toolkit.tools.map((tool) => new GameFunction({
    name: tool.name, description: `${tool.description}\nInput JSON Schema: ${JSON.stringify(z.toJSONSchema(tool.inputSchema, { io: 'input' }))}`,
    args: [{ name: 'input', description: 'JSON object conforming to the tool schema', type: 'string' }],
    executable: async ({ input }) => {
      try { return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Done, JSON.stringify(await toolkit.invoke(tool.name, JSON.parse(input ?? '{}')))); }
      catch (error) { return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, error instanceof Error ? error.message : 'BCA call failed'); }
    },
  }));
}

/** elizaOS plugin actions dispatch a structured BCA input supplied by the runtime. */
export function asElizaPlugin(toolkit: Toolkit) {
  return {
    name: 'blockchain-anything', description: 'BCA mature blockchain tools',
    actions: toolkit.tools.map((tool) => ({
      name: tool.name.toUpperCase(), similes: [tool.name], description: tool.description,
      examples: [], validate: async () => true,
      handler: async (_runtime: unknown, _message: unknown, _state: unknown, options: { input?: unknown } | undefined, callback?: (response: { text: string }) => Promise<unknown>) => {
        try {
          const result = await toolkit.invoke(tool.name, options?.input ?? {});
          if (callback) await callback({ text: JSON.stringify(result) });
          return { success: true, data: result };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'BCA call failed';
          if (callback) await callback({ text: message });
          return { success: false, error: message };
        }
      },
    })),
  };
}

async function nativeOperation(config: Config, provider: 'agentkit' | 'solana-agent-kit', call?: { name: string; arguments: Record<string, unknown> }) {
  const key = provider === 'agentkit' ? 'BCA_AGENTKIT_MODULE' : 'BCA_SOLANA_AGENT_MODULE';
  const modulePath = process.env[key];
  if (!modulePath) throw new Error(`需要 ${key}：操作者配置的本地工厂模块，参见 examples/agents`);
  const moduleUrl = pathToFileURL(await resolveWorkingPath(config, modulePath)).href;
  // Some host SDKs start background analytics that can reject outside invoke().
  // Isolate the actual SDK without patching it or suppressing process-wide errors.
  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { moduleUrl, call, maxBytes: config.maxReadBytes }, stdout: true, stderr: true,
      execArgv: process.execArgv.filter((arg, index, all) => !arg.startsWith('--input-type=') && arg !== '--input-type' && all[index - 1] !== '--input-type'),
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`${provider} 超时；操作状态可能未知，请先核对钱包或链上状态，不要自动重试`)), config.timeoutMs);
    worker.once('message', (message: { ok: boolean; json?: string; error?: string }) => {
      if (!message.ok) return finish(new Error(`${provider}：${message.error}`));
      try { finish(undefined, JSON.parse(message.json!)); }
      catch { finish(new Error(`${provider} 返回内容不是 JSON`)); }
    });
    worker.once('error', (error) => finish(new Error(`${provider} SDK 失败：${error.message}；操作状态可能未知，请先核对，不要自动重试`)));
    worker.once('exit', (code) => finish(new Error(`${provider} SDK 提前退出 (${code})`)));
  });
}

export function agentTools(config: Config) {
  const provider = z.enum(['agentkit', 'solana-agent-kit']);
  return [
    ...agentServiceTools(config),
    defineTool('agent_actions', '加载操作者创建的官方 AgentKit / Solana Agent Kit 实例，列出实际 actions 与 schema。', z.strictObject({ provider }), true,
      async ({ provider }) => nativeOperation(config, provider)),
    defineTool('agent_call', '执行官方 AgentKit / Solana Agent Kit 原生 action；可能签署或转账，默认要求写入开关和 submit=true。', z.strictObject({ provider, action: z.string().min(1), arguments: z.record(z.string(), z.json()).default({}), submit: z.literal(true) }), false,
      async ({ provider, action: name, arguments: args }) => {
        requireWrites(config, false);
        return nativeOperation(config, provider, { name, arguments: args });
      }),
  ];
}
