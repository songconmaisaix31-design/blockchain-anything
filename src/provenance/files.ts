import { lstat, mkdir, open, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ProvenanceConfig } from './config.js';
import { readWorkingFile } from '../providers/files.js';
import type { Config } from '../config.js';

function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('文件路径超出 BCA_WORKING_ROOT');
}

export async function resolveExisting(config: ProvenanceConfig, path: string): Promise<string> {
  const root = await realpath(config.workingRoot);
  const requested = resolve(root, path);
  assertInside(root, requested);
  const resolved = await realpath(requested);
  assertInside(root, resolved);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('路径必须指向普通文件');
  return resolved;
}

export async function resolveOutput(config: ProvenanceConfig, path: string): Promise<string> {
  const root = await realpath(config.workingRoot);
  const requested = resolve(root, path);
  assertInside(root, requested);
  const parent = await realpath(dirname(requested));
  assertInside(root, parent);
  const info = await stat(parent);
  if (!info.isDirectory()) throw new Error('输出路径父级必须为目录');
  const target = join(parent, requested.slice(requested.lastIndexOf(sep) + 1));
  try {
    await lstat(target);
    throw new Error('输出文件已存在，拒绝覆盖');
  } catch (error) {
    if (error instanceof Error && error.message === '输出文件已存在，拒绝覆盖') throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return target;
}

export async function ensureDirectory(config: ProvenanceConfig, path: string): Promise<string> {
  const root = await realpath(config.workingRoot);
  const requested = resolve(root, path);
  assertInside(root, requested);
  let current = dirname(requested);
  while (true) {
    try {
      const resolved = await realpath(current);
      assertInside(root, resolved);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next = dirname(current);
      if (next === current) throw error;
      current = next;
    }
  }
  await mkdir(requested, { recursive: true });
  const resolved = await realpath(requested);
  assertInside(root, resolved);
  return resolved;
}

export async function readWorkingJson(config: ProvenanceConfig, path: string): Promise<unknown> {
  const bytes = await readWorkingFile({ workingRoot: config.workingRoot, maxFileBytes: config.maxFileBytes } as Config, path);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('文件不是有效 JSON');
  }
}

export async function writeNewFile(path: string, content: string | Uint8Array): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}
