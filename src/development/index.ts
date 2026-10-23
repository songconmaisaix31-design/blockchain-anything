import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema } from '../providers/common.js';
import { parseJsonOutput, resolveWorkingDir, resolveWorkingPath, run, runVersion } from './exec.js';

const { version: solcVersion, compile: solcCompile } = createRequire(import.meta.url)('solc') as {
  version(): string;
  compile(input: string, callbacks?: { import: (path: string) => { contents: string } | { error: string } }): string;
};

function requireRpc(config: Config): { rpcUrl: string; chainId: bigint } {
  if (!config.rpcUrl || !config.chainId) throw new Error('需要 BCA_RPC_URL 和 BCA_CHAIN_ID');
  return { rpcUrl: config.rpcUrl, chainId: config.chainId };
}

async function checkChain(config: Config, cwd: string): Promise<{ rpcUrl: string; chainId: string }> {
  const { rpcUrl, chainId } = requireRpc(config);
  const result = await run('cast', ['chain-id', '--rpc-url', rpcUrl], { cwd, timeoutMs: config.timeoutMs });
  if (result.exitCode !== 0) throw new Error(`cast chain-id 失败：${result.stderr.trim() || result.stdout.trim()}`);
  const actual = result.stdout.trim();
  if (actual !== chainId.toString()) throw new Error(`chain ID 不匹配：预期 ${chainId}，实际 ${actual}`);
  return { rpcUrl, chainId: actual };
}

async function readSkillRoot(): Promise<string> {
  const configured = process.env.BCA_SKILLS_ROOT;
  const root = configured ? resolve(configured) : join(homedir(), '.agents', 'skills');
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`技能目录不存在：${root}；设置 BCA_SKILLS_ROOT`);
  return root;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

const timeoutSchema = z.number().int().positive().max(600_000).optional();

