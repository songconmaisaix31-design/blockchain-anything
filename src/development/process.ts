import { spawn, type ChildProcess } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface CommandOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const ANSI = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI, '');
}

function childEnvironment(extra: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Development commands never need the EVM signer. Removing it also keeps the
  // secret out of child processes such as solc, Hardhat and Slither. Provider
  // URLs are removed for the same reason; cast receives its configured URL as
  // an explicit argument instead of inheriting it through the environment.
  delete env.BCA_PRIVATE_KEY;
  delete env.BCA_RPC_URL;
  delete env.BCA_IPFS_URL;
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
  return env;
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    // Best effort cleanup; the original failure is reported below.
  }
}

/**
 * Run a fixed executable with an argument array. No shell is involved, so
 * caller-supplied values can never be interpreted as shell syntax.
 */
export function runCommand(command: string, args: string[], options: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let totalBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const finish = (error?: Error, result?: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else if (result) resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: childEnvironment(options.env),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    const timer = setTimeout(() => {
      killTree(child);
      finish(new Error(`命令超时（${options.timeoutMs}ms）：${command}`));
    }, options.timeoutMs);

    const collect = (target: Buffer[], chunk: Buffer) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > options.maxOutputBytes) {
        killTree(child);
        finish(new Error(`命令输出超过 BCA_DEVELOPMENT_MAX_OUTPUT_BYTES（${options.maxOutputBytes} 字节）：${command}`));
        return;
      }
      target.push(chunk);
    };

    child.stdout?.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect(stderr, chunk));

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish(new Error(`未找到可执行文件：${command}；请安装官方工具或用对应 BCA_*_BIN 配置绝对路径`));
        return;
      }
      finish(new Error(`启动命令失败：${command}：${error.message}`));
    });

    child.on('close', (code, signal) => {
      finish(undefined, {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

export async function probeCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 20_000,
  maxOutputBytes = 256 * 1024,
  env?: NodeJS.ProcessEnv,
): Promise<{ available: boolean; version: string | null; error: string | null }> {
  try {
    const result = await runCommand(command, args, { cwd, timeoutMs, maxOutputBytes, env });
    if (result.code !== 0) {
      const message = stripAnsi(result.stderr || result.stdout).trim().split('\n').slice(0, 3).join(' ');
      return { available: false, version: null, error: message || `退出码 ${result.code}` };
    }
    const first = stripAnsi(result.stdout || result.stderr).trim().split('\n')[0] ?? '';
    return { available: true, version: first || null, error: null };
  } catch (error) {
    return { available: false, version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve npm's npx entry point without relying on a shell. This keeps the
 * official `skills` installer usable from MCP and CLI processes on Windows.
 */
export async function resolveNpxCli(): Promise<string> {
  if (process.env.BCA_NPX_CLI) {
    const configured = process.env.BCA_NPX_CLI;
    if (await fileExists(configured)) return configured;
    throw new Error('BCA_NPX_CLI 指向的文件不存在');
  }
  const nodeDirectory = dirname(process.execPath);
  const candidates = [
    join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      if (await fileExists(candidate)) return candidate;
    } catch {
      // Try the next standard npm layout.
    }
  }
  throw new Error('未找到 npm 的 npx-cli.js；请安装 Node.js/npm 或配置 BCA_NPX_CLI');
}
