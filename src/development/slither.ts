import { z } from 'zod';
import type { DevelopmentConfig } from './config.js';
import { relativeToRoot, resolveProject } from './config.js';
import { makeDevTool, parseJson } from './helpers.js';
import { runCommand, stripAnsi } from './process.js';

const detectorName = z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/, '无效的 Slither detector 名称');

export function slitherEnvironment(binary: string): NodeJS.ProcessEnv | undefined {
  if (process.env.VIRTUAL_ENV) return undefined;
  const match = /^(.*)[\\/](Scripts|bin)[\\/]slither(?:\.exe)?$/i.exec(binary);
  if (!match?.[1]) return undefined;
  // solc-select keeps its compiler cache under VIRTUAL_ENV when present. This
  // keeps a project-local slither venv self-contained instead of writing to
  // the user's home directory.
  return { VIRTUAL_ENV: match[1] };
}

export function slitherTools(dev: DevelopmentConfig) {
  const config = dev.base;
  return [
    makeDevTool(config, 'slither_analyze',
      '在配置的项目目录运行官方 Slither CLI（slither . --json -），返回检测器原始结果；默认排除依赖库发现项，不执行修复或部署。',
      z.strictObject({
        project: z.string().min(1).max(1024).describe('相对 BCA_DEVELOPMENT_ROOTS 的 Solidity 项目目录'),
        detectors: z.array(detectorName).max(50).optional().describe('只运行指定的官方 detector；省略则运行全部'),
        excludeDependencies: z.boolean().default(true).describe('排除只与依赖库相关的发现'),
      }), true,
      async ({ project, detectors, excludeDependencies }) => {
        const resolved = await resolveProject(dev, project);
        const args = ['.', '--json', '-', '--disable-color'];
        if (excludeDependencies) args.push('--exclude-dependencies');
        if (detectors && detectors.length > 0) args.push('--detect', detectors.join(','));
        const result = await runCommand(dev.slitherBin, args, {
          cwd: resolved.path,
          timeoutMs: dev.timeoutMs,
          maxOutputBytes: dev.maxOutputBytes,
          env: slitherEnvironment(dev.slitherBin),
        });
        if (!result.stdout.trim()) {
          throw new Error(`Slither 未返回 JSON（退出码 ${result.code}）：${stripAnsi(result.stderr).trim().slice(0, 2000)}`);
        }
        const parsed = parseJson<Record<string, unknown>>(result.stdout, 'slither --json');
        if (parsed.success !== true) {
          throw new Error(`Slither 分析失败：${typeof parsed.error === 'string' ? parsed.error : '未知错误'}`);
        }
        const results = parsed.results && typeof parsed.results === 'object' && !Array.isArray(parsed.results)
          ? parsed.results as Record<string, unknown>
          : {};
        const findings = Array.isArray(results.detectors) ? results.detectors : [];
        return {
          project: relativeToRoot(resolved.root, resolved.path),
          success: true,
          exitCode: result.code,
          detectorCount: findings.length,
          detectors: findings,
          error: parsed.error ?? null,
          stderr: stripAnsi(result.stderr).trim().slice(0, 4000) || null,
        };
      }),
  ];
}