export function developmentTools(config: Config) {
  return [
    defineTool('dev_status', '检测本机 Forge/Cast/Anvil/Slither/Hardhat 与内置 solc 的实际可用版本；不安装、不联网。',
      z.strictObject({}), true,
      async () => {
        const cwd = await resolveWorkingDir(config);
        const [forge, cast, anvil, slither] = await Promise.all([
          runVersion('forge', cwd, config.timeoutMs),
          runVersion('cast', cwd, config.timeoutMs),
          runVersion('anvil', cwd, config.timeoutMs),
          runVersion('slither', cwd, config.timeoutMs),
        ]);
        const hardhatCli = await stat(join(cwd, 'node_modules', 'hardhat', 'internal', 'cli', 'cli.js')).catch(() => null);
        return {
          workingRoot: cwd,
          tools: {
            forge, cast, anvil, slither,
            hardhat: hardhatCli?.isFile() ? 'local node_modules/hardhat' : null,
          },
          solc: { version: solcVersion(), mode: 'javascript', note: 'solc npm 包，离线编译；版本由安装包决定。' },
          rpc: { configured: Boolean(config.rpcUrl && config.chainId), chainId: config.chainId?.toString() ?? null },
          skillsRoot: process.env.BCA_SKILLS_ROOT ?? join(homedir(), '.agents', 'skills'),
        };
      }),

    defineTool('dev_solidity_compile', '用本机安装的 solc JavaScript 编译器离线编译工作根目录内的 Solidity 文件，返回 ABI、字节码和官方诊断。',
      z.strictObject({
        path: z.string().min(1).describe('入口 .sol 文件，相对 BCA_WORKING_ROOT'),
        optimizer: z.boolean().default(false),
      }), true,
      async ({ path, optimizer }) => {
        const entry = await resolveWorkingPath(config, path);
        if (!entry.toLowerCase().endsWith('.sol')) throw new Error('path 必须指向 .sol 文件');
        const source = await readFile(entry, 'utf8');
        const root = await resolveWorkingDir(config);
        const key = relative(root, entry).split(sep).join('/');
        const input = {
          language: 'Solidity',
          sources: { [key]: { content: source } },
          settings: {
            optimizer: { enabled: optimizer, runs: 200 },
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
          },
        };
        let output: any;
        try {
          output = JSON.parse(solcCompile(JSON.stringify(input), {
            import: (importPath: string) => {
              const candidate = resolve(root, importPath);
              if (!inside(root, candidate)) return { error: `import 超出 BCA_WORKING_ROOT：${importPath}` };
              try {
                return { contents: readFileSync(candidate, 'utf8') };
              } catch {
                return { error: `无法解析 import：${importPath}；仅支持 BCA_WORKING_ROOT 内的路径` };
              }
            },
          }));
        } catch (error) {
          throw new Error(`solc 编译失败：${error instanceof Error ? error.message : '未知错误'}`);
        }
        const diagnostics = (output.errors ?? []).map((item: { severity: string; message: string; sourceLocation?: unknown }) => ({
          severity: item.severity, message: item.message, sourceLocation: item.sourceLocation ?? null,
        }));
        const contracts: unknown[] = [];
        for (const [file, names] of Object.entries(output.contracts ?? {})) {
          for (const [name, contract] of Object.entries(names as Record<string, any>)) {
            contracts.push({
              file, name,
              abi: contract.abi,
              bytecode: contract.evm?.bytecode?.object ? `0x${contract.evm.bytecode.object}` : '0x',
              deployedBytecode: contract.evm?.deployedBytecode?.object ? `0x${contract.evm.deployedBytecode.object}` : '0x',
            });
          }
        }
        return {
          compiler: solcVersion(),
          success: !diagnostics.some((item: { severity: string }) => item.severity === 'error'),
          contracts,
          diagnostics,
        };
      }),

    defineTool('dev_forge_build', '在指定项目目录运行真实 forge build --json；编译错误原样返回，不伪造成功。',
      z.strictObject({
        dir: z.string().default('.').describe('Foundry 项目目录，相对 BCA_WORKING_ROOT'),
        offline: z.boolean().default(false).describe('禁止 Forge 下载编译器'),
        timeoutMs: timeoutSchema,
      }), false,
      async ({ dir, offline, timeoutMs }) => {
        const cwd = await resolveWorkingDir(config, dir);
        const args = ['build', '--json'];
        if (offline) args.push('--offline');
        const result = await run('forge', args, { cwd, timeoutMs: timeoutMs ?? config.timeoutMs });
        let parsed: unknown = null;
        try { parsed = parseJsonOutput(result, 'forge build'); } catch { /* 原样返回 stderr */ }
        return { exitCode: result.exitCode, ok: result.exitCode === 0, result: parsed, stderr: result.stderr.trim().slice(0, 4000) };
      }),

    defineTool('dev_forge_test', '在指定项目目录运行真实 forge test --json，返回测试套件结果；失败原样返回。',
      z.strictObject({
        dir: z.string().default('.').describe('Foundry 项目目录，相对 BCA_WORKING_ROOT'),
        matchPath: z.string().optional().describe('只运行匹配路径的测试'),
        offline: z.boolean().default(false),
        timeoutMs: timeoutSchema,
      }), false,
      async ({ dir, matchPath, offline, timeoutMs }) => {
        const cwd = await resolveWorkingDir(config, dir);
        const args = ['test', '--json'];
        if (matchPath) args.push('--match-path', matchPath);
        if (offline) args.push('--offline');
        const result = await run('forge', args, { cwd, timeoutMs: timeoutMs ?? config.timeoutMs });
        let parsed: unknown = null;
        try { parsed = parseJsonOutput(result, 'forge test'); } catch { /* 原样返回 stderr */ }
        return { exitCode: result.exitCode, ok: result.exitCode === 0, result: parsed, stderr: result.stderr.trim().slice(0, 4000) };
      }),

    defineTool('dev_hardhat_compile', '在项目目录用其本地安装的 Hardhat CLI 执行 compile；不安装依赖、不替换编译器。',
      z.strictObject({ dir: z.string().default('.'), timeoutMs: timeoutSchema }), false,
      async ({ dir, timeoutMs }) => {
        const cwd = await resolveWorkingDir(config, dir);
        const cli = join(cwd, 'node_modules', 'hardhat', 'internal', 'cli', 'cli.js');
        const exists = await stat(cli).catch(() => null);
        if (!exists?.isFile()) throw new Error('项目目录没有本地 Hardhat；先安装项目依赖');
        const result = await run(process.execPath, [cli, 'compile'], { cwd, timeoutMs: timeoutMs ?? config.timeoutMs });
        return { exitCode: result.exitCode, ok: result.exitCode === 0, stdout: result.stdout.trim().slice(0, 8000), stderr: result.stderr.trim().slice(0, 4000) };
      }),

    defineTool('dev_slither_analyze', '对工作根目录内的 Solidity 文件或目录运行真实 Slither，并返回官方 JSON 分析结果。',
      z.strictObject({
        target: z.string().default('.').describe('文件或目录，相对 BCA_WORKING_ROOT'),
        timeoutMs: timeoutSchema,
      }), true,
      async ({ target, timeoutMs }) => {
        const cwd = await resolveWorkingDir(config);
        const resolved = await resolveWorkingPath(config, target);
        const relativeTarget = relative(cwd, resolved).split(sep).join('/') || '.';
        const result = await run('slither', [relativeTarget, '--json', '-'], { cwd, timeoutMs: timeoutMs ?? config.timeoutMs });
        let parsed: unknown = null;
        try { parsed = parseJsonOutput(result, 'slither'); } catch { /* 原样返回 */ }
        if (result.exitCode !== 0 && !parsed) {
          throw new Error(`slither 失败：${result.stderr.trim().slice(0, 2000) || '未安装或目标无效'}`);
        }
        return { exitCode: result.exitCode, result: parsed, stderr: result.stderr.trim().slice(0, 4000) };
      }),

    defineTool('dev_cast_chain_id', '通过配置的 RPC 读取真实 chain ID，并与 BCA_CHAIN_ID 核对。',
      z.strictObject({}), true,
      async () => {
        const cwd = await resolveWorkingDir(config);
        return checkChain(config, cwd);
      }),

    defineTool('dev_cast_block_number', '通过配置的 RPC 读取真实最新区块号。',
      z.strictObject({}), true,
      async () => {
        const cwd = await resolveWorkingDir(config);
        const { rpcUrl, chainId } = await checkChain(config, cwd);
        const result = await run('cast', ['block-number', '--rpc-url', rpcUrl], { cwd, timeoutMs: config.timeoutMs });
        if (result.exitCode !== 0) throw new Error(`cast block-number 失败：${result.stderr.trim()}`);
        return { chainId, blockNumber: result.stdout.trim() };
      }),

    defineTool('dev_cast_balance', '通过配置的 RPC 读取真实地址的原生币余额，返回 wei 十进制字符串。',
      z.strictObject({ address: addressSchema }), true,
      async ({ address }) => {
        const cwd = await resolveWorkingDir(config);
        const { rpcUrl, chainId } = await checkChain(config, cwd);
        const result = await run('cast', ['balance', address, '--rpc-url', rpcUrl], { cwd, timeoutMs: config.timeoutMs });
        if (result.exitCode !== 0) throw new Error(`cast balance 失败：${result.stderr.trim()}`);
        return { chainId, address, balanceWei: result.stdout.trim() };
      }),

    defineTool('dev_cast_call', '通过配置的 RPC 执行真实只读合约调用；返回 Cast 原始输出并尽量解析 JSON。',
      z.strictObject({
        to: addressSchema,
        signature: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)(?:\s*\([^)]*\))?$/, '必须为函数签名，例如 balanceOf(address)(uint256)'),
        args: z.array(z.string()).default([]),
        block: z.string().optional().describe('区块号或 latest'),
      }), true,
      async ({ to, signature, args, block }) => {
        const cwd = await resolveWorkingDir(config);
        const { rpcUrl, chainId } = await checkChain(config, cwd);
        const commandArgs = ['call', to, signature, ...args, '--rpc-url', rpcUrl, '--json'];
        if (block) commandArgs.push('--block', block);
        const result = await run('cast', commandArgs, { cwd, timeoutMs: config.timeoutMs });
        if (result.exitCode !== 0) throw new Error(`cast call 失败：${result.stderr.trim() || result.stdout.trim()}`);
        let parsed: unknown = null;
        try { parsed = JSON.parse(result.stdout.trim()); } catch { /* 返回原始文本 */ }
        return { chainId, to, signature, parsed, raw: result.stdout.trim() };
      }),

    defineTool('dev_skill_list', '列出 BCA_SKILLS_ROOT（默认 ~/.agents/skills）下实际安装的 SKILL.md，不解析或改写技能内容。',
      z.strictObject({ maxResults: z.number().int().min(1).max(1000).default(200) }), true,
      async ({ maxResults }) => {
        const root = await readSkillRoot();
        const found: { name: string; path: string; bytes: number }[] = [];
        async function walk(dir: string, depth: number): Promise<void> {
          if (depth > 4 || found.length >= maxResults) return;
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
              await walk(join(dir, entry.name), depth + 1);
            } else if (entry.isFile() && entry.name === 'SKILL.md') {
              const path = join(dir, entry.name);
              const info = await stat(path);
              found.push({ name: basename(dir), path, bytes: info.size });
            }
            if (found.length >= maxResults) break;
          }
        }
        await walk(root, 0);
        return { root, count: found.length, skills: found };
      }),

    defineTool('dev_skill_read', '读取 BCA_SKILLS_ROOT 下某个技能的实际 SKILL.md 内容。',
      z.strictObject({ name: z.string().min(1).describe('技能目录名，例如 orca-cli') }), true,
      async ({ name }) => {
        const root = await readSkillRoot();
        if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('name 必须为技能目录名');
        const path = join(root, name, 'SKILL.md');
        if (!inside(root, path)) throw new Error('路径超出 BCA_SKILLS_ROOT');
        const text = await readFile(path, 'utf8');
        return { name, path, bytes: Buffer.byteLength(text), content: text };
      }),
  ];
}
