import { z } from 'zod';
import type { ToolImplementation } from '../types.js';
import { serializable } from '../providers/common.js';

// These interfaces mirror the official elizaOS Plugin/Action/ActionParameter
// contracts. @elizaos/core 2.0.0-alpha.77 publishes runtime types through a
// broken d.ts re-export, so the structural contract is declared here instead of
// importing an unresolvable type path. The runtime objects are still created and
// registered by the official @elizaos/core AgentRuntime in examples and checks.
export interface ElizaActionParameter {
  name: string;
  description: string;
  required?: boolean;
  schema: Record<string, unknown>;
}

export interface ElizaActionResult {
  success: boolean;
  text?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ElizaAction {
  name: string;
  description: string;
  similes?: string[];
  validate: (...args: unknown[]) => Promise<boolean>;
  parameters?: ElizaActionParameter[];
  handler: (...args: unknown[]) => Promise<ElizaActionResult>;
}

export interface ElizaPlugin {
  name: string;
  description: string;
  actions: ElizaAction[];
}

interface JsonSchemaShape {
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
}

function toParameters(schema: z.ZodObject): ElizaActionParameter[] {
  const json = z.toJSONSchema(schema) as JsonSchemaShape;
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, value]) => ({
    name,
    description: typeof value.description === 'string' ? value.description : name,
    required: required.has(name),
    schema: value,
  }));
}

export function bcaToolsToElizaActions(tools: ToolImplementation[]): ElizaAction[] {
  return tools.map((tool) => ({
    name: `BCA_${tool.name.toUpperCase()}`,
    similes: [tool.name, tool.name.replaceAll('_', ' ')],
    description: `${tool.description}（BCA 工具名：${tool.name}）`,
    validate: async () => true,
    parameters: toParameters(tool.inputSchema),
    handler: async (...args: unknown[]) => {
      const options = args[3] as { parameters?: Record<string, unknown> } | undefined;
      const parameters = options?.parameters ?? {};
      try {
        const result = serializable(await tool.execute(parameters));
        return { success: true, text: JSON.stringify(result), data: { result: result as Record<string, unknown> } };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'BCA 工具执行失败';
        return { success: false, text: message, error: message };
      }
    },
  }));
}

export function createElizaPlugin(
  tools: ToolImplementation[],
  options: { name?: string; description?: string } = {},
): ElizaPlugin {
  return {
    name: options.name ?? 'bca-tools',
    description: options.description ?? 'Blockchain Anything tools exposed to elizaOS through the official plugin action contract',
    actions: bcaToolsToElizaActions(tools),
  };
}
