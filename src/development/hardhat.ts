import { access, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { DevelopmentConfig } from './config.js';
import { relativeToRoot, resolveProject } from './config.js';
import { assertInside, listFiles, makeDevTool, parseJson, readTextFile, relativePath } from './helpers.js';
import { runCommand, stripAnsi } from './process.js';

const projectField = z.string().min(1).max(1024).describe('相对 BCA_DEVELOPMENT_ROOTS 的 Hardhat 项目目录');

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function findHardhatCli(projectPath: string): Promise<string> {
  const packagePath = join(projectPath, 'node_modules', 'hardhat', 'package.json');
  let packageText: string;
  try {
    packageText = (await readTextFile(packagePath, 1024 * 1024)).content;
  } catch {
    throw new Error('项目中未找到 hardhat；请先在项目目录安装官方 Hardhat 3（npm install --save-dev hardhat）');
  }
  const packageJson = parseJson<Record<string, unknown>>(packageText, 'hardhat package.json');
  if (packageJson.name !== 'hardhat') throw new Error('node_modules/hardhat/package.json 不是官方 Hardhat 包');
  const bin = packageJson.bin;
  let binPath: string | undefined;
  if (typeof bin === 'string') binPath = bin;
  else {
    const binRecord = record(bin);
    if (binRecord && typeof binRecord.hardhat === 'string') binPath = binRecord.hardhat;
  }
  if (!binPath) throw new Error('Hardhat 包未声明 hardhat CLI 入口');
  const cli = resolve(projectPath, 'node_modules', 'hardhat', binPath);
  assertInside(projectPath, cli);
  const resolved = await realpath(cli);
  assertInside(projectPath, resolved);
  if (!(await stat(resolved)).isFile()) throw new Error('Hardhat CLI 入口不是普通文件');
  return resolved;
}

export async function hasHardhatConfig(projectPath: string): Promise<boolean> {
  for (const name of ['hardhat.config.ts', 'hardhat.config.js', 'hardhat.config.mjs', 'hardhat.config.cjs']) {
    try {
      await access(join(projectPath, name));
      return true;
    } catch {
      // Try the next supported Hardhat config name.
    }
  }
  return false;
}

interface HardhatArtifact {
  contractName: string;
  sourceName: string;
  artifact: string;
  abiEntries: number;
  bytecodeBytes: number;
}

async function scanHardhatArtifacts(projectPath: string): Promise<{ artifacts: HardhatArtifact[]; truncated: boolean }> {
  const root = join(projectPath, 'artifacts', 'contracts');
  try {
    if (!(await stat(root)).isDirectory()) return { artifacts: [], truncated: false };
  } catch {
    return { artifacts: [], truncated: false };
  }
  const listing = await listFiles(root, 2000);
  const artifacts: HardhatArtifact[] = [];
  for (const file of listing.files) {
    if (!file.path.endsWith('.json') || file.path.endsWith('.dbg.json')) continue;
    if (file.bytes > 4 * 1024 * 1024) continue;
    const path = join(root, file.path);
    assertInside(projectPath, path);
    const artifact = parseJson<Record<string, unknown>>((await readTextFile(path, 4 * 1024 * 1024)).content, 'Hardhat artifact');
    if (typeof artifact.contractName !== 'string' || typeof artifact.sourceName !== 'string' || !Array.isArray(artifact.abi)) continue;
    const bytecode = typeof artifact.bytecode === 'string' ? artifact.bytecode : '';
    artifacts.push({
      contractName: artifact.contractName,
      sourceName: artifact.sourceName,
      artifact: relativePath(root, path),
      abiEntries: artifact.abi.length,
      bytecodeBytes: bytecode.startsWith('0x') ? Math.max(0, (bytecode.length - 2) / 2) : 0,
    });
  }
  return { artifacts, truncated: listing.truncated };
}

export function hardhatTools(dev: DevelopmentConfig) {
  const config = dev.base;
  return [
    makeDevTool(config, 'hardhat_compile',
      '在配置的项目目录调用项目自身的官方 Hardhat CLI 编译合约，并读取标准 artifacts 目录生成 ABI/字节码摘要；不部署、不执行任意脚本。',
      z.strictObject({ project: projectField }), false,
      async ({ project }) => {
        const resolved = await resolveProject(dev, project);
        if (!(await hasHardhatConfig(resolved.path))) throw new Error('项目缺少 hardhat.config.ts/js/mjs/cjs');
        const cli = await findHardhatCli(resolved.path);
        const result = await runCommand(process.execPath, [cli, 'compile'], {
          cwd: resolved.path,
          timeoutMs: dev.timeoutMs,
          maxOutputBytes: dev.maxOutputBytes,
          env: { CI: '1' },
        });
        const output = stripAnsi(`${result.stdout}${result.stderr}`).trim();
        const success = result.code === 0;
        if (!success) {
          return {
            project: relativeToRoot(resolved.root, resolved.path),
            success: false,
            exitCode: result.code,
            output: output.slice(0, 20_000),
            artifacts: [],
            artifactCount: 0,
          };
        }
        const scanned = await scanHardhatArtifacts(resolved.path);
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          success: true,
          exitCode: result.code,
          output: output.slice(0, 20_000),
          artifactCount: scanned.artifacts.length,
          artifacts: scanned.artifacts,
          truncated: scanned.truncated,
        };
      }),
    makeDevTool(config, 'hardhat_test',
      '在配置的项目目录调用项目自身的官方 Hardhat CLI 运行测试；支持 --grep 和 --no-compile，不部署、不执行任意脚本。',
      z.strictObject({
        project: projectField,
        grep: z.string().min(1).max(200).optional().describe('只运行名称匹配该字符串或正则的测试'),
        noCompile: z.boolean().default(false).describe('跳过 Hardhat 的自动编译'),
      }), false,
      async ({ project, grep, noCompile }) => {
        const resolved = await resolveProject(dev, project);
        if (!(await hasHardhatConfig(resolved.path))) throw new Error('项目缺少 hardhat.config.ts/js/mjs/cjs');
        const cli = await findHardhatCli(resolved.path);
        const args = [cli, 'test'];
        if (grep) args.push('--grep', grep);
        if (noCompile) args.push('--no-compile');
        const result = await runCommand(process.execPath, args, {
          cwd: resolved.path,
          timeoutMs: dev.timeoutMs,
          maxOutputBytes: dev.maxOutputBytes,
          env: { CI: '1' },
        });
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          success: result.code === 0,
          exitCode: result.code,
          output: stripAnsi(`${result.stdout}${result.stderr}`).trim().slice(0, 40_000),
        };
      }),
  ];
}
