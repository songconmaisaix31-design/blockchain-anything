import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, isAbsolute, relative, resolve, sep } from 'node:path';
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
  signal?: AbortSignal;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export function childEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 子进程不需要 BCA 的签署私钥或 MCP 凭据；默认不继承。
  delete env.BCA_PRIVATE_KEY;
  delete env.BCA_MCP_SERVERS;
  delete env.BCA_MCP_CONFIG;
  for (const key of Object.keys(env)) if (key.startsWith('BCA_') && /KEY|TOKEN|AUTH|SECRET|PASSWORD/.test(key)) delete env[key];
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function resolveExecutable(command: string, cwd = process.env.BCA_WORKING_ROOT || process.cwd()): string {
  let executable = command;
  if (['forge', 'cast', 'anvil'].includes(command)) {
    // Foundry's npm launcher 1.7.1 does not forward child exit status.
    // Run its official platform binary directly when installed.
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;
    const platform = process.platform === 'win32' ? 'win32' : process.platform;
    const moduleName = `@foundry-rs/${command}-${platform}-${arch}/bin/${command}${process.platform === 'win32' ? '.exe' : ''}`;
    const roots = [process.env.BCA_COMPONENTS_DIR, resolve(cwd, '.bca/components'), resolve(process.env.BCA_WORKING_ROOT || process.cwd(), '.bca/components')];
    for (const root of roots) {
      if (!root) continue;
      try { return createRequire(resolve(root, 'package.json')).resolve(moduleName); } catch { /* Try the installed package or PATH. */ }
    }
    try { executable = createRequire(import.meta.url).resolve(moduleName); } catch { /* Fall back to PATH. */ }
  }
  return executable;
}

export function run(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const executable = resolveExecutable(command, options.cwd);
  if (options.signal?.aborted) return Promise.reject(new Error(`${command} 已取消，未启动`));
  return new Promise((resolveRun, rejectRun) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
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
    let stopping = false;
    let failure: string | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const dispose = () => {
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      options.signal?.removeEventListener('abort', cancel);
    };
    const stop = (reason: string) => {
      if (stopping) return;
      stopping = true;
      failure = reason;
      // The deadline includes pipes held by descendants. Never report a clean
      // stop when the OS operation or the close event cannot confirm it.
      cleanupTimer = setTimeout(() => {
        dispose();
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
        rejectRun(new Error(`${reason}；进程树清理未在 2000ms 内确认，请按本次 PID ${child.pid} 检查；提交状态未知`));
      }, 2000);
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        const killTimer = setTimeout(() => killer.kill(), 1500);
        killer.once('close', (code) => {
          clearTimeout(killTimer);
          if (code !== 0) failure = `${reason}；taskkill 未确认清理成功 (${code})`;
        });
        killer.once('error', () => { failure = `${reason}；taskkill 无法启动，清理未确认`; });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure = `${reason}；无法终止进程组，清理未确认`;
        }
      }
    };
    const cancel = () => stop(`${command} 已取消`);
    const timer = setTimeout(() => {
      timedOut = true;
      stop(`${command} 超过 ${options.timeoutMs}ms 未完成`);
    }, options.timeoutMs);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const collect = (target: Buffer[], chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        truncated = true;
        stop(`${command} 输出超过 ${maxBytes} 字节上限`);
        return;
      }
      target.push(chunk);
    };
    child.stdout?.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', (error) => {
      dispose();
      rejectRun(new Error(`无法运行 ${command}：${error.message}`));
    });
    child.on('close', (code) => {
      dispose();
      if (failure) {
        rejectRun(new Error(`${failure}；不自动重放操作`));
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

/** Use npm's JS entry so Windows does not need a shell to execute npm.cmd. */
export async function runNpm(args: string[], cwd: string) {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  const cli = candidates.find((item) => item && existsSync(item));
  const result = await run(cli ? process.execPath : 'npm', cli ? [cli, ...args] : args, { cwd, timeoutMs: 240_000, maxBytes: 4 * 1024 * 1024 });
  if (result.exitCode !== 0) throw new Error(`npm 操作失败 (${result.exitCode})：${result.stderr.slice(-2000)}`);
  return result;
}
