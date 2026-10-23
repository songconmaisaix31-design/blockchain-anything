import { realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Config } from '../config.js';

/**
 * Development-specific settings are deliberately parsed without throwing at
 * toolkit construction time. A broken optional setting must not prevent the
 * EVM, EAS, content or IPFS tools from being created.
 */
export interface DevelopmentConfig {
  base: Config;
  roots: string[];
  rootsSource: string;
  forgeBin: string;
  castBin: string;
  slitherBin: string;
  skillsVersion: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxFileBytes: number;
  maxReadBytes: number;
  errors: string[];
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_TIMEOUT_MS = 3_600_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  maximum: number,
  errors: string[],
): number {
  if (!value) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) {
    errors.push(`${name} 必须为十进制正整数`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    errors.push(`${name} 超出允许范围（最大 ${maximum}）`);
    return fallback;
  }
  return parsed;
}

function executable(value: string | undefined, name: string, fallback: string, errors: string[]): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (trimmed.includes('\0') || trimmed.includes('\r') || trimmed.includes('\n')) {
    errors.push(`${name} 包含非法字符`);
    return fallback;
  }
  return trimmed;
}

export function loadDevelopmentConfig(base: Config): DevelopmentConfig {
  const env = process.env;
  const errors: string[] = [];
  const rootsSource = env.BCA_DEVELOPMENT_ROOTS ?? '';
  const rawRoots = rootsSource
    ? rootsSource.split(delimiter).map((entry) => entry.trim()).filter(Boolean)
    : [base.workingRoot];
  if (rawRoots.length === 0) errors.push('BCA_DEVELOPMENT_ROOTS 至少需要一个目录');

  const skillsVersion = env.BCA_SKILLS_VERSION ?? '1.7.4';
  const skillsVersionValid = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(skillsVersion);
  if (!skillsVersionValid) {
    errors.push('BCA_SKILLS_VERSION 必须为 x.y.z 形式的版本号');
  }

  return {
    base,
    roots: rawRoots.map((entry) => isAbsolute(entry) ? resolve(entry) : resolve(base.workingRoot, entry)),
    rootsSource: rootsSource || '(BCA_WORKING_ROOT)',
    forgeBin: executable(env.BCA_FORGE_BIN, 'BCA_FORGE_BIN', 'forge', errors),
    castBin: executable(env.BCA_CAST_BIN, 'BCA_CAST_BIN', 'cast', errors),
    slitherBin: executable(env.BCA_SLITHER_BIN, 'BCA_SLITHER_BIN', 'slither', errors),
    skillsVersion: skillsVersionValid ? skillsVersion : '1.7.4',
    timeoutMs: positiveInteger(env.BCA_DEVELOPMENT_TIMEOUT_MS, 'BCA_DEVELOPMENT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, errors),
    maxOutputBytes: positiveInteger(env.BCA_DEVELOPMENT_MAX_OUTPUT_BYTES, 'BCA_DEVELOPMENT_MAX_OUTPUT_BYTES', DEFAULT_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES, errors),
    maxFileBytes: base.maxFileBytes,
    maxReadBytes: base.maxReadBytes,
    errors,
  };
}

function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error('项目目录超出 BCA_DEVELOPMENT_ROOTS');
  }
}

export interface ResolvedProject {
  path: string;
  root: string;
}

async function existingRoots(dev: DevelopmentConfig): Promise<string[]> {
  const roots: string[] = [];
  const failures: string[] = [];
  for (const root of dev.roots) {
    try {
      const resolved = await realpath(root);
      if (!(await stat(resolved)).isDirectory()) {
        failures.push(`${root} 不是目录`);
        continue;
      }
      roots.push(resolved);
    } catch {
      failures.push(`${root} 不存在或不可访问`);
    }
  }
  if (roots.length === 0) {
    throw new Error(`没有可用的 BCA_DEVELOPMENT_ROOTS：${failures.join('；')}`);
  }
  return roots;
}

/**
 * Resolve a caller-supplied project directory inside an explicitly allowed
 * root. Both the requested path and its real path are checked so a symlink
 * cannot escape the configured roots.
 */
export async function resolveProject(dev: DevelopmentConfig, project: string): Promise<ResolvedProject> {
  if (!project || project.includes('\0')) throw new Error('project 不能为空');
  const roots = await existingRoots(dev);
  const attempts: string[] = [];
  for (const root of roots) {
    const candidate = isAbsolute(project) ? project : resolve(root, project);
    try {
      assertInside(root, candidate);
      const resolved = await realpath(candidate);
      assertInside(root, resolved);
      if (!(await stat(resolved)).isDirectory()) {
        attempts.push(`${candidate} 不是目录`);
        continue;
      }
      return { path: resolved, root };
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`项目目录不可用或超出 BCA_DEVELOPMENT_ROOTS：${project}${attempts.length ? `（${attempts.join('；')}）` : ''}`);
}

export async function describeRoots(dev: DevelopmentConfig) {
  return Promise.all(dev.roots.map(async (root) => {
    try {
      const resolved = await realpath(root);
      const info = await stat(resolved);
      return { configured: root, resolved, exists: info.isDirectory(), error: info.isDirectory() ? null : '不是目录' };
    } catch (error) {
      return { configured: root, resolved: null, exists: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));
}

export function relativeToRoot(root: string, target: string): string {
  const path = relative(root, target);
  return path && !path.startsWith('..') ? path.split(sep).join('/') : target;
}
