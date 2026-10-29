#!/usr/bin/env node
import { Cli, Help, z } from 'incur';
import { startMcpServer } from '../mcp/main.js';
import { createToolkit } from '../toolkit.js';
import type { ToolDefinition } from '../types.js';
import { Console } from 'node:console';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { VERSION } from '../version.js';
import { resultExitCode } from '../outcome.js';
import { setupSchema } from '../setup.js';
import { workstationContextSchema } from '../workstations/catalog.js';
import { projectInitSchema, projectRunSchema } from '../development/project.js';
import { connectSchema } from '../bridge/manage.js';

function describeTool(tool: ToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.inputSchema, { io: 'input' }),
    readOnly: tool.readOnly,
    annotations: { readOnlyHint: tool.readOnly },
    metadata: tool.metadata,
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
  const invoke = async (name: string, input: unknown) => {
    const result = await toolkit.invoke(name, input);
    process.exitCode = resultExitCode(result);
    return result;
  };
  const inputOptions = z.strictObject({ input: z.string().describe('工具输入的 JSON 对象；空输入也需传入 {}') });
  const cli = Cli.create('bca', {
    description: '成熟区块链工具聚合；bca tools 查看 Schema，bca mcp 启动官方 MCP stdio 服务',
    version: VERSION,
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
  cli.command('setup', {
    description: '配置 Codex / Claude Code；--install 准备持久运行目录与固定官方组件',
    options: setupSchema.omit({ submit: true }),
    run: ({ options }) => invoke('system_setup', { ...options, submit: true }),
  });
  cli.command('doctor', {
    description: '逐项诊断安装/配置，--connect 只连接配置的 EVM，--server 指定 MCP',
    options: z.strictObject({ dir: z.string().default('.'), connect: z.boolean().default(false), server: z.string().optional() }),
    run: ({ options }) => invoke('system_doctor', options),
  });
  cli.command('find', {
    description: '用一句话找到任务步骤，例如 bca find "只编译合约" --dir contracts',
    args: z.strictObject({ query: z.string() }),
    options: workstationContextSchema.extend({ server: z.string().optional(), limit: z.number().int().min(1).max(100).default(8), details: z.boolean().default(false) }),
    async run({ args, options }) {
      const { server, limit, details, ...context } = options;
      const tools = await invoke('capability_search', { query: args.query, dir: context.dir, chainFamily: context.chainFamily, provider: context.provider, server, limit, details });
      const stations = server ? { candidates: [] } : await invoke('workstation_search', { query: args.query, context });
      return { ...(stations as object), tools };
    },
  });
  cli.command('init', {
    description: '创建新 Foundry 项目，默认 Counter；--template erc20 或 erc721 复用 OpenZeppelin',
    args: z.strictObject({ dir: z.string() }), options: projectInitSchema.omit({ dir: true, submit: true }),
    run: ({ args, options }) => invoke('project_init', { ...args, ...options, submit: true }),
  });
  for (const [command, action] of [['build', 'compile'], ['test', 'test']] as const) cli.command(command, {
    description: '识别项目框架并执行原项目工具，失败保留诊断和退出码',
    args: z.strictObject({ dir: z.string().default('.') }), options: projectRunSchema.omit({ dir: true, action: true }),
    run: ({ args, options }) => invoke('project_run', { ...args, ...options, action }),
  });
  cli.command('connect', {
    description: '保存官方 MCP 默认认证与启动配置；--key-env 自定义密钥环境变量名，OAuth 预设默认使用登录桥接',
    args: z.strictObject({ preset: z.string() }), options: connectSchema.omit({ preset: true, submit: true }),
    run: ({ args, options }) => invoke('bridge_configure', { ...args, ...options, submit: true }),
  });
  cli.command('call', {
    description: '按照完整工具名调用共享工具',
    args: z.strictObject({ name: z.string().describe('工具名称，例如 content_cid') }),
    options: inputOptions,
    async run({ args, options }) {
      if (!toolkit.tools.some((tool) => tool.name === args.name)) {
        throw new Error('未知工具；使用 bca tools 查看可用名称');
      }
      return invoke(args.name, parseInput(options.input));
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
      run: ({ options }) => invoke(tool.name, parseInput(options.input)),
    });
  }
  for (const family of families.values()) cli.command(family);

  if (argv.length === 0 || argv.every((argument) => ['--help', '-h', '--json'].includes(argument))) {
    process.stdout.write(`${Help.formatRoot('bca', {
      description: '成熟区块链工具聚合',
      version: VERSION,
      commands: [
        { name: 'find <query> [--dir <path>] [--provider <name>] [--server <name>]', description: '搜索工作站、内置工具或上游 MCP' },
        { name: 'init <dir> [--template counter|erc20|erc721]', description: '创建可编译、测试的新项目' },
        { name: 'build [dir] / test [dir]', description: '运行项目原生编译或测试' },
        { name: 'connect <preset>', description: '接入官方 MCP 服务' },
        { name: 'setup [--client codex|claude|both] [--install]', description: '接入已有 Agent 客户端' },
        { name: 'doctor', description: '检查安装和配置，按缺项修复' },
        { name: 'tools [name]', description: '查看实际工具、完整输入 Schema 和读写标记' },
        { name: 'call <name> --input <JSON>', description: '调用共享工具' },
        { name: 'mcp', description: '启动官方 MCP stdio 服务；也可使用 --mcp' },
        ...[...families.keys()].map((name) => ({ name, description: `${name} 工具` })),
      ],
    })}\n`);
    return;
  }

  try { await cli.serve(argv, { exit: (code) => { if (code !== 0 || !process.exitCode) process.exitCode = code; } }); }
  finally { await toolkit.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ code: 'BCA_ERROR', message: error instanceof Error ? error.message : '操作失败' })}\n`);
    process.exitCode = 1;
  }
}
