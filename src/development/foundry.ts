import { isAddress } from 'ethers';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { DevelopmentConfig } from './config.js';
import { resolveProject, relativeToRoot } from './config.js';
import { assertInside, listFiles, makeDevTool, parseJson, readTextFile, relativePath } from './helpers.js';
import { runCommand, stripAnsi } from './process.js';

const projectField = z.string().min(1).max(1024).describe('相对 BCA_DEVELOPMENT_ROOTS 的项目目录，例如 examples/contracts/foundry');
const contractField = z.string().min(1).max(512).regex(/^[A-Za-z0-9_$][A-Za-z0-9_$.:/-]*$/, '无效的合约标识').describe('合约标识，例如 BCACounter 或 src/BCACounter.sol:BCACounter');
const regexField = z.string().min(1).max(200).describe('传递给官方 CLI 的过滤表达式');
const fieldField = z.enum([
  'abi',
  'bytecode',
  'deployedBytecode',
  'methodIdentifiers',
  'storageLayout',
  'metadata',
  'errors',
  'events',
  'libraries',
  'devdoc',
  'userdoc',
  'gasEstimates',
]).describe('forge inspect 的标准制品字段');

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function objectLength(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  const valueRecord = record(value);
  return valueRecord ? Object.keys(valueRecord).length : 0;
}

function byteLength(value: unknown): number {
  if (typeof value === 'string') return value.startsWith('0x') ? Math.max(0, (value.length - 2) / 2) : Math.max(0, value.length / 2);
  const valueRecord = record(value);
  if (valueRecord && typeof valueRecord.object === 'string') return byteLength(valueRecord.object);
  return 0;
}

interface BuildContract {
  contract: string;
  source: string;
  abiEntries: number;
  bytecodeBytes: number;
  deployedBytecodeBytes: number;
}

function summarizeForgeBuild(projectPath: string, parsed: JsonRecord): { contracts: BuildContract[]; truncated: boolean; errorCount: number; warningCount: number } {
  const contractsField = record(parsed.contracts) ?? {};
  const contracts: BuildContract[] = [];
  let truncated = false;
  for (const [source, contractsByName] of Object.entries(contractsField)) {
    const names = record(contractsByName);
    if (!names) continue;
    for (const [name, builds] of Object.entries(names)) {
      if (contracts.length >= 2000) {
        truncated = true;
        break;
      }
      const candidates = Array.isArray(builds) ? builds : [builds];
      for (const candidate of candidates) {
        const build = record(candidate);
        const artifact = record(build?.contract) ?? build;
        if (!artifact) continue;
        contracts.push({
          contract: name,
          source: relativePath(projectPath, source.split('/').join(requirePathSeparator())),
          abiEntries: objectLength(artifact.abi),
          bytecodeBytes: byteLength(artifact.bytecode),
          deployedBytecodeBytes: byteLength(artifact.deployedBytecode),
        });
      }
    }
    if (truncated) break;
  }
  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  let errorCount = 0;
  let warningCount = 0;
  for (const entry of errors) {
    const severity = record(entry)?.severity;
    if (severity === 'error') errorCount += 1;
    else if (severity === 'warning') warningCount += 1;
  }
  return { contracts, truncated, errorCount, warningCount };
}

function requirePathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/';
}

/**
 * Forge emits an empty `contracts` object when the cache is already up to date.
 * In that case the standard artifacts in `out/` are the authoritative build
 * output, so summarize those instead of claiming that no contracts exist.
 */
async function scanFoundryArtifacts(projectPath: string): Promise<{ contracts: BuildContract[]; truncated: boolean }> {
  const outDirectory = join(projectPath, 'out');
  try {
    const info = await stat(outDirectory);
    if (!info.isDirectory()) return { contracts: [], truncated: false };
  } catch {
    return { contracts: [], truncated: false };
  }
  const listing = await listFiles(outDirectory, 2000);
  const contracts: BuildContract[] = [];
  for (const file of listing.files) {
    if (!file.path.endsWith('.json') || file.path.endsWith('.dbg.json') || file.path.includes('build-info')) continue;
    if (file.bytes > 4 * 1024 * 1024) continue;
    const path = join(outDirectory, file.path);
    assertInside(projectPath, path);
    const artifact = parseJson<JsonRecord>((await readTextFile(path, 4 * 1024 * 1024)).content, 'Foundry artifact');
    if (!Array.isArray(artifact.abi)) continue;
    const name = file.path.split('/').pop()?.replace(/\.json$/, '') ?? file.path;
    const ast = record(artifact.ast);
    const source = typeof ast?.absolutePath === 'string' ? ast.absolutePath : file.path;
    contracts.push({
      contract: name,
      source: relativePath(projectPath, source),
      abiEntries: artifact.abi.length,
      bytecodeBytes: byteLength(artifact.bytecode),
      deployedBytecodeBytes: byteLength(artifact.deployedBytecode),
    });
  }
  return { contracts, truncated: listing.truncated };
}

