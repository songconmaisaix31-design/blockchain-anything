import { spawn } from 'node:child_process';
import { z } from 'zod';
import { defineTool } from '../types.js';
import type { WalletConfig } from '../wallets/config.js';

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runHbot(config: WalletConfig, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.hbotBin, args, {
      cwd: config.base.workingRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const limit = 1024 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, config.base.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < limit) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < limit) stderr += chunk.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 Hummingbot hbot（${config.hbotBin}）：${error.message}`));
    });
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

export function hummingbotTools(config: WalletConfig) {
  return [
    defineTool(
      'trading_hummingbot_version',
      '运行官方 Hummingbot hbot CLI 的 --version；只读取本地客户端版本。',
      z.strictObject({}),
      true,
      async () => {
        const result = await runHbot(config, ['--version']);
        if (result.exitCode !== 0) throw new Error(`hbot --version 失败（exit ${result.exitCode}）：${result.stderr || result.stdout}`);
        return { sdk: 'hummingbot hbot', binary: config.hbotBin, version: result.stdout.trim() || result.stderr.trim() };
      },
    ),
    defineTool(
      'trading_hummingbot_status',
      '运行官方 Hummingbot hbot CLI 的 status --json，读取本机 bot 运行状态；不启动、不停止、不连接交易所。',
      z.strictObject({}),
      true,
      async () => {
        const result = await runHbot(config, ['status', '--json']);
        if (result.timedOut) throw new Error('hbot status 超时');
        if (result.exitCode !== 0) throw new Error(`hbot status 失败（exit ${result.exitCode}）：${result.stderr || result.stdout}`);
        let status: unknown;
        try { status = JSON.parse(result.stdout); } catch { throw new Error('hbot status 未返回 JSON'); }
        return { sdk: 'hummingbot hbot', binary: config.hbotBin, status };
      },
    ),
    defineTool(
      'trading_hummingbot_doctor',
      '运行官方 Hummingbot hbot CLI 的 doctor 健康检查；返回真实退出码和输出，不修改配置。',
      z.strictObject({}),
      true,
      async () => {
        const result = await runHbot(config, ['doctor']);
        if (result.timedOut) throw new Error('hbot doctor 超时');
        return {
          sdk: 'hummingbot hbot',
          binary: config.hbotBin,
          healthy: result.exitCode === 0,
          exitCode: result.exitCode,
          output: result.stdout.trim(),
          errors: result.stderr.trim(),
        };
      },
    ),
  ];
}
