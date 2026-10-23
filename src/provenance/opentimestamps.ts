import { createRequire } from 'node:module';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readProvenanceConfig } from './config.js';
import { readWorkingFile } from '../providers/files.js';

const require = createRequire(import.meta.url);
const OTS = require('opentimestamps') as typeof import('opentimestamps');

interface Collected {
  bitcoin: Array<{ height: number }>;
  litecoin: Array<{ height: number }>;
  pending: Array<{ uri: string }>;
  unknown: Array<{ type: string }>;
}

function collect(node: import('opentimestamps').TimestampNode, result: Collected): void {
  for (const attestation of node.attestations) {
    if (attestation instanceof OTS.Notary.BitcoinBlockHeaderAttestation) {
      result.bitcoin.push({ height: attestation.height });
    } else if (attestation instanceof OTS.Notary.LitecoinBlockHeaderAttestation) {
      result.litecoin.push({ height: attestation.height });
    } else if (attestation instanceof OTS.Notary.PendingAttestation) {
      result.pending.push({ uri: attestation.uri });
    } else {
      result.unknown.push({ type: attestation.constructor?.name ?? 'UnknownAttestation' });
    }
  }
  for (const child of node.ops.values()) collect(child, result);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`OpenTimestamps 验证超过 ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withoutOtsStdout<T>(run: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: any, ...args: any[]) => {
    if (typeof chunk === 'string' && chunk.startsWith('Lite-client verification')) return true;
    return original(chunk, ...args);
  }) as typeof process.stdout.write;
  try {
    return await run();
  } finally {
    process.stdout.write = original;
  }
}

export function openTimestampsTools(config: Config) {
  const provenance = readProvenanceConfig(config);
  return [
    defineTool('ots_inspect', '使用官方 javascript-opentimestamps 解析 .ots 证明，返回文件哈希、Bitcoin/Litecoin 区块高度、待确认日历和未知 attestation；不联网、不声称已确认。',
      z.strictObject({ proofPath: z.string().min(1) }),
      true,
      async ({ proofPath }) => {
        const bytes = await readWorkingFile(config, proofPath);
        let detached: import('opentimestamps').DetachedTimestampFile;
        try {
          detached = OTS.DetachedTimestampFile.deserialize(bytes);
        } catch (error) {
          throw new Error(`OpenTimestamps 证明无法解析：${error instanceof Error ? error.message : '未知错误'}`);
        }
        const collected: Collected = { bitcoin: [], litecoin: [], pending: [], unknown: [] };
        collect(detached.timestamp, collected);
        const hashAlgorithm = detached.fileHashOp._HASHLIB_NAME();
        return {
          proofPath,
          hashAlgorithm,
          digestHex: Buffer.from(detached.timestamp.msg).toString('hex'),
          bitcoin: collected.bitcoin,
          litecoin: collected.litecoin,
          pending: collected.pending,
          unknown: collected.unknown,
          complete: collected.bitcoin.length > 0 || collected.litecoin.length > 0,
          info: OTS.info(detached),
          note: 'pending attestation 表示日历已接受但尚未获得区块链确认；inspect 不验证区块头。',
        };
      }),
    defineTool('ots_verify', '使用官方 javascript-opentimestamps 对工作根目录内的文件和 .ots 证明执行真实验证；按证明中的哈希算法重算文件哈希，并通过 Bitcoin 区块浏览器检查完整 attestation。',
      z.strictObject({ proofPath: z.string().min(1), targetPath: z.string().min(1) }),
      true,
      async ({ proofPath, targetPath }) => {
        const proofBytes = await readWorkingFile(config, proofPath);
        const targetBytes = await readWorkingFile(config, targetPath);
        const detached = OTS.DetachedTimestampFile.deserialize(proofBytes);
        const target = OTS.DetachedTimestampFile.fromBytes(detached.fileHashOp, targetBytes);
        const result = await withoutOtsStdout(() => withTimeout(
          OTS.verify(detached, target, { ignoreBitcoinNode: true, timeout: Math.min(provenance.timeoutMs, 30_000) }),
          provenance.timeoutMs + 5_000,
        ));
        if (!result) {
          return {
            verified: false,
            reason: '证明没有可通过区块浏览器验证的完整 attestation（可能仍是 pending，需先由官方客户端 upgrade）',
            proofPath,
            targetPath,
          };
        }
        return {
          verified: true,
          proofPath,
          targetPath,
          attestations: Object.entries(result).map(([chain, value]) => ({ chain, ...value })),
          verificationMode: 'bitcoin-block-explorer-lite-client',
          trustBoundary: '验证依赖官方库内置区块浏览器返回的区块头；不等同于本地 Bitcoin 全节点验证，也不证明文件内容真实性。',
        };
      }),
  ];
}
