#!/usr/bin/env node
import { Cli, Help, z } from 'incur';
import { startMcpServer } from '../mcp/main.js';
import { createToolkit } from '../toolkit.js';
import type { ToolDefinition } from '../types.js';

function describeTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema, { io: 'input' }),
    readOnly: tool.readOnly,
    annotations: { readOnlyHint: tool.readOnly },
  };
}

function parseInput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('--input 必须为有效 JSON；使用 bca tools <name> 查看输入 Schema');
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  // Incur 的内置 MCP 路径必须在解析前转交给同一个官方 SDK 服务。
  if (argv[0] === 'mcp' || argv.some((argument) => argument === '--mcp' || argument.startsWith('--mcp='))) {
    if (argv.length === 1 && (argv[0] === 'mcp' || argv[0] === '--mcp')) {
      startMcpServer();
      return;
    }
    if (argv.length === 2 && ['mcp', '--mcp'].includes(argv[0] ?? '') && ['--help', '-h'].includes(argv[1] ?? '')) {
      process.stdout.write('bca mcp — 使用官方 MCP SDK 启动 stdio 服务\n\n用法：bca mcp 或 bca --mcp\n客户端配置参见 docs/guides/usage.md。\n');
      return;
    }
    throw new Error('MCP stdio 启动命令为 bca mcp 或 bca --mcp，不接受其他参数');
  }

  const toolkit = createToolkit();
  const inputOptions = z.strictObject({ input: z.string().describe('工具输入的 JSON 对象；空输入也需传入 {}') });
  const cli = Cli.create('bca', {
    description: '成熟区块链工具聚合；bca tools 查看 Schema，bca mcp 启动官方 MCP stdio 服务',
    version: '0.1.0',
    format: 'json',
    sync: false,
    update: false,
  });

  cli.command('tools', {
    description: '列出实际实现的工具、输入 JSON Schema 与读写标记',
    args: z.strictObject({ name: z.string().optional().describe('只查看指定工具') }),
    run({ args }) {
      if (args.name === undefined) return toolkit.tools.map(describeTool);
      const tool = toolkit.tools.find((entry) => entry.name === args.name);
      if (!tool) throw new Error('未知工具；使用 bca tools 查看可用名称');
      return describeTool(tool);
    },
  });
  cli.command('call', {
    description: '按照完整工具名调用共享工具',
    args: z.strictObject({ name: z.string().describe('工具名称，例如 content_cid') }),
    options: inputOptions,
    async run({ args, options }) {
      if (!toolkit.tools.some((tool) => tool.name === args.name)) {
        throw new Error('未知工具；使用 bca tools 查看可用名称');
      }
      return toolkit.invoke(args.name, parseInput(options.input));
    },
  });

  const families = new Map<string, ReturnType<typeof Cli.create>>();
  for (const tool of toolkit.tools) {
    const separator = tool.name.indexOf('_');
    if (separator < 1 || separator === tool.name.length - 1) throw new Error('工具名称缺少 family 或 operation');
    const familyName = tool.name.slice(0, separator);
    const operation = tool.name.slice(separator + 1);
    let family = families.get(familyName);
    if (!family) {
      family = Cli.create(familyName, { description: `${familyName} 工具` });
      families.set(familyName, family);
    }
    family.command(operation, {
      description: tool.description,
      destructive: !tool.readOnly,
      options: inputOptions,
      hint: `完整输入 Schema：bca tools ${tool.name}；readOnly=${tool.readOnly}`,
      run: ({ options }) => toolkit.invoke(tool.name, parseInput(options.input)),
    });
  }
  for (const family of families.values()) cli.command(family);

  if (argv.length === 0 || argv.every((argument) => ['--help', '-h', '--json'].includes(argument))) {
    process.stdout.write(`${Help.formatRoot('bca', {
      description: '成熟区块链工具聚合',
      version: '0.1.0',
      commands: [
        { name: 'tools [name]', description: '查看实际工具、完整输入 Schema 和读写标记' },
        { name: 'call <name> --input <JSON>', description: '调用共享工具' },
        { name: 'mcp', description: '启动官方 MCP stdio 服务；也可使用 --mcp' },
        ...[...families.keys()].map((name) => ({ name, description: `${name} 工具` })),
      ],
    })}\n`);
    return;
  }

  await cli.serve(argv, { exit: (code) => { process.exitCode = code; } });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: 'BCA_ERROR', message: error instanceof Error ? error.message : '操作失败' })}\n`);
    process.exitCode = 1;
  }
}
