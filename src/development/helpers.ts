import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { z } from 'zod';
import type { Config } from '../config.js';
import { safeError } from '../providers/common.js';
import { defineTool, type ToolImplementation } from '../types.js';

export function makeDevTool<S extends z.ZodObject>(
  config: Config,
  name: string,
  description: string,
  inputSchema: S,
  readOnly: boolean,
  execute: (input: z.output<S>) => Promise<unknown>,
): ToolImplementation {
  return defineTool(name, description, inputSchema, readOnly, async (input) => {
    try {
      return await execute(input);
    } catch (error) {
      throw safeError(error, config);
    }
  });
}

export function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().slice(0, 500) || '(空输出)';
    throw new Error(`${label} 未返回有效 JSON：${preview}`);
  }
}

export function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error('路径超出允许的目录');
  }
}

export interface ListedFile {
  path: string;
  bytes: number;
}

/**
 * List regular files under a directory without following symlinks. The limit
 * prevents a malformed skill or artifact tree from consuming unbounded work.
 */
export async function listFiles(root: string, limit = 500): Promise<{ files: ListedFile[]; truncated: boolean }> {
  const files: ListedFile[] = [];
  let truncated = false;
  const walk = async (directory: string, prefix: string): Promise<void> => {
    if (truncated) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const target = resolve(directory, entry.name);
      assertInside(root, target);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(target, path);
      } else if (entry.isFile()) {
        const info = await stat(target);
        files.push({ path, bytes: info.size });
      }
    }
  };
  await walk(root, '');
  return { files, truncated };
}

export async function readTextFile(path: string, maxBytes: number): Promise<{ content: string; bytes: number }> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error('路径必须指向普通文件');
  if (info.size > maxBytes) throw new Error(`文件超过读取上限（${maxBytes} 字节）`);
  const buffer = await readFile(path);
  if (buffer.length > maxBytes) throw new Error(`文件超过读取上限（${maxBytes} 字节）`);
  return { content: buffer.toString('utf8'), bytes: buffer.length };
}

export function relativePath(root: string, target: string): string {
  const path = relative(root, target);
  return path && !path.startsWith('..') ? path.split(sep).join('/') : target;
}
