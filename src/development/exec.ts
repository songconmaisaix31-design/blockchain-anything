import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Config } from '../config.js';

function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('路径超出 BCA_WORKING_ROOT');
}

export async function resolveWorkingDir(config: Config, path = '.'): Promise<string> {
  const root = await realpath(config.workingRoot);
  const requested = resolve(root, path);
  assertInside(root, requested);
  const resolved = await realpath(requested);
  assertInside(root, resolved);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error('路径必须指向目录');
  return resolved;
}

export async function resolveWorkingPath(config: Config, path: string): Promise<string> {
  const root = await realpath(config.workingRoot);
  const requested = resolve(root, path);
  assertInside(root, requested);
  const resolved = await realpath(requested);
  assertInside(root, resolved);
  return resolved;
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  maxBytes?: number;
  env?: Record<string, string | undefined>;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

function childEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 子进程不需要 BCA 的签署私钥或 MCP 凭据；默认不继承。
  for (const key of Object.keys(env)) {
    if (['BCA_PRIVATE_KEY', 'BCA_MCP_SERVERS', 'BCA_MCP_CONFIG'].includes(key.toUpperCase())) delete env[key];
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function run(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  return new Promise((resolveRun, rejectRun) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        env: childEnv(options.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rejectRun(new Error(`无法启动 ${command}：${error instanceof Error ? error.message : '未知错误'}`));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let total = 0;
    let timedOut = false;
    let truncated = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    const collect = (target: Buffer[], chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        truncated = true;
        child.kill('SIGKILL');
        return;
      }
      target.push(chunk);
    };
    child.stdout?.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectRun(new Error(`无法运行 ${command}：${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        rejectRun(new Error(`${command} 超过 ${options.timeoutMs}ms 未完成`));
        return;
      }
      if (truncated) {
        rejectRun(new Error(`${command} 输出超过 ${maxBytes} 字节上限`));
        return;
      }
      resolveRun({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut: false,
        truncated: false,
      });
    });
  });
}

export async function runVersion(command: string, cwd: string, timeoutMs: number): Promise<string | null> {
  try {
    const result = await run(command, ['--version'], { cwd, timeoutMs: Math.min(timeoutMs, 10_000), maxBytes: 64 * 1024 });
    if (result.exitCode !== 0) return null;
    return (result.stdout || result.stderr).trim().split(/\r?\n/)[0] ?? '';
  } catch {
    return null;
  }
}

export function parseJsonOutput(result: RunResult, command: string): unknown {
  const text = result.stdout.trim();
  if (!text) throw new Error(`${command} 没有返回 JSON；stderr=${result.stderr.trim().slice(0, 1000)}`);
  try {
    return JSON.parse(text);
  } catch {
    // forge 在部分错误路径会先输出非 JSON 诊断，取最后一个完整 JSON 对象。
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new Error(`${command} 返回内容不是 JSON：${text.slice(0, 1000)}`);
  }
}
