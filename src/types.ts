import type { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  readOnly: boolean;
  metadata?: Record<string, unknown>;
}

export interface Toolkit {
  tools: ToolDefinition[];
  close(): Promise<void>;
  invoke(name: string, input: unknown): Promise<unknown>;
}

export interface ToolImplementation extends ToolDefinition {
  execute(input: unknown): Promise<unknown>;
}

export function defineTool<S extends z.ZodObject>(
  name: string,
  description: string,
  inputSchema: S,
  readOnly: boolean,
  execute: (input: z.output<S>) => Promise<unknown>,
): ToolImplementation {
  return {
    name, description, inputSchema, readOnly,
    execute: (input) => execute(inputSchema.parse(input)),
  };
}
