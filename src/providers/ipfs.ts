import { create } from 'kubo-rpc-client';
import { CID } from 'multiformats/cid';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireWrites, assertConfiguration } from '../config.js';
import { defineTool } from '../types.js';
import { submitSchema } from './common.js';
import { readWorkingFile } from './files.js';

function client(config: Config) {
  assertConfiguration(config, 'ipfs');
  if (!config.ipfsUrl) throw new Error('需要 BCA_IPFS_URL');
  return create({ url: config.ipfsUrl, timeout: config.timeoutMs });
}

export function ipfsTools(config: Config) {
  return [
    defineTool('ipfs_status', '连接配置的 Kubo RPC 并读取真实节点版本。', z.strictObject({}), true,
      async () => ({ configured: true, connectionVerified: true, version: await client(config).version({ signal: AbortSignal.timeout(config.timeoutMs) }) })),
    defineTool('ipfs_add', '将工作根目录内的实际文件传输到配置的 Kubo 并固定保存；使用原生 UnixFS 导入，联网节点可能公开内容。',
      z.strictObject({ path: z.string().min(1), submit: submitSchema }), false,
      async ({ path }) => {
        requireWrites(config, false);
        const ipfs = client(config);
        const bytes = await readWorkingFile(config, path);
        const result = await ipfs.add(bytes, { cidVersion: 1, rawLeaves: false, pin: true, signal: AbortSignal.timeout(config.timeoutMs) });
        return { cid: result.cid.toString(), format: 'unixfs', bytes: bytes.length, dagSize: result.size, pinned: true };
      }),
    defineTool('ipfs_read', '从配置的 Kubo 读取 CID 内容，以 base64 返回；超过字节上限立即失败，不返回截断内容。',
      z.strictObject({ cid: z.string().min(1), maxBytes: z.number().int().positive().max(config.maxReadBytes).optional() }), true,
      async ({ cid, maxBytes }) => {
        const parsed = CID.parse(cid);
        const limit = maxBytes ?? config.maxReadBytes;
        const chunks: Uint8Array[] = [];
        let total = 0;
        const abort = new AbortController();
        try {
          for await (const chunk of client(config).cat(parsed.toString(), { length: limit + 1, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(config.timeoutMs)]) })) {
            total += chunk.byteLength;
            if (total > limit) throw new Error('IPFS 内容超过读取字节上限');
            chunks.push(chunk);
          }
          return { cid: parsed.toString(), bytes: total, encoding: 'base64', data: Buffer.concat(chunks, total).toString('base64') };
        } finally {
          abort.abort();
        }
      }),
  ];
}