export function foundryTools(dev: DevelopmentConfig) {
  const config = dev.base;
  return [
    makeDevTool(config, 'foundry_build',
      '在配置的项目目录运行官方 Forge 编译（forge build --json），返回编译状态、错误和合约制品摘要；不执行部署。',
      z.strictObject({ project: projectField }), false,
      async ({ project }) => {
        const resolved = await resolveProject(dev, project);
        const result = await runCommand(dev.forgeBin, ['build', '--json'], {
          cwd: resolved.path,
          timeoutMs: dev.timeoutMs,
          maxOutputBytes: dev.maxOutputBytes,
        });
        if (!result.stdout.trim()) {
          throw new Error(`Forge 编译未返回 JSON（退出码 ${result.code}）：${stripAnsi(result.stderr).trim().slice(0, 2000)}`);
        }
        const parsed = parseJson<JsonRecord>(result.stdout, 'forge build --json');
        const summary = summarizeForgeBuild(resolved.path, parsed);
        const contractFieldEmpty = summary.contracts.length === 0;
        const cached = result.code === 0 && contractFieldEmpty;
        const artifacts = cached ? await scanFoundryArtifacts(resolved.path) : { contracts: [], truncated: false };
        const contracts = cached ? artifacts.contracts : summary.contracts;
        const success = result.code === 0 && summary.errorCount === 0;
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          success,
          cached,
          exitCode: result.code,
          contractCount: contracts.length,
          contracts,
          truncated: summary.truncated || artifacts.truncated,
          errorCount: summary.errorCount,
          warningCount: summary.warningCount,
          errors: Array.isArray(parsed.errors) ? parsed.errors : [],
          stderr: stripAnsi(result.stderr).trim().slice(0, 4000) || null,
        };
      }),
    makeDevTool(config, 'foundry_inspect',
      '运行官方 forge inspect 读取已编译合约的标准制品字段（ABI、字节码、方法选择器、存储布局等）；可能触发编译并写入项目缓存。',
      z.strictObject({ project: projectField, contract: contractField, field: fieldField }), false,
      async ({ project, contract, field }) => {
        const resolved = await resolveProject(dev, project);
        const result = await runCommand(dev.forgeBin, ['inspect', contract, field, '--json'], {
          cwd: resolved.path,
          timeoutMs: dev.timeoutMs,
          maxOutputBytes: dev.maxOutputBytes,
        });
        if (result.code !== 0) {
          throw new Error(`forge inspect 失败（退出码 ${result.code}）：${stripAnsi(result.stderr || result.stdout).trim().slice(0, 2000)}`);
        }
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          contract,
          field,
          value: parseJson<unknown>(result.stdout, 'forge inspect --json'),
        };
      }),
    makeDevTool(config, 'foundry_test',
      '在配置的项目目录运行官方 Forge 测试（forge test --json），返回完整测试结果和通过/失败统计；不部署合约。',
      z.strictObject({
        project: projectField,
        matchTest: regexField.optional(),
        matchContract: regexField.optional(),
        matchPath: z.string().min(1).max(300).optional().describe('测试文件 glob，例如 test/BCACounter.t.sol'),
      }), false,
      async ({ project, matchTest, matchContract, matchPath }) => {
        const resolved = await resolveProject(dev, project);
        const args = ['test', '--json'];
        if (matchTest) args.push('--match-test', matchTest);
        if (matchContract) args.push('--match-contract', matchContract);
        if (matchPath) args.push('--match-path', matchPath);
        const result = await runCommand(dev.forgeBin, args, {
          cwd: resolved.path,
          timeoutMs: dev.timeoutMs,
          maxOutputBytes: dev.maxOutputBytes,
        });
        if (!result.stdout.trim()) {
          throw new Error(`Forge 测试未返回 JSON（退出码 ${result.code}）：${stripAnsi(result.stderr).trim().slice(0, 2000)}`);
        }
        const suites = parseJson<JsonRecord>(result.stdout, 'forge test --json');
        let tests = 0;
        let passed = 0;
        let failed = 0;
        let skipped = 0;
        const failures: Array<{ suite: string; test: string; reason: unknown }> = [];
        for (const [suite, suiteValue] of Object.entries(suites)) {
          const suiteRecord = record(suiteValue);
          const testResults = record(suiteRecord?.test_results);
          if (!testResults) continue;
          for (const [test, testValue] of Object.entries(testResults)) {
            tests += 1;
            const status = record(testValue)?.status;
            if (status === 'Success') passed += 1;
            else if (status === 'Skipped') skipped += 1;
            else {
              failed += 1;
              failures.push({ suite, test, reason: record(testValue)?.reason ?? null });
            }
          }
        }
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          success: result.code === 0 && failed === 0,
          exitCode: result.code,
          summary: { suites: Object.keys(suites).length, tests, passed, failed, skipped },
          failures,
          suites,
          stderr: stripAnsi(result.stderr).trim().slice(0, 4000) || null,
        };
      }),
    makeDevTool(config, 'foundry_call',
      '通过官方 cast 对配置 RPC 上的合约执行只读调用（cast call --json）；先核对 chain ID，不签名、不发送交易、不接受调用者传入 RPC URL。',
      z.strictObject({
        to: z.string().refine(isAddress, '必须为 EVM 地址'),
        signature: z.string().min(1).max(512).regex(/^[^\0\r\n]+$/, '签名不能包含控制字符').describe('Solidity 函数签名，例如 number()(uint256)'),
        args: z.array(z.string().max(512).regex(/^[^\0\r\n]*$/, '参数不能包含控制字符')).max(50).default([]).describe('按签名顺序编码的参数'),
        from: z.string().refine(isAddress, '必须为 EVM 地址').optional().describe('可选调用者地址；仅用于模拟'),
        block: z.string().regex(/^(latest|earliest|pending|safe|finalized|0|[1-9][0-9]*)$/).optional().describe('区块号或标签'),
      }), true,
      async ({ to, signature, args, from, block }) => {
        const rpcUrl = config.rpcUrl;
        const chainId = config.chainId;
        if (!rpcUrl || !chainId) throw new Error('需要 BCA_RPC_URL 和 BCA_CHAIN_ID 才能执行 cast 只读调用');
        const chainResult = await runCommand(dev.castBin, ['chain-id', '--rpc-url', rpcUrl], {
          cwd: dev.base.workingRoot,
          timeoutMs: Math.min(dev.timeoutMs, 60_000),
          maxOutputBytes: 64 * 1024,
        });
        if (chainResult.code !== 0) throw new Error(`cast chain-id 失败：${stripAnsi(chainResult.stderr).trim().slice(0, 1000)}`);
        const actualChainId = BigInt(chainResult.stdout.trim());
        if (actualChainId !== chainId) throw new Error(`chain ID 不匹配：预期 ${chainId}，实际 ${actualChainId}`);
        const callArgs = ['call', to, signature, ...args, '--rpc-url', rpcUrl, '--json'];
        if (from) callArgs.push('--from', from);
        if (block) callArgs.push('--block', block);
        const result = await runCommand(dev.castBin, callArgs, {
          cwd: dev.base.workingRoot,
          timeoutMs: Math.min(dev.timeoutMs, 120_000),
          maxOutputBytes: 4 * 1024 * 1024,
        });
        if (result.code !== 0) {
          throw new Error(`cast call 失败（退出码 ${result.code}）：${stripAnsi(result.stderr || result.stdout).trim().slice(0, 2000)}`);
        }
        const output = result.stdout.trim();
        let value: unknown;
        if (output.startsWith('[') || output.startsWith('{')) value = parseJson<unknown>(output, 'cast call --json');
        else value = output;
        return { chainId, to, signature, args, from: from ?? null, block: block ?? null, value };
      }),
  ];
}
