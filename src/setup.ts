import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parse, stringify } from 'smol-toml';
import { z } from 'zod';
import type { Config } from './config.js';
import { defineTool } from './types.js';
import { safeError, submitSchema } from './providers/common.js';
import { resolveWorkingDir, runNpm, runVersion } from './development/exec.js';
import { loadMcpConfiguration } from './bridge/config.js';
import { textOrEmpty, replaceWithBackup } from './project-files.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workstationSchema = z.enum(['all', 'evm-diagnose', 'evm-develop']);
export const setupSchema = z.strictObject({ client: z.enum(['codex', 'claude', 'both']).default('both'), dir: z.string().default('.'),
  workstation: workstationSchema.default('all'), install: z.boolean().default(false), submit: submitSchema });

function nodeSupported() { const [major, minor] = process.versions.node.split('.').map(Number); return major === 24 && minor! >= 16; }

export async function setup(config: Config, input: z.output<typeof setupSchema>) {
  if (!nodeSupported()) throw new Error('需要 Node >=24.16.0 <25');
  const root = await resolveWorkingDir(config, input.dir);
  for (const directory of ['.bca', '.bca/runtime', '.bca/components', '.codex']) {
    const target = join(root, directory);
    await mkdir(target, { recursive: true });
    await resolveWorkingDir({ ...config, workingRoot: root }, target);
  }
  const instructionFiles = [...(input.client !== 'claude' ? ['AGENTS.md'] : []), ...(input.client !== 'codex' ? ['CLAUDE.md'] : [])];
  for (const file of ['.mcp.json', '.codex/config.toml', 'BCA-WORKFLOW.md', ...instructionFiles]) {
    const info = await lstat(join(root, file)).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (info?.isSymbolicLink()) throw new Error(`配置文件不能是符号链接：${file}`);
  }
  const components = join(root, '.bca/components');
  const runtime = join(root, '.bca/runtime');
  let entry = join(packageRoot, 'dist/mcp/main.js');
  const preparation: string[] = [];
  if (input.install) {
    await mkdir(runtime, { recursive: true });
    if (resolve(packageRoot) !== resolve(runtime, 'node_modules/blockchain-anything')) {
      const packed = JSON.parse((await runNpm(['pack', packageRoot, '--ignore-scripts', '--json', '--pack-destination', runtime], root)).stdout)[0];
      const marker = join(runtime, 'bca-install.json');
      let previous: { shasum?: string } = {};
      try { previous = JSON.parse(await textOrEmpty(marker) || '{}'); } catch { /* reinstall broken marker */ }
      if (previous.shasum !== packed.shasum || !existsSync(join(runtime, 'node_modules/blockchain-anything/dist/mcp/main.js'))) {
        await runNpm(['install', '--prefix', runtime, '--omit=dev', '--no-audit', '--no-fund', '--save-exact', join(runtime, packed.filename)], root);
        await writeFile(marker, JSON.stringify({ shasum: packed.shasum, version: packed.version }));
        preparation.push('已从当前实际 npm pack 产物安装持久运行目录');
      } else preparation.push('已复用相同打包产物');
    }
    entry = join(runtime, 'node_modules/blockchain-anything/dist/mcp/main.js');
    if (input.workstation !== 'evm-diagnose') {
      const previous = process.env.BCA_COMPONENTS_DIR;
      process.env.BCA_COMPONENTS_DIR = components;
      try {
        const componentRequire = createRequire(join(components, 'package.json'));
        const versions = await Promise.all(['forge', 'cast', 'anvil'].map(async (name) => {
          const arch = process.arch === 'x64' ? 'amd64' : process.arch;
          try {
            const executable = componentRequire.resolve(`@foundry-rs/${name}-${process.platform}-${arch}/bin/${name}${process.platform === 'win32' ? '.exe' : ''}`);
            return runVersion(executable, root, 5000);
          } catch {
            const native = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').map((dir) => join(dir, `${name}${process.platform === 'win32' ? '.exe' : ''}`)).find(existsSync);
            return native ? runVersion(native, root, 5000) : null;
          }
        }));
        if (versions.some((version) => !version)) {
          await mkdir(components, { recursive: true });
          await runNpm(['install', '--prefix', components, '--no-audit', '--no-fund', '--save-exact', '@foundry-rs/forge@1.7.1', '@foundry-rs/cast@1.7.1', '@foundry-rs/anvil@1.7.1'], root);
          preparation.push('已通过官方 npm 包安装固定 Foundry 1.7.1 到 .bca/components');
        } else preparation.push('已复用当前可用 Foundry；版本见 doctor');
      } finally { if (previous === undefined) delete process.env.BCA_COMPONENTS_DIR; else process.env.BCA_COMPONENTS_DIR = previous; }
    }
  }
  if (!existsSync(entry)) throw new Error('MCP 构建入口不存在；先 npm run build');
  const entryConfig = { command: process.execPath, args: [entry], cwd: root, env: { BCA_WORKING_ROOT: root, BCA_COMPONENTS_DIR: components, BCA_ALLOW_WRITES: 'false' } };
  const changes = [];
  const mergedEntry = (existing: any) => ({ ...existing, ...entryConfig,
    env: { ...existing?.env, ...entryConfig.env, BCA_ALLOW_WRITES: existing?.env?.BCA_ALLOW_WRITES ?? 'false' } });
  // Parse all client documents before changing either. Malformed files stay intact.
  const claudePath = join(root, '.mcp.json'); const codexPath = join(root, '.codex/config.toml');
  const claudeText = input.client !== 'codex' ? await textOrEmpty(claudePath) : '';
  const codexText = input.client !== 'claude' ? await textOrEmpty(codexPath) : '';
  const claude = JSON.parse(claudeText || '{}');
  const codex = parse(codexText) as Record<string, any>;
  if (claude.mcpServers && (typeof claude.mcpServers !== 'object' || Array.isArray(claude.mcpServers))) throw new Error('.mcp.json mcpServers 必须为对象');
  if (codex.mcp_servers && (typeof codex.mcp_servers !== 'object' || Array.isArray(codex.mcp_servers))) throw new Error('config.toml mcp_servers 必须为表');
  if (input.client !== 'codex') {
    claude.mcpServers ??= {};
    claude.mcpServers.bca = mergedEntry(claude.mcpServers.bca);
    changes.push(await replaceWithBackup(claudePath, `${JSON.stringify(claude, null, 2)}\n`));
  }
  if (input.client !== 'claude') {
    codex.mcp_servers ??= {};
    codex.mcp_servers.bca = mergedEntry(codex.mcp_servers.bca);
    changes.push(await replaceWithBackup(codexPath, stringify(codex)));
  }
  const workflow = `# BCA 工作流\n\n选定工作站：${input.workstation}\n\n1. 用 capability_search 搜索用户问题；带 server 可发现已配置官方 MCP 的真实工具。EVM 完整工作流用 workstation_search，直接使用返回的步骤和缺项。\n2. 新项目调用 project_init（counter/erc20）；已有项目调用 project_run，action=compile/test。CLI 对应 bca init/build/test。需要官方生成器时先 bca connect openzeppelin，再搜索上游真实 Schema。\n3. 宿主负责代码编辑和任务循环。失败后局部修复、局部复测。\n4. 连续 MCP 调用使用 bridge_open → bridge_call → bridge_close；需要查看最新 Schema 时调用 bridge_refresh。\n5. 本地 Anvil 部署需明确 from 和 submit；公共链沿用宿主钱包授权，不自动重放未知写入。\n\n安装后调用 content_cid，参数 {"path":"BCA-WORKFLOW.md"}。Codex/Claude Code 需信任项目并批准 MCP 配置。\n`;
  changes.push(await replaceWithBackup(join(root, 'BCA-WORKFLOW.md'), workflow));
  const instruction = '<!-- bca:start -->\nFor blockchain tasks, read BCA-WORKFLOW.md. Use capability_search to discover tools, project_init for a new project, and project_run to compile/test. Preserve the project configuration and ask the host for any transaction authorization.\n<!-- bca:end -->';
  for (const file of instructionFiles) {
    const path = join(root, file); const previous = await textOrEmpty(path);
    const block = /<!-- bca:start -->[\s\S]*?<!-- bca:end -->/;
    if ((previous.includes('<!-- bca:start -->') || previous.includes('<!-- bca:end -->')) && !block.test(previous)) throw new Error(`${file} 中的 BCA 指引标记不完整，请修复后重新 setup`);
    changes.push(await replaceWithBackup(path, block.test(previous) ? previous.replace(block, instruction) : `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}${instruction}\n`));
  }
  return { taskStatus: 'succeeded', changes, preparation, clientConnectionVerified: false, node: process.versions.node,
    nextTask: { tool: 'content_cid', input: { path: 'BCA-WORKFLOW.md' } },
    nextCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(join(dirname(entry), '../cli/main.js'))} doctor`,
    note: '未公开发布 npm。生成项目配置，保留其他客户端条目；TOML 序列化会规范化格式，原注释在备份中。' };
}

export async function doctor(config: Config, dir: string, invoke: (name: string, input: unknown) => Promise<unknown>, connect = false, server?: string) {
  const root = await resolveWorkingDir(config, dir);
  const checks: Record<string, unknown>[] = [];
  const check = async (name: string, operation: () => Promise<unknown>, repair: string, network = false, optional = false) => {
    try { checks.push({ name, status: 'passed', value: await operation(), check: network ? 'connected' : 'local/configuration', repair: null }); }
    catch (error) { checks.push({ name, status: optional ? 'optional_unavailable' : 'failed', reason: safeError(error, config).message, check: network ? 'connection-attempted' : 'local/configuration', repair }); }
  };
  await check('Node', async () => { if (!nodeSupported()) throw new Error('需要 Node >=24.16.0 <25'); return process.versions.node; }, '安装 Node 24.16+');
  for (const name of ['forge', 'cast', 'anvil']) await check(name, async () => {
    const value = await runVersion(name, root, 5000); if (!value) throw new Error('程序不存在或 --version 失败'); return value;
  }, '需要 Foundry 时执行 bca setup --install', false, !existsSync(join(root, 'foundry.toml')));
  for (const [client, path] of [['claude', join(root, '.mcp.json')], ['codex', join(root, '.codex/config.toml')]] as const) {
    if (!existsSync(path)) continue;
    await check(`${client} MCP config`, async () => {
      const text = await readFile(path, 'utf8');
      const entry = client === 'claude' ? JSON.parse(text).mcpServers?.bca : (parse(text) as any).mcp_servers?.bca;
      if (!entry?.command || !Array.isArray(entry.args) || !entry.args[0]) throw new Error('缺少 bca MCP 条目');
      await stat(entry.command); await stat(entry.args[0]);
      if (entry.env?.BCA_WORKING_ROOT !== root) throw new Error('BCA_WORKING_ROOT 与本次项目目录不匹配');
      return { configured: true, runtimeExists: true, clientConnectionVerified: false };
    }, `在目标项目运行 bca setup --client ${client}`);
    await check(client, async () => {
      const version = await runVersion(client, root, 5000);
      if (!version) throw new Error('程序不存在或 --version 失败');
      return version;
    }, '安装对应客户端，或直接使用 BCA CLI/SDK');
  }
  await check('provider configuration', async () => {
    const issues = Object.values(config.issues ?? {}).flat(); if (issues.length) throw new Error(issues.join('；'));
    return { evmConfigured: !!config.rpcUrl && !!config.chainId, writesEnabled: config.allowWrites, connectionVerified: false };
  }, '修复对应环境变量；无关能力仍可运行');
  await check('configured MCP', async () => { const state = await loadMcpConfiguration(root); if (Object.keys(state.errors).length) throw new Error(Object.values(state.errors).join('；')); return { names: Object.keys(state.servers), connectionVerified: false }; }, '修复 BCA_MCP_CONFIG 或未设置的凭据引用');
  await check('capabilities', async () => {
    const capabilities = await invoke('capability_list', { dir }) as { name: string; availability: { status: string } }[];
    const byStatus: Record<string, string[]> = {};
    for (const tool of capabilities) (byStatus[tool.availability.status] ??= []).push(tool.name);
    return { total: capabilities.length, byStatus, details: 'bca capability list --input \'{"name":"<tool>"}\'' };
  }, '按所需工具查询缺项');
  if (connect) await check('EVM live read', () => invoke('viem_chain', {}), '配置有效 RPC 和 chain ID；本检查只证明连接', true);
  if (server) await check(`MCP ${server}`, () => invoke('bridge_refresh', { server }), '完成该服务账户授权/安装', true);
  return { platform: process.platform, architecture: process.arch, checks, checkedAt: new Date().toISOString(),
    scope: '仅诊断本次目录和已配置客户端；可选组件缺失单独报告，业务结果以实际调用为准', allPassed: checks.every((item) => item.status !== 'failed') };
}

export function setupTools(config: Config, invoke: (name: string, input: unknown) => Promise<unknown>) {
  return [defineTool('system_setup', '生成项目 Codex/Claude Code MCP 配置及工作流；可从实际包准备固定官方组件，备份并保留其他条目。', setupSchema, false, (input) => setup(config, input)),
    defineTool('system_doctor', '逐项检查安装、配置及明确选定的连接；一项失败继续诊断。', z.strictObject({ dir: z.string().default('.'), connect: z.boolean().default(false), server: z.string().optional() }), true,
      ({ dir, connect, server }) => doctor(config, dir, invoke, connect, server))];
}
