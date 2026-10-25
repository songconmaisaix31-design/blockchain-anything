import { readFile, writeFile, copyFile, mkdir, rename, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function textOrEmpty(path: string) {
  try { return await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
}
export async function replaceWithBackup(path: string, text: string) {
  const info = await lstat(path).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (info?.isSymbolicLink()) throw new Error('配置目标不能是符号链接');
  const previous = await textOrEmpty(path);
  if (previous === text) return { path, changed: false, backup: null };
  await mkdir(dirname(path), { recursive: true });
  const backup = previous ? `${path}.bca-backup-${Date.now()}-${randomUUID().slice(0, 8)}` : null;
  if (backup) await copyFile(path, backup);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, path);
  return { path, changed: true, backup };
}
