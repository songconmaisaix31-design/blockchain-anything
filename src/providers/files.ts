import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Config } from '../config.js';

function assertInside(root: string, target: string): void {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('文件路径超出 BCA_WORKING_ROOT');
}

export async function readWorkingFile(config: Config, path: string): Promise<Buffer> {
  const root = await realpath(config.workingRoot);
  const requested = resolve(root, path);
  assertInside(root, requested);
  const resolved = await realpath(requested);
  assertInside(root, resolved);
  const handle = await open(resolved, 'r');
  try {
    const actual = await realpath(requested);
    assertInside(root, actual);
    if (actual !== resolved) throw new Error('文件路径在打开期间发生变化');
    const opened = await handle.stat({ bigint: true });
    // Use the same handle-based API: older Windows libuv versions report
    // different device IDs for path stat and fstat. BigInt preserves file IDs.
    const currentHandle = await open(actual, 'r');
    const current = await currentHandle.stat({ bigint: true }).finally(() => currentHandle.close());
    if (!opened.isFile()) throw new Error('路径必须指向普通文件');
    if (opened.dev !== current.dev || opened.ino !== current.ino) throw new Error('文件在打开期间发生变化');
    if (opened.size > config.maxFileBytes) throw new Error('文件超过 BCA_MAX_FILE_BYTES');
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, config.maxFileBytes - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > config.maxFileBytes) throw new Error('文件超过 BCA_MAX_FILE_BYTES');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}
