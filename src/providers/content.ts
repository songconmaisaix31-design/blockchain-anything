import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readWorkingFile } from './files.js';

export function contentTools(config: Config) {
  return [
    defineTool('content_cid', '读取工作根目录内的实际文件，返回 CIDv1/raw/sha2-256；此 CID 标识完整原字节，不代表 IPFS UnixFS 导入结果。',
      z.strictObject({ path: z.string().min(1) }), true,
      async ({ path }) => {
        const bytes = await readWorkingFile(config, path);
        const cid = CID.createV1(raw.code, await sha256.digest(bytes));
        return { cid: cid.toString(), bytes: bytes.length, format: 'raw', hash: 'sha2-256', importedToIpfs: false };
      }),
    defineTool('content_inspect', '使用 multiformats 解析标准 CID，返回版本、codec 和 multihash；不查询内容存在性。',
      z.strictObject({ cid: z.string().min(1) }), true,
      async ({ cid: text }) => {
        const cid = CID.parse(text);
        return { cid: cid.toString(), cidV1: cid.toV1().toString(), version: cid.version, codec: cid.code, multihash: { code: cid.multihash.code, size: cid.multihash.size, digestHex: Buffer.from(cid.multihash.digest).toString('hex') } };
      }),
  ];
}
