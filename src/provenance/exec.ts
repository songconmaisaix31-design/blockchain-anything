import { spawn } from 'node:child_process';

const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;

export class CommandFailure extends Error {
  constructor(message: string, public readonly exitCode: number | null, public readonly output: string) {
    super(message);
    this.name = 'CommandFailure';
  }
}

export class CommandTimeout extends Error {
  constructor(public readonly command: string, public readonly timeoutMs: number) {
    super(`${command} 超过 ${timeoutMs}ms 超时`);
    this.name = 'CommandTimeout';
  }
}

export interface RunOptions {
  timeoutMs: number;
  cwd?: string;
  env?: Record<string, string>;
  maxOutputBytes?: number;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export async function runCommand(command: string, args: string[], options: RunOptions): Promise<RunResult> {
  const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (error: Error | null, result?: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else if (result) resolve(result);
    };
    const append = (target: Buffer[], chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > limit) {
        child.kill();
        finish(new CommandFailure(`${command} 输出超过 ${limit} 字节`, null, ''));
        return;
      }
      target.push(chunk);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new CommandTimeout(command, options.timeoutMs));
    }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      const message = error.code === 'ENOENT'
        ? `未找到可执行文件 ${command}；请安装官方工具或配置对应 BCA_*_PATH`
        : `${command} 启动失败：${error.message}`;
      finish(new Error(message));
    });
    child.on('close', (code) => {
      finish(null, {
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

export function commandOutput(result: RunResult): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
}

export function requireSuccess(command: string, result: RunResult, message: string): RunResult {
  if (result.code !== 0) {
    throw new CommandFailure(`${message}（${command} 退出码 ${result.code ?? 'null'}）：${commandOutput(result)}`, result.code, commandOutput(result));
  }
  return result;
}
