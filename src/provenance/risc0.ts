import { createHash } from 'node:crypto';
import { Interface, isAddress, getAddress } from 'ethers';
import { z } from 'zod';
import type { Config } from '../config.js';
import { defineTool } from '../types.js';
import { readProvenanceConfig } from './config.js';

const hexBytes = z.string().max(2_000_000).regex(/^0x(?:[0-9a-fA-F]{2})+$/, '必须为非空十六进制字节');
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, '必须为 bytes32');
const verifierAbi = new Interface(['function verify(bytes seal, bytes32 imageId, bytes32 postStateDigest)']);

async function rpc(url: string, method: string, params: unknown[], timeoutMs: number): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json() as { result?: unknown; error?: { code: number; message: string; data?: string } };
  return body;
}

function revertLabel(data: string | undefined): string | undefined {
  if (!data) return undefined;
  if (data.startsWith('0x439cc0cd')) return 'VerificationFailed()';
  return undefined;
}

export function risc0Tools(config: Config) {
  const provenance = readProvenanceConfig(config);
  return [
    defineTool('risc0_verify_receipt', '调用操作者配置的官方 RISC Zero Groth16 验证合约，对 seal、image ID 和 journal 执行真实 eth_call；先核对链 ID 与合约代码，失败时返回 revert 数据。',
      z.strictObject({
        seal: hexBytes,
        imageId: bytes32,
        journal: z.string().max(1_000_000).optional(),
        journalHex: hexBytes.optional(),
      }),
      true,
      async ({ seal, imageId, journal, journalHex }) => {
        if (!provenance.risc0Verifier) throw new Error('需要 BCA_RISC0_VERIFIER（官方 RISC Zero 验证合约地址）');
        if (!isAddress(provenance.risc0Verifier)) throw new Error('BCA_RISC0_VERIFIER 必须为 EVM 地址');
        if (!config.rpcUrl) throw new Error('需要 BCA_RPC_URL（用于 eth_call 的 JSON-RPC）');
        if ((journal === undefined) === (journalHex === undefined)) throw new Error('journal 与 journalHex 必须且只能提供一个');
        const journalBytes = journalHex ? Buffer.from(journalHex.slice(2), 'hex') : Buffer.from(journal ?? '', 'utf8');
        const journalDigest = `0x${createHash('sha256').update(journalBytes).digest('hex')}`;
        const verifier = getAddress(provenance.risc0Verifier);
        const chain = await rpc(config.rpcUrl, 'eth_chainId', [], provenance.timeoutMs);
        if (chain.error) throw new Error(`RPC eth_chainId 失败：${chain.error.message}`);
        const chainId = BigInt(chain.result as string);
        if (config.chainId !== undefined && chainId !== config.chainId) {
          throw new Error(`RPC chain ID ${chainId} 与配置的 ${config.chainId} 不一致`);
        }
        const code = await rpc(config.rpcUrl, 'eth_getCode', [verifier, 'latest'], provenance.timeoutMs);
        if (code.error) throw new Error(`RPC eth_getCode 失败：${code.error.message}`);
        if (typeof code.result !== 'string' || code.result === '0x') throw new Error('验证合约地址没有合约代码');
        const data = verifierAbi.encodeFunctionData('verify', [seal, imageId, journalDigest]);
        const call = await rpc(config.rpcUrl, 'eth_call', [{ to: verifier, data }, 'latest'], provenance.timeoutMs);
        if (call.error) {
          if (call.error.code === 3 || /revert/i.test(call.error.message)) {
            return {
              verified: false,
              verifier,
              chainId: chainId.toString(),
              imageId,
              journalDigest,
              journalBytes: journalBytes.length,
              revertData: call.error.data ?? null,
              revert: revertLabel(call.error.data),
              trustBoundary: '验证合约由操作者配置；该调用只证明 Groth16 seal 对给定 image ID 与 journal digest 有效，不证明 image ID 来源或 journal 业务含义。',
            };
          }
          throw new Error(`RPC eth_call 失败：${call.error.message}`);
        }
        return {
          verified: true,
          verifier,
          chainId: chainId.toString(),
          imageId,
          journalDigest,
          journalBytes: journalBytes.length,
          claimShape: 'SystemState(0,0) + Halted(0) + zero input + sha256(journal) post-state，由官方 IRiscZeroVerifier.verify 组装',
          trustBoundary: '验证合约由操作者配置；该调用只证明 Groth16 seal 对给定 image ID 与 journal digest 有效，不证明 image ID 来源或 journal 业务含义。',
        };
      }),
  ];
}
